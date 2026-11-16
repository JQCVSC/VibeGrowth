import express, { Express, NextFunction, Request, Response } from "express";
import path from "path";
import Stripe from "stripe";
import {
  AuditAbuseGuard,
  AuditValidationError,
  computeAuditFingerprintKey,
  computeSubmissionIdKey,
  createIpRateLimiter,
  createVertexAuditDraftGenerator,
  RateLimiter,
  sanitizeAuditInputForGemini,
  validateAuditSubmission,
  validateReviewUpdate,
  VertexDraftGenerator,
} from "./auditService.js";
import { CatalogValidationError, resolveOrderFromProductIds } from "./catalog.js";
import {
  AuditStore,
  DecodedFirebaseUser,
  FirestoreAuditAbuseGuard,
  FirestoreAuditStore,
  FirestorePaymentStore,
  getFirebaseAdminServices,
  PaymentStore,
  StripePaymentIntentEventData,
} from "./firebaseAdmin.js";

export interface StripeLike {
  paymentIntents: {
    create(params: {
      amount: number;
      currency: string;
      automatic_payment_methods: { enabled: boolean };
      metadata: Record<string, string>;
    }): Promise<{ id: string; client_secret: string | null }>;
  };
  webhooks: {
    constructEvent(
      payload: Buffer | string,
      header: string,
      secret: string
    ): {
      id: string;
      type: string;
      data: { object: unknown };
    };
  };
}

export interface FirebaseAuthLike {
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<DecodedFirebaseUser>;
}

export interface AppDependencies {
  getStripe?: () => StripeLike | null;
  getStripeWebhookSecret?: () => string | undefined;
  getAuth?: () => { auth: FirebaseAuthLike | null; error: string | null };
  getPaymentStore?: () => { store: PaymentStore | null; error: string | null };
  getAuditStore?: () => { store: AuditStore | null; error: string | null };
  getAuditAbuseGuard?: () => { guard: AuditAbuseGuard | null; error: string | null };
  getAuditDraftGenerator?: () => VertexDraftGenerator;
  auditRateLimiter?: RateLimiter;
  mountFrontend?: boolean;
  isProduction?: boolean;
  distPath?: string;
}

let defaultStripe: Stripe | null = null;

function getDefaultStripe(): StripeLike | null {
  if (!defaultStripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return null;
    }
    defaultStripe = new Stripe(key);
  }
  return defaultStripe as unknown as StripeLike;
}

function getDefaultAuth() {
  const { auth, error } = getFirebaseAdminServices();
  return { auth: auth as unknown as FirebaseAuthLike | null, error };
}

function getDefaultPaymentStore(): { store: PaymentStore | null; error: string | null } {
  const { db, error } = getFirebaseAdminServices();
  if (!db) {
    return { store: null, error };
  }
  return { store: new FirestorePaymentStore(db), error: null };
}

function getDefaultAuditStore(): { store: AuditStore | null; error: string | null } {
  const { db, error } = getFirebaseAdminServices();
  if (!db) {
    return { store: null, error };
  }
  return { store: new FirestoreAuditStore(db), error: null };
}

function getDefaultAuditAbuseGuard(): { guard: AuditAbuseGuard | null; error: string | null } {
  const { db, error } = getFirebaseAdminServices();
  if (!db) {
    return { guard: null, error };
  }
  return { guard: new FirestoreAuditAbuseGuard(db), error: null };
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export async function createApp(deps: AppDependencies = {}): Promise<Express> {
  const app = express();
  app.set("trust proxy", 1);

  const resolveStripe = deps.getStripe ?? getDefaultStripe;
  const resolveWebhookSecret =
    deps.getStripeWebhookSecret ?? (() => process.env.STRIPE_WEBHOOK_SECRET);
  const resolveAuth = deps.getAuth ?? getDefaultAuth;
  const resolvePaymentStore = deps.getPaymentStore ?? getDefaultPaymentStore;
  const resolveAuditStore = deps.getAuditStore ?? getDefaultAuditStore;
  const resolveAuditAbuseGuard = deps.getAuditAbuseGuard ?? getDefaultAuditAbuseGuard;
  const resolveDraftGenerator =
    deps.getAuditDraftGenerator ?? createVertexAuditDraftGenerator;
  const auditPreFilterLimiter =
    deps.auditRateLimiter ??
    createIpRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 20 });
  const mountFrontend = deps.mountFrontend ?? true;
  const isProduction = deps.isProduction ?? process.env.NODE_ENV === "production";
  const resolvedDistPath = deps.distPath ?? path.join(process.cwd(), "dist");

  async function authenticateRequest(
    req: Request,
    res: Response,
    options?: { checkRevoked?: boolean }
  ): Promise<DecodedFirebaseUser | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== "string") {
      res.status(401).json({ error: "Authentication required. Please sign in." });
      return null;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      res.status(401).json({ error: "Invalid authorization header format." });
      return null;
    }

    const { auth, error } = resolveAuth();
    if (!auth) {
      res.status(503).json({
        error: error || "Server authentication verification is not configured.",
      });
      return null;
    }

    try {
      const decoded = await auth.verifyIdToken(
        match[1].trim(),
        options?.checkRevoked === true
      );
      if (!decoded || !decoded.uid) {
        res.status(401).json({ error: "Invalid authentication token." });
        return null;
      }
      return decoded;
    } catch (err: any) {
      const code = typeof err?.code === "string" ? err.code : "";
      if (code === "auth/id-token-revoked" || code === "auth/user-disabled") {
        res.status(401).json({
          error: "Authentication session has been revoked or disabled. Please sign in again.",
        });
        return null;
      }
      if (code === "auth/internal-error" || code === "app/network-error") {
        console.error("Firebase Auth backend error during token verification:", err);
        res.status(503).json({
          error: "Unable to verify authentication status right now. Please retry.",
        });
        return null;
      }
      res.status(401).json({ error: "Invalid or expired authentication token." });
      return null;
    }
  }

  // 1. Stripe Webhook MUST receive the exact raw Buffer BEFORE express.json() runs.
  app.post(
    "/api/stripe-webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const stripeInstance = resolveStripe();
      if (!stripeInstance) {
        return res.status(503).json({ error: "Stripe is not configured on the server." });
      }

      const webhookSecret = resolveWebhookSecret();
      if (!webhookSecret) {
        return res.status(503).json({
          error: "STRIPE_WEBHOOK_SECRET is not configured on the server.",
        });
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).json({ error: "Missing stripe-signature header." });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "Webhook payload must be a raw buffer." });
      }

      let event: { id: string; type: string; data: { object: unknown } };
      try {
        event = stripeInstance.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err: any) {
        return res.status(400).json({
          error: `Webhook signature verification failed: ${err?.message || "Invalid signature"}`,
        });
      }

      const { store, error: storeError } = resolvePaymentStore();
      if (!store) {
        return res.status(503).json({
          error: storeError || "Payment persistence is not configured on the server.",
        });
      }

      const paymentIntent = event.data?.object as StripePaymentIntentEventData | undefined;
      if (!paymentIntent || typeof paymentIntent.id !== "string") {
        return res.status(400).json({ error: "Malformed Stripe event payload." });
      }

      try {
        const result = await store.processWebhookEvent({
          eventId: event.id,
          eventType: event.type,
          paymentIntent,
        });

        if (result.outcome === "duplicate") {
          return res.status(200).json({ received: true, duplicate: true });
        }
        if (result.outcome === "mismatch") {
          return res.status(400).json({ error: result.reason });
        }
        if (result.outcome === "missing_payment") {
          return res.status(200).json({ received: true, ignored: true });
        }
        if (result.outcome === "ignored") {
          return res.status(200).json({ received: true, ignored: true });
        }

        return res.status(200).json({ received: true, status: result.status });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ error: "Failed to process webhook event." });
      }
    }
  );

  // 2. JSON body parser for standard API routes
  app.use(express.json({ limit: "64kb" }));

  // Handle malformed JSON cleanly instead of returning HTML error pages
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Malformed JSON request body." });
    }
    return next(err);
  });

  // 3. Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // 4. Create Stripe PaymentIntent + server-side pending Firestore record
  app.post("/api/create-payment-intent", async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object." });
    }

    let order;
    try {
      order = resolveOrderFromProductIds(req.body.productIds);
    } catch (err) {
      if (err instanceof CatalogValidationError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(400).json({ error: "Invalid product selection." });
    }

    const stripeInstance = resolveStripe();
    if (!stripeInstance) {
      return res.status(503).json({
        error:
          "Stripe is not configured on the server. Please add STRIPE_SECRET_KEY to your environment variables.",
      });
    }

    const { store, error: storeError } = resolvePaymentStore();
    if (!store) {
      return res.status(503).json({
        error: storeError || "Server database is not configured.",
      });
    }

    try {
      const paymentIntent = await stripeInstance.paymentIntents.create({
        amount: order.amount,
        currency: order.currency,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          userId: user.uid,
          productIds: order.productIds.join(","),
          planName: order.planName,
        },
      });

      if (!paymentIntent.client_secret) {
        return res.status(502).json({ error: "Stripe did not return a client secret." });
      }

      await store.createPendingPayment({
        userId: user.uid,
        userEmail: user.email || null,
        amount: order.amount,
        currency: order.currency,
        planName: order.planName,
        productIds: order.productIds,
        status: "pending",
        stripePaymentIntentId: paymentIntent.id,
        lastWebhookEventId: null,
        failureReason: null,
      });

      return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: order.amount,
        currency: order.currency,
        planName: order.planName,
      });
    } catch (error: any) {
      console.error("Create PaymentIntent Error:", error);
      return res.status(500).json({ error: error?.message || "Payment initialization failed." });
    }
  });

  // 5. Verified server-side payment status lookup
  app.get("/api/payments/:paymentIntentId", async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, res);
    if (!user) return;

    const { paymentIntentId } = req.params;
    if (!paymentIntentId || !VALID_ID_REGEX.test(paymentIntentId)) {
      return res.status(400).json({ error: "Invalid paymentIntentId format." });
    }

    const { store, error: storeError } = resolvePaymentStore();
    if (!store) {
      return res.status(503).json({
        error: storeError || "Server database is not configured.",
      });
    }

    try {
      const payment = await store.getPaymentById(paymentIntentId);
      if (!payment) {
        return res.status(404).json({ error: "Payment record not found." });
      }

      const isOwner = payment.userId === user.uid;
      if (!isOwner) {
        // Privileged admin cross-account lookup requires revocation-checked ID token
        const revocationCheckedAdmin = await authenticateRequest(req, res, {
          checkRevoked: true,
        });
        if (!revocationCheckedAdmin) return;

        let isAdmin = false;
        try {
          isAdmin = await store.isAdminUser(revocationCheckedAdmin);
        } catch (adminErr) {
          console.error("Admin check failed during payment lookup:", adminErr);
          return res.status(503).json({
            error: "Unable to verify administrator permissions right now.",
          });
        }

        if (!isAdmin) {
          return res.status(403).json({ error: "You do not have permission to view this payment." });
        }
      }

      return res.json({
        paymentIntentId: payment.stripePaymentIntentId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        planName: payment.planName,
        failureReason: payment.failureReason || null,
      });
    } catch (error: any) {
      console.error("Get Payment Status Error:", error);
      return res.status(500).json({ error: "Failed to verify payment status." });
    }
  });

  // 6. Server-side Audit Intake + Private Preliminary Gemini Draft Generation
  app.post("/api/audits", async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const preCheck = auditPreFilterLimiter.check(clientIp);
    if (!preCheck.allowed) {
      res.setHeader("Retry-After", String(preCheck.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many audit requests. Please wait a few minutes before trying again.",
      });
    }

    let validated;
    try {
      const headerSubmissionId = req.get("Idempotency-Key") ?? undefined;
      validated = validateAuditSubmission(req.body, headerSubmissionId);
    } catch (err) {
      if (err instanceof AuditValidationError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(400).json({ error: "Invalid audit submission." });
    }

    // Silent honeypot drop: do not persist or invoke Gemini
    if (validated.isHoneypot) {
      return res.status(200).json({
        ok: true,
        message: "Audit request received.",
      });
    }

    const { store, error: storeError } = resolveAuditStore();
    if (!store) {
      return res.status(503).json({
        error: storeError || "Server database is not configured.",
      });
    }

    const { guard, error: guardError } = resolveAuditAbuseGuard();
    if (!guard) {
      return res.status(503).json({
        error: guardError || "Abuse protection store is not configured.",
      });
    }

    try {
      const { isHoneypot: _ignored, submissionId, ...auditInput } = validated;
      const fingerprintKey = computeAuditFingerprintKey(auditInput);
      const submissionIdKey = submissionId ? computeSubmissionIdKey(submissionId) : null;

      const existingLookup = await store.findRecentDuplicateAudit({
        fingerprintKey,
        submissionIdKey,
      });
      if (existingLookup.status === "conflict") {
        return res.status(409).json({
          error:
            "This submission key was already used for different details. Please edit or refresh the form and try again.",
        });
      }
      if (existingLookup.status === "duplicate") {
        return res.status(200).json({
          ok: true,
          auditId: existingLookup.audit.id,
          duplicate: true,
          message: "Your visibility review request was already received and queued for manual review.",
        });
      }

      const rateCheck = await guard.checkRateLimit({
        clientIp,
        email: auditInput.email,
      });
      if (!rateCheck.allowed) {
        res.setHeader("Retry-After", String(rateCheck.retryAfterSeconds));
        return res.status(429).json({
          error:
            rateCheck.reason ||
            "Too many audit requests. Please wait a few minutes before trying again.",
        });
      }

      const claimResult = await store.claimOrCreateAuditRequest({
        input: auditInput,
        fingerprintKey,
        submissionIdKey,
      });
      if (claimResult.status === "conflict") {
        return res.status(409).json({
          error:
            "This submission key was already used for different details. Please edit or refresh the form and try again.",
        });
      }
      if (claimResult.status === "duplicate") {
        return res.status(200).json({
          ok: true,
          auditId: claimResult.audit.id,
          duplicate: true,
          message: "Your visibility review request was already received and queued for manual review.",
        });
      }
      const created = claimResult.audit;

      const budget = await guard.consumeDailyAiBudget();
      if (!budget.allowed) {
        await store.saveAuditDraftFailure(
          created.id,
          "unavailable",
          "Daily automated preliminary draft limit reached; queued for manual strategist review."
        );
      } else {
        // Strictly strip PII (email, phone) and raw URLs before calling Gemini
        const sanitizedForGemini = sanitizeAuditInputForGemini(auditInput);
        const generator = resolveDraftGenerator();
        const draftResult = await generator.generateDraft(sanitizedForGemini);

        if (draftResult.status === "ready") {
          await store.saveAuditDraftSuccess(created.id, draftResult.draft);
        } else {
          await store.saveAuditDraftFailure(created.id, draftResult.status, draftResult.reason);
        }
      }

      // Never return the private draft or internal diagnostics to public submitters
      return res.status(201).json({
        ok: true,
        auditId: created.id,
        duplicate: false,
        message: "Visibility review request saved and queued for manual strategist review.",
      });
    } catch (err: any) {
      console.error("Audit submission error:", err);
      return res.status(500).json({ error: "Failed to submit audit request." });
    }
  });

  async function requireAdmin(
    req: Request,
    res: Response
  ): Promise<{ user: DecodedFirebaseUser; store: AuditStore } | null> {
    // Privileged admin verification always checks token revocation
    const user = await authenticateRequest(req, res, { checkRevoked: true });
    if (!user) return null;

    const { store, error: storeError } = resolveAuditStore();
    if (!store) {
      res.status(503).json({ error: storeError || "Server database is not configured." });
      return null;
    }

    let isAdmin = false;
    try {
      isAdmin = await store.isAdminUser(user);
    } catch (err) {
      console.error("Admin role verification error:", err);
      res.status(503).json({
        error: "Unable to verify administrator permissions right now. Please retry.",
      });
      return null;
    }

    if (!isAdmin) {
      res.status(403).json({ error: "Administrator access required." });
      return null;
    }

    return { user, store };
  }

  // 7. Admin-only Audit & Preliminary Draft Review Routes
  app.get("/api/admin/audits", async (req: Request, res: Response) => {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    try {
      const audits = await ctx.store.listAudits(50);
      return res.json({ audits });
    } catch (err: any) {
      console.error("Admin list audits error:", err);
      return res.status(500).json({ error: "Failed to fetch audits." });
    }
  });

  app.patch("/api/admin/audits/:auditId/review", async (req: Request, res: Response) => {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { auditId } = req.params;
    if (!auditId || !VALID_ID_REGEX.test(auditId)) {
      return res.status(400).json({ error: "Invalid auditId format." });
    }

    let reviewUpdate;
    try {
      reviewUpdate = validateReviewUpdate(req.body);
    } catch (err) {
      if (err instanceof AuditValidationError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(400).json({ error: "Invalid review update payload." });
    }

    try {
      const updated = await ctx.store.updateAuditReview(auditId, {
        reviewStatus: reviewUpdate.reviewStatus,
        reviewerNotes: reviewUpdate.reviewerNotes,
        reviewedBy: ctx.user.email || ctx.user.uid,
      });
      if (!updated) {
        return res.status(404).json({ error: "Audit record not found." });
      }
      return res.json({ audit: updated });
    } catch (err: any) {
      console.error("Admin update audit review error:", err);
      return res.status(500).json({ error: "Failed to update audit review status." });
    }
  });

  app.post("/api/admin/audits/:auditId/regenerate-draft", async (req: Request, res: Response) => {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { auditId } = req.params;
    if (!auditId || !VALID_ID_REGEX.test(auditId)) {
      return res.status(400).json({ error: "Invalid auditId format." });
    }

    const { guard, error: guardError } = resolveAuditAbuseGuard();
    if (!guard) {
      return res.status(503).json({
        error: guardError || "Abuse protection store is not configured.",
      });
    }

    try {
      const existingAudit = await ctx.store.getAuditById(auditId);
      if (!existingAudit) {
        return res.status(404).json({ error: "Audit record not found." });
      }

      const regenLimit = await guard.checkAdminRegenerateLimit({
        adminUid: ctx.user.uid,
        auditId,
      });
      if (!regenLimit.allowed) {
        res.setHeader("Retry-After", String(regenLimit.retryAfterSeconds));
        return res.status(429).json({
          error:
            regenLimit.reason ||
            "Too many draft regeneration attempts. Please wait before trying again.",
        });
      }

      const budget = await guard.consumeDailyAiBudget();
      if (!budget.allowed) {
        return res.status(429).json({
          error:
            "Daily automated preliminary draft limit reached. Manual strategist review remains available.",
        });
      }

      const sanitizedForGemini = sanitizeAuditInputForGemini({
        businessName: existingAudit.businessName,
        industry: existingAudit.industry,
        serviceArea: existingAudit.serviceArea,
        hasWebsite: existingAudit.hasWebsite,
        hasGoogleProfile: existingAudit.hasGoogleProfile,
      });

      const generator = resolveDraftGenerator();
      const draftResult = await generator.generateDraft(sanitizedForGemini);

      if (draftResult.status === "ready") {
        const updated = await ctx.store.saveAuditDraftSuccess(auditId, draftResult.draft);
        return res.json({ audit: updated });
      }

      const updated = await ctx.store.saveAuditDraftFailure(
        auditId,
        draftResult.status,
        draftResult.reason
      );
      const statusCode = draftResult.status === "unavailable" ? 503 : 502;
      return res.status(statusCode).json({
        error: draftResult.reason || "Failed to regenerate preliminary draft.",
        audit: updated,
      });
    } catch (err: any) {
      console.error("Admin regenerate audit draft error:", err);
      const clearedAudit = await ctx.store
        .saveAuditDraftFailure(
          auditId,
          "failed",
          err?.message || "Failed to regenerate preliminary draft."
        )
        .catch(() => null);
      return res.status(500).json({
        error: "Failed to regenerate preliminary draft.",
        ...(clearedAudit ? { audit: clearedAudit } : {}),
      });
    }
  });

  // 8. Unknown /api routes always return JSON 404 instead of SPA HTML
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "API route not found." });
  });

  // 9. Frontend serving (Vite dev middleware OR production built SPA)
  if (mountFrontend) {
    if (!isProduction) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(resolvedDistPath));
      app.get("*", (_req: Request, res: Response) => {
        res.sendFile(path.join(resolvedDistPath, "index.html"));
      });
    }
  }

  return app;
}
