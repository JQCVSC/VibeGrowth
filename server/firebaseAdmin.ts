import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";
import { FieldValue, Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import {
  AuditDraftStatus,
  AuditIndustry,
  AuditRecord,
  AuditReviewStatus,
  PreliminaryAuditDraft,
} from "../shared/audit.js";
import {
  AbuseCheckResult,
  AuditAbuseGuard,
  DEFAULT_ADMIN_REGEN_MAX_PER_ADMIN,
  DEFAULT_ADMIN_REGEN_MAX_PER_AUDIT,
  DEFAULT_ADMIN_REGEN_WINDOW_MS,
  DEFAULT_AUDIT_DAILY_AI_LIMIT,
  DEFAULT_AUDIT_DEDUP_WINDOW_MS,
  DEFAULT_AUDIT_USAGE_RETENTION_DAYS,
  hashAbuseKey,
} from "./auditService.js";

export type PaymentStatus = "pending" | "completed" | "failed";

export interface PaymentRecord {
  userId: string;
  userEmail: string | null;
  amount: number;
  currency: string;
  planName: string;
  productIds: string[];
  status: PaymentStatus;
  stripePaymentIntentId: string;
  lastWebhookEventId: string | null;
  failureReason: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface DecodedFirebaseUser {
  uid: string;
  email?: string;
  email_verified?: boolean;
  admin?: boolean;
}

export interface StripePaymentIntentEventData {
  id: string;
  amount: number;
  amount_received?: number;
  currency: string;
  last_payment_error?: { message?: string | null } | null;
}

export type WebhookProcessResult =
  | { outcome: "duplicate" }
  | { outcome: "missing_payment" }
  | { outcome: "mismatch"; reason: string }
  | { outcome: "updated"; status: PaymentStatus }
  | { outcome: "ignored" };

export interface PaymentStore {
  createPendingPayment(record: Omit<PaymentRecord, "createdAt" | "updatedAt" | "completedAt">): Promise<void>;
  getPaymentById(paymentIntentId: string): Promise<PaymentRecord | null>;
  isAdminUser(user: DecodedFirebaseUser): Promise<boolean>;
  processWebhookEvent(params: {
    eventId: string;
    eventType: string;
    paymentIntent: StripePaymentIntentEventData;
  }): Promise<WebhookProcessResult>;
}

export interface CreateAuditInput {
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  email: string;
  phone: string;
  websiteUrl: string;
  googleProfileUrl: string;
  hasWebsite: boolean;
  hasGoogleProfile: boolean;
}

export interface ClaimOrCreateAuditParams {
  input: CreateAuditInput;
  fingerprintKey: string;
  submissionIdKey: string | null;
  dedupWindowMs?: number;
  nowMs?: number;
}

export type DuplicateAuditLookupResult =
  | { status: "none" }
  | { status: "duplicate"; audit: AuditRecord }
  | { status: "conflict" };

export type ClaimAuditResult =
  | { status: "created"; audit: AuditRecord }
  | { status: "duplicate"; audit: AuditRecord }
  | { status: "conflict" };

export interface AuditStore {
  isAdminUser(user: DecodedFirebaseUser): Promise<boolean>;
  createAuditRequest(input: CreateAuditInput): Promise<AuditRecord>;
  findRecentDuplicateAudit(params: {
    fingerprintKey: string;
    submissionIdKey: string | null;
    nowMs?: number;
  }): Promise<DuplicateAuditLookupResult>;
  claimOrCreateAuditRequest(
    params: ClaimOrCreateAuditParams
  ): Promise<ClaimAuditResult>;
  saveAuditDraftSuccess(auditId: string, draft: PreliminaryAuditDraft): Promise<AuditRecord | null>;
  saveAuditDraftFailure(
    auditId: string,
    draftStatus: Extract<AuditDraftStatus, "unavailable" | "failed">,
    reason: string
  ): Promise<AuditRecord | null>;
  listAudits(limit?: number): Promise<AuditRecord[]>;
  getAuditById(auditId: string): Promise<AuditRecord | null>;
  updateAuditReview(
    auditId: string,
    params: {
      reviewStatus: AuditReviewStatus;
      reviewerNotes: string;
      reviewedBy: string;
    }
  ): Promise<AuditRecord | null>;
}

const DEFAULT_BOOTSTRAP_ADMIN_EMAIL = "jeremycodjoe@gmail.com";

/**
 * Consistent admin authorization shared across Express routes and aligned with firestore.rules:
 * 1. Custom Auth claim `admin === true`
 * 2. Presence of `/admins/{uid}` document
 * 3. Verified bootstrap owner email (`jeremycodjoe@gmail.com`, `email_verified === true`)
 *    plus optional server-only `ADMIN_EMAIL` env override (Firestore rules cannot read env vars).
 */
export async function isAdminUser(db: Firestore, user: DecodedFirebaseUser): Promise<boolean> {
  if (user.admin === true) {
    return true;
  }

  const normalizedUserEmail =
    typeof user.email === "string" ? user.email.toLowerCase() : null;
  if (normalizedUserEmail && user.email_verified === true) {
    if (normalizedUserEmail === DEFAULT_BOOTSTRAP_ADMIN_EMAIL) {
      return true;
    }
    const envAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (envAdminEmail && normalizedUserEmail === envAdminEmail) {
      return true;
    }
  }

  const adminDoc = await db.collection("admins").doc(user.uid).get();
  return adminDoc.exists;
}

function loadFirebaseAppletConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.warn("Could not read firebase-applet-config.json:", err);
  }
  return {};
}

let cachedApp: App | null = null;
let cachedInitError: string | null = null;

export function getFirebaseAdminApp(): { app: App | null; databaseId: string; error: string | null } {
  const appletConfig = loadFirebaseAppletConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || appletConfig.projectId;
  const databaseId = process.env.FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId || "(default)";

  if (cachedApp) {
    return { app: cachedApp, databaseId, error: null };
  }

  if (getApps().length > 0) {
    cachedApp = getApps()[0];
    return { app: cachedApp, databaseId, error: null };
  }

  try {
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountRaw) {
      const parsed = JSON.parse(serviceAccountRaw);
      cachedApp = initializeApp({
        credential: cert(parsed),
        projectId: projectId || parsed.project_id,
      });
      cachedInitError = null;
      return { app: cachedApp, databaseId, error: null };
    }

    const hasAdcHint = Boolean(
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.K_SERVICE ||
        process.env.CLOUD_RUN_JOB ||
        process.env.GCE_METADATA_HOST
    );

    if (!hasAdcHint) {
      cachedInitError =
        "Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.";
      return { app: null, databaseId, error: cachedInitError };
    }

    cachedApp = initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
    cachedInitError = null;
    return { app: cachedApp, databaseId, error: null };
  } catch (err: any) {
    cachedInitError = `Failed to initialize Firebase Admin SDK: ${err?.message || "Unknown error"}`;
    console.error(cachedInitError);
    return { app: null, databaseId, error: cachedInitError };
  }
}

export function getFirebaseAdminServices(): {
  auth: Auth | null;
  db: Firestore | null;
  error: string | null;
} {
  const { app, databaseId, error } = getFirebaseAdminApp();
  if (!app) {
    return { auth: null, db: null, error };
  }

  try {
    const auth = getAuth(app);
    const db = databaseId === "(default)" ? getFirestore(app) : getFirestore(app, databaseId);
    return { auth, db, error: null };
  } catch (err: any) {
    const msg = `Failed to access Firebase Admin services: ${err?.message || "Unknown error"}`;
    console.error(msg);
    return { auth: null, db: null, error: msg };
  }
}

export class FirestorePaymentStore implements PaymentStore {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async createPendingPayment(
    record: Omit<PaymentRecord, "createdAt" | "updatedAt" | "completedAt">
  ): Promise<void> {
    await this.db
      .collection("payments")
      .doc(record.stripePaymentIntentId)
      .set({
        ...record,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: null,
      });
  }

  async getPaymentById(paymentIntentId: string): Promise<PaymentRecord | null> {
    const snap = await this.db.collection("payments").doc(paymentIntentId).get();
    if (!snap.exists) {
      return null;
    }
    return snap.data() as PaymentRecord;
  }

  async isAdminUser(user: DecodedFirebaseUser): Promise<boolean> {
    return isAdminUser(this.db, user);
  }

  async processWebhookEvent(params: {
    eventId: string;
    eventType: string;
    paymentIntent: StripePaymentIntentEventData;
  }): Promise<WebhookProcessResult> {
    const { eventId, eventType, paymentIntent } = params;
    const eventRef = this.db.collection("stripe_events").doc(eventId);
    const paymentRef = this.db.collection("payments").doc(paymentIntent.id);

    return this.db.runTransaction(async (tx) => {
      const existingEvent = await tx.get(eventRef);
      if (existingEvent.exists) {
        return { outcome: "duplicate" };
      }

      if (eventType !== "payment_intent.succeeded" && eventType !== "payment_intent.payment_failed") {
        tx.set(eventRef, {
          eventId,
          type: eventType,
          paymentIntentId: paymentIntent.id,
          processedAt: FieldValue.serverTimestamp(),
        });
        return { outcome: "ignored" };
      }

      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists) {
        return { outcome: "missing_payment" };
      }

      const payment = paymentSnap.data() as PaymentRecord;
      const incomingCurrency = (paymentIntent.currency || "").toLowerCase();
      const expectedCurrency = (payment.currency || "").toLowerCase();

      if (incomingCurrency !== expectedCurrency) {
        return {
          outcome: "mismatch",
          reason: `Currency mismatch: expected ${expectedCurrency}, got ${incomingCurrency}`,
        };
      }

      if (paymentIntent.amount !== payment.amount) {
        return {
          outcome: "mismatch",
          reason: `Amount mismatch: expected ${payment.amount}, got ${paymentIntent.amount}`,
        };
      }

      if (
        eventType === "payment_intent.succeeded" &&
        typeof paymentIntent.amount_received === "number" &&
        paymentIntent.amount_received !== payment.amount
      ) {
        return {
          outcome: "mismatch",
          reason: `Amount received mismatch: expected ${payment.amount}, got ${paymentIntent.amount_received}`,
        };
      }

      if (eventType === "payment_intent.succeeded") {
        tx.update(paymentRef, {
          status: "completed",
          failureReason: null,
          lastWebhookEventId: eventId,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(eventRef, {
          eventId,
          type: eventType,
          paymentIntentId: paymentIntent.id,
          processedAt: FieldValue.serverTimestamp(),
        });
        return { outcome: "updated", status: "completed" };
      }

      // Keep completed payments immutable against late/out-of-order failure events
      if (payment.status === "completed") {
        tx.set(eventRef, {
          eventId,
          type: eventType,
          paymentIntentId: paymentIntent.id,
          processedAt: FieldValue.serverTimestamp(),
        });
        return { outcome: "updated", status: "completed" };
      }

      const failureMessage =
        paymentIntent.last_payment_error?.message || "Payment failed or was declined.";

      tx.update(paymentRef, {
        status: "failed",
        failureReason: failureMessage,
        lastWebhookEventId: eventId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(eventRef, {
        eventId,
        type: eventType,
        paymentIntentId: paymentIntent.id,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { outcome: "updated", status: "failed" };
    });
  }
}

function serializeTimestamp(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "toDate" in val && typeof (val as any).toDate === "function") {
    return (val as any).toDate().toISOString();
  }
  if (val instanceof Date) return val.toISOString();
  return null;
}

function mapAuditDoc(id: string, data: Record<string, any>): AuditRecord {
  return {
    id,
    businessName: data.businessName || "",
    industry: data.industry || "Other Service Pro",
    serviceArea: data.serviceArea || "",
    email: data.email || "",
    phone: data.phone || "",
    websiteUrl: data.websiteUrl || "",
    googleProfileUrl: data.googleProfileUrl || "",
    hasWebsite: Boolean(data.hasWebsite),
    hasGoogleProfile: Boolean(data.hasGoogleProfile),
    reviewStatus: data.reviewStatus || "pending_review",
    draftStatus: data.draftStatus || "unavailable",
    draft: data.draft || null,
    draftError: data.draftError || null,
    reviewedBy: data.reviewedBy || null,
    reviewedAt: serializeTimestamp(data.reviewedAt),
    reviewerNotes: data.reviewerNotes || "",
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

export class FirestoreAuditStore implements AuditStore {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async isAdminUser(user: DecodedFirebaseUser): Promise<boolean> {
    return isAdminUser(this.db, user);
  }

  async createAuditRequest(input: CreateAuditInput): Promise<AuditRecord> {
    const docRef = this.db.collection("audits").doc();
    const payload = {
      ...input,
      reviewStatus: "pending_review" as AuditReviewStatus,
      draftStatus: "generating" as AuditDraftStatus,
      draft: null,
      draftError: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewerNotes: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await docRef.set(payload);
    const snap = await docRef.get();
    return mapAuditDoc(docRef.id, snap.data() || payload);
  }

  async findRecentDuplicateAudit(params: {
    fingerprintKey: string;
    submissionIdKey: string | null;
    nowMs?: number;
  }): Promise<DuplicateAuditLookupResult> {
    const nowMs = params.nowMs ?? Date.now();
    if (params.submissionIdKey) {
      const sidSnap = await this.db.collection("audit_dedup").doc(params.submissionIdKey).get();
      if (sidSnap.exists) {
        const data = sidSnap.data() as {
          auditId?: string;
          fingerprintKey?: string;
          expiresAtMs?: number;
        };
        if (typeof data?.expiresAtMs === "number" && data.expiresAtMs > nowMs) {
          if (
            typeof data.fingerprintKey === "string" &&
            data.fingerprintKey !== params.fingerprintKey
          ) {
            return { status: "conflict" };
          }
          if (typeof data.auditId === "string") {
            const existing = await this.getAuditById(data.auditId);
            if (existing) {
              return { status: "duplicate", audit: existing };
            }
          }
        }
      }
    }

    const fpSnap = await this.db.collection("audit_dedup").doc(params.fingerprintKey).get();
    if (fpSnap.exists) {
      const data = fpSnap.data() as { auditId?: string; expiresAtMs?: number };
      if (
        typeof data?.auditId === "string" &&
        typeof data?.expiresAtMs === "number" &&
        data.expiresAtMs > nowMs
      ) {
        const existing = await this.getAuditById(data.auditId);
        if (existing) {
          return { status: "duplicate", audit: existing };
        }
      }
    }
    return { status: "none" };
  }

  async claimOrCreateAuditRequest(
    params: ClaimOrCreateAuditParams
  ): Promise<ClaimAuditResult> {
    const nowMs = params.nowMs ?? Date.now();
    const dedupWindowMs = params.dedupWindowMs ?? DEFAULT_AUDIT_DEDUP_WINDOW_MS;
    const fpRef = this.db.collection("audit_dedup").doc(params.fingerprintKey);
    const sidRef = params.submissionIdKey
      ? this.db.collection("audit_dedup").doc(params.submissionIdKey)
      : null;

    return this.db.runTransaction(async (tx) => {
      const fpSnap = await tx.get(fpRef);
      const sidSnap = sidRef ? await tx.get(sidRef) : null;

      if (sidSnap && sidSnap.exists) {
        const sidData = sidSnap.data() as {
          auditId?: string;
          fingerprintKey?: string;
          expiresAtMs?: number;
        };
        if (typeof sidData?.expiresAtMs === "number" && sidData.expiresAtMs > nowMs) {
          if (
            typeof sidData.fingerprintKey === "string" &&
            sidData.fingerprintKey !== params.fingerprintKey
          ) {
            return { status: "conflict" };
          }
          if (typeof sidData.auditId === "string") {
            const existingSnap = await tx.get(this.db.collection("audits").doc(sidData.auditId));
            if (existingSnap.exists) {
              return {
                status: "duplicate",
                audit: mapAuditDoc(existingSnap.id, existingSnap.data() || {}),
              };
            }
          }
        }
      }

      if (fpSnap.exists) {
        const fpData = fpSnap.data() as { auditId?: string; expiresAtMs?: number };
        if (
          typeof fpData?.auditId === "string" &&
          typeof fpData?.expiresAtMs === "number" &&
          fpData.expiresAtMs > nowMs
        ) {
          const existingSnap = await tx.get(this.db.collection("audits").doc(fpData.auditId));
          if (existingSnap.exists) {
            return {
              status: "duplicate",
              audit: mapAuditDoc(existingSnap.id, existingSnap.data() || {}),
            };
          }
        }
      }

      const docRef = this.db.collection("audits").doc();
      const nowIso = new Date(nowMs).toISOString();
      const payload = {
        ...params.input,
        reviewStatus: "pending_review" as AuditReviewStatus,
        draftStatus: "generating" as AuditDraftStatus,
        draft: null,
        draftError: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewerNotes: "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      tx.set(docRef, payload);
      const expiresAtMs = nowMs + dedupWindowMs;
      const lockPayload = {
        auditId: docRef.id,
        fingerprintKey: params.fingerprintKey,
        expiresAtMs,
        expireAt: Timestamp.fromMillis(expiresAtMs),
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(fpRef, lockPayload);
      if (sidRef) {
        tx.set(sidRef, lockPayload);
      }

      return {
        status: "created",
        audit: mapAuditDoc(docRef.id, {
          ...payload,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      };
    });
  }

  async saveAuditDraftSuccess(
    auditId: string,
    draft: PreliminaryAuditDraft
  ): Promise<AuditRecord | null> {
    const docRef = this.db.collection("audits").doc(auditId);
    const snap = await docRef.get();
    if (!snap.exists) return null;

    await docRef.update({
      draft,
      draftStatus: "ready",
      draftError: null,
      reviewStatus: "pending_review",
      updatedAt: FieldValue.serverTimestamp(),
    });
    const updated = await docRef.get();
    return mapAuditDoc(docRef.id, updated.data() || {});
  }

  async saveAuditDraftFailure(
    auditId: string,
    draftStatus: Extract<AuditDraftStatus, "unavailable" | "failed">,
    reason: string
  ): Promise<AuditRecord | null> {
    const docRef = this.db.collection("audits").doc(auditId);
    const snap = await docRef.get();
    if (!snap.exists) return null;

    // Clear any previous draft so stale output is never presented as the new result
    await docRef.update({
      draft: null,
      draftStatus,
      draftError: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const updated = await docRef.get();
    return mapAuditDoc(docRef.id, updated.data() || {});
  }

  async listAudits(limit = 50): Promise<AuditRecord[]> {
    const snap = await this.db
      .collection("audits")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => mapAuditDoc(doc.id, doc.data()));
  }

  async getAuditById(auditId: string): Promise<AuditRecord | null> {
    const snap = await this.db.collection("audits").doc(auditId).get();
    if (!snap.exists) return null;
    return mapAuditDoc(snap.id, snap.data() || {});
  }

  async updateAuditReview(
    auditId: string,
    params: {
      reviewStatus: AuditReviewStatus;
      reviewerNotes: string;
      reviewedBy: string;
    }
  ): Promise<AuditRecord | null> {
    const docRef = this.db.collection("audits").doc(auditId);
    const snap = await docRef.get();
    if (!snap.exists) return null;

    await docRef.update({
      reviewStatus: params.reviewStatus,
      reviewerNotes: params.reviewerNotes,
      reviewedBy: params.reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const updated = await docRef.get();
    return mapAuditDoc(docRef.id, updated.data() || {});
  }
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function deleteExpiredFromCollection(
  db: Firestore,
  collectionName: string,
  cutoffTimestamp: Timestamp,
  batchLimit: number
): Promise<number> {
  const snap = await db
    .collection(collectionName)
    .where("expireAt", "<=", cutoffTimestamp)
    .limit(batchLimit)
    .get();
  if (!snap || snap.empty || !Array.isArray(snap.docs) || snap.docs.length === 0) {
    return 0;
  }
  if (typeof (db as any).batch === "function") {
    const batch = (db as any).batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  } else {
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  return snap.docs.length;
}

export async function cleanupExpiredAuditRecords(
  db: Firestore,
  nowMs = Date.now(),
  batchLimit = 200
): Promise<{ rateLimitsDeleted: number; dedupDeleted: number; usageDeleted: number }> {
  const cutoff = Timestamp.fromMillis(nowMs);
  const [rateLimitsDeleted, dedupDeleted, usageDeleted] = await Promise.all([
    deleteExpiredFromCollection(db, "audit_rate_limits", cutoff, batchLimit),
    deleteExpiredFromCollection(db, "audit_dedup", cutoff, batchLimit),
    deleteExpiredFromCollection(db, "audit_usage", cutoff, batchLimit),
  ]);
  return { rateLimitsDeleted, dedupDeleted, usageDeleted };
}

export class FirestoreAuditAbuseGuard implements AuditAbuseGuard {
  private db: Firestore;
  private ipWindowMs: number;
  private maxPerIp: number;
  private emailWindowMs: number;
  private maxPerEmail: number;
  private adminRegenWindowMs: number;
  private maxRegenPerAdmin: number;
  private maxRegenPerAudit: number;
  private maxDailyAiDrafts: number;
  private usageRetentionDays: number;
  private now: () => number;
  private lastCleanupMs = 0;

  constructor(
    db: Firestore,
    options?: {
      ipWindowMs?: number;
      maxPerIp?: number;
      emailWindowMs?: number;
      maxPerEmail?: number;
      adminRegenWindowMs?: number;
      maxRegenPerAdmin?: number;
      maxRegenPerAudit?: number;
      maxDailyAiDrafts?: number;
      usageRetentionDays?: number;
      now?: () => number;
    }
  ) {
    this.db = db;
    this.ipWindowMs = options?.ipWindowMs ?? 15 * 60 * 1000;
    this.maxPerIp =
      options?.maxPerIp ??
      parsePositiveIntEnv(process.env.AUDIT_RATE_LIMIT_MAX_PER_IP, 5, 1, 100);
    this.emailWindowMs = options?.emailWindowMs ?? 60 * 60 * 1000;
    this.maxPerEmail =
      options?.maxPerEmail ??
      parsePositiveIntEnv(process.env.AUDIT_RATE_LIMIT_MAX_PER_EMAIL, 2, 1, 50);
    this.adminRegenWindowMs = options?.adminRegenWindowMs ?? DEFAULT_ADMIN_REGEN_WINDOW_MS;
    this.maxRegenPerAdmin =
      options?.maxRegenPerAdmin ??
      parsePositiveIntEnv(
        process.env.AUDIT_ADMIN_REGEN_MAX_PER_ADMIN,
        DEFAULT_ADMIN_REGEN_MAX_PER_ADMIN,
        1,
        200
      );
    this.maxRegenPerAudit =
      options?.maxRegenPerAudit ??
      parsePositiveIntEnv(
        process.env.AUDIT_ADMIN_REGEN_MAX_PER_AUDIT,
        DEFAULT_ADMIN_REGEN_MAX_PER_AUDIT,
        1,
        50
      );
    this.maxDailyAiDrafts =
      options?.maxDailyAiDrafts ??
      parsePositiveIntEnv(
        process.env.AUDIT_DAILY_AI_LIMIT,
        DEFAULT_AUDIT_DAILY_AI_LIMIT,
        1,
        10_000
      );
    this.usageRetentionDays =
      options?.usageRetentionDays ??
      parsePositiveIntEnv(
        process.env.AUDIT_USAGE_RETENTION_DAYS,
        DEFAULT_AUDIT_USAGE_RETENTION_DAYS,
        1,
        365
      );
    this.now = options?.now ?? (() => Date.now());
  }

  private maybeScheduleCleanup(currentTime: number): void {
    // Opportunistic in-process sweep at most once per 15 minutes (complements native Firestore TTL)
    if (currentTime - this.lastCleanupMs < 15 * 60 * 1000) {
      return;
    }
    this.lastCleanupMs = currentTime;
    cleanupExpiredAuditRecords(this.db, currentTime).catch(() => {
      // Non-fatal: Firestore TTL policy also enforces background deletion
    });
  }

  async cleanupExpiredRecords(nowMs?: number) {
    return cleanupExpiredAuditRecords(this.db, nowMs ?? this.now());
  }

  async checkRateLimit(params: { clientIp: string; email: string }): Promise<AbuseCheckResult> {
    const currentTime = this.now();
    this.maybeScheduleCleanup(currentTime);
    const ipKey = hashAbuseKey("ip", params.clientIp || "unknown");
    const emailKey = hashAbuseKey("email", params.email);
    const ipRef = this.db.collection("audit_rate_limits").doc(ipKey);
    const emailRef = this.db.collection("audit_rate_limits").doc(emailKey);

    return this.db.runTransaction(async (tx) => {
      const [ipSnap, emailSnap] = await Promise.all([tx.get(ipRef), tx.get(emailRef)]);

      const ipCutoff = currentTime - this.ipWindowMs;
      const emailCutoff = currentTime - this.emailWindowMs;

      const rawIpTs = ipSnap.exists && Array.isArray(ipSnap.data()?.timestamps)
        ? (ipSnap.data()!.timestamps as unknown[])
        : [];
      const ipTimestamps = rawIpTs.filter(
        (ts): ts is number => typeof ts === "number" && ts > ipCutoff
      );

      if (ipTimestamps.length >= this.maxPerIp) {
        const oldest = ipTimestamps[0] ?? currentTime;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldest + this.ipWindowMs - currentTime) / 1000)
        );
        return {
          allowed: false,
          retryAfterSeconds,
          reason: "Too many audit requests from this IP. Please wait before trying again.",
        };
      }

      const rawEmailTs = emailSnap.exists && Array.isArray(emailSnap.data()?.timestamps)
        ? (emailSnap.data()!.timestamps as unknown[])
        : [];
      const emailTimestamps = rawEmailTs.filter(
        (ts): ts is number => typeof ts === "number" && ts > emailCutoff
      );

      if (emailTimestamps.length >= this.maxPerEmail) {
        const oldest = emailTimestamps[0] ?? currentTime;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldest + this.emailWindowMs - currentTime) / 1000)
        );
        return {
          allowed: false,
          retryAfterSeconds,
          reason:
            "An audit request for this email address was already submitted recently. Please wait before submitting another.",
        };
      }

      ipTimestamps.push(currentTime);
      emailTimestamps.push(currentTime);

      tx.set(ipRef, {
        timestamps: ipTimestamps,
        expireAt: Timestamp.fromMillis(currentTime + this.ipWindowMs),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(emailRef, {
        timestamps: emailTimestamps,
        expireAt: Timestamp.fromMillis(currentTime + this.emailWindowMs),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  async checkAdminRegenerateLimit(params: {
    adminUid: string;
    auditId: string;
  }): Promise<AbuseCheckResult> {
    const currentTime = this.now();
    this.maybeScheduleCleanup(currentTime);
    const adminKey = hashAbuseKey("admin_regen", params.adminUid || "unknown");
    const auditKey = hashAbuseKey("audit_regen", params.auditId);
    const adminRef = this.db.collection("audit_rate_limits").doc(adminKey);
    const auditRef = this.db.collection("audit_rate_limits").doc(auditKey);

    return this.db.runTransaction(async (tx) => {
      const [adminSnap, auditSnap] = await Promise.all([tx.get(adminRef), tx.get(auditRef)]);
      const cutoff = currentTime - this.adminRegenWindowMs;

      const rawAdminTs = adminSnap.exists && Array.isArray(adminSnap.data()?.timestamps)
        ? (adminSnap.data()!.timestamps as unknown[])
        : [];
      const adminTimestamps = rawAdminTs.filter(
        (ts): ts is number => typeof ts === "number" && ts > cutoff
      );

      if (adminTimestamps.length >= this.maxRegenPerAdmin) {
        const oldest = adminTimestamps[0] ?? currentTime;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldest + this.adminRegenWindowMs - currentTime) / 1000)
        );
        return {
          allowed: false,
          retryAfterSeconds,
          reason: "Too many draft regenerations triggered by this admin account. Please wait before retrying.",
        };
      }

      const rawAuditTs = auditSnap.exists && Array.isArray(auditSnap.data()?.timestamps)
        ? (auditSnap.data()!.timestamps as unknown[])
        : [];
      const auditTimestamps = rawAuditTs.filter(
        (ts): ts is number => typeof ts === "number" && ts > cutoff
      );

      if (auditTimestamps.length >= this.maxRegenPerAudit) {
        const oldest = auditTimestamps[0] ?? currentTime;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldest + this.adminRegenWindowMs - currentTime) / 1000)
        );
        return {
          allowed: false,
          retryAfterSeconds,
          reason: "This audit draft was regenerated multiple times recently. Please wait before regenerating again.",
        };
      }

      adminTimestamps.push(currentTime);
      auditTimestamps.push(currentTime);
      const expireAt = Timestamp.fromMillis(currentTime + this.adminRegenWindowMs);

      tx.set(adminRef, {
        timestamps: adminTimestamps,
        expireAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(auditRef, {
        timestamps: auditTimestamps,
        expireAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  async consumeDailyAiBudget(): Promise<{ allowed: boolean; remaining: number }> {
    const currentTime = this.now();
    const d = new Date(currentTime);
    const dateKey = d.toISOString().slice(0, 10);
    const usageRef = this.db.collection("audit_usage").doc(dateKey);
    const endOfUtcDayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
    const expireAt = Timestamp.fromMillis(
      endOfUtcDayMs + this.usageRetentionDays * 24 * 60 * 60 * 1000
    );

    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const currentCount =
        snap.exists && typeof snap.data()?.count === "number" ? (snap.data()!.count as number) : 0;

      if (currentCount >= this.maxDailyAiDrafts) {
        return { allowed: false, remaining: 0 };
      }

      const nextCount = currentCount + 1;
      tx.set(usageRef, {
        dateKey,
        count: nextCount,
        expireAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        allowed: true,
        remaining: Math.max(0, this.maxDailyAiDrafts - nextCount),
      };
    });
  }
}
