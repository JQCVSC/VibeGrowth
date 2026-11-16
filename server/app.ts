import express, { Express, NextFunction, Request, Response } from "express";
import path from "path";
import Stripe from "stripe";
import { CatalogValidationError, resolveOrderFromProductIds } from "./catalog.js";
import {
  DecodedFirebaseUser,
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
  verifyIdToken(token: string): Promise<DecodedFirebaseUser>;
}

export interface AppDependencies {
  getStripe?: () => StripeLike | null;
  getStripeWebhookSecret?: () => string | undefined;
  getAuth?: () => { auth: FirebaseAuthLike | null; error: string | null };
  getPaymentStore?: () => { store: PaymentStore | null; error: string | null };
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

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export async function createApp(deps: AppDependencies = {}): Promise<Express> {
  const app = express();
  app.set("trust proxy", 1);

  const resolveStripe = deps.getStripe ?? getDefaultStripe;
  const resolveWebhookSecret =
    deps.getStripeWebhookSecret ?? (() => process.env.STRIPE_WEBHOOK_SECRET);
  const resolveAuth = deps.getAuth ?? getDefaultAuth;
  const resolvePaymentStore = deps.getPaymentStore ?? getDefaultPaymentStore;
  const mountFrontend = deps.mountFrontend ?? true;
  const isProduction = deps.isProduction ?? process.env.NODE_ENV === "production";
  const resolvedDistPath = deps.distPath ?? path.join(process.cwd(), "dist");

  async function authenticateRequest(
    req: Request,
    res: Response
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
      const decoded = await auth.verifyIdToken(match[1].trim());
      if (!decoded || !decoded.uid) {
        res.status(401).json({ error: "Invalid authentication token." });
        return null;
      }
      return decoded;
    } catch {
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
      const isAdmin = isOwner ? false : await store.isAdminUser(user);
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: "You do not have permission to view this payment." });
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

  // 6. Unknown /api routes always return JSON 404 instead of SPA HTML
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "API route not found." });
  });

  // 7. Frontend serving (Vite dev middleware OR production built SPA)
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
