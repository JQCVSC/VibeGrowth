import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";
import { FieldValue, Firestore, getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

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

const DEFAULT_BOOTSTRAP_ADMIN_EMAIL = "jeremycodjoe@gmail.com";

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
    if (user.admin === true) {
      return true;
    }

    const adminEmail = (process.env.ADMIN_EMAIL || DEFAULT_BOOTSTRAP_ADMIN_EMAIL).toLowerCase();
    if (user.email && user.email.toLowerCase() === adminEmail && user.email_verified === true) {
      return true;
    }

    const adminDoc = await this.db.collection("admins").doc(user.uid).get();
    return adminDoc.exists;
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
