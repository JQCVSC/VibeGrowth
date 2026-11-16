import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, FirebaseAuthLike, StripeLike } from "../server/app.js";
import {
  DecodedFirebaseUser,
  PaymentRecord,
  PaymentStatus,
  PaymentStore,
  StripePaymentIntentEventData,
  WebhookProcessResult,
} from "../server/firebaseAdmin.js";

class InMemoryPaymentStore implements PaymentStore {
  payments = new Map<string, PaymentRecord>();
  processedEvents = new Set<string>();
  adminUids = new Set<string>();

  async createPendingPayment(
    record: Omit<PaymentRecord, "createdAt" | "updatedAt" | "completedAt">
  ): Promise<void> {
    this.payments.set(record.stripePaymentIntentId, {
      ...record,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  async getPaymentById(paymentIntentId: string): Promise<PaymentRecord | null> {
    return this.payments.get(paymentIntentId) || null;
  }

  async isAdminUser(user: DecodedFirebaseUser): Promise<boolean> {
    return (
      user.admin === true ||
      this.adminUids.has(user.uid) ||
      (user.email === "jeremycodjoe@gmail.com" && user.email_verified === true)
    );
  }

  async processWebhookEvent(params: {
    eventId: string;
    eventType: string;
    paymentIntent: StripePaymentIntentEventData;
  }): Promise<WebhookProcessResult> {
    const { eventId, eventType, paymentIntent } = params;
    if (this.processedEvents.has(eventId)) {
      return { outcome: "duplicate" };
    }

    if (eventType !== "payment_intent.succeeded" && eventType !== "payment_intent.payment_failed") {
      this.processedEvents.add(eventId);
      return { outcome: "ignored" };
    }

    const existing = this.payments.get(paymentIntent.id);
    if (!existing) {
      return { outcome: "missing_payment" };
    }

    if ((paymentIntent.currency || "").toLowerCase() !== existing.currency.toLowerCase()) {
      return {
        outcome: "mismatch",
        reason: `Currency mismatch: expected ${existing.currency}, got ${paymentIntent.currency}`,
      };
    }

    if (paymentIntent.amount !== existing.amount) {
      return {
        outcome: "mismatch",
        reason: `Amount mismatch: expected ${existing.amount}, got ${paymentIntent.amount}`,
      };
    }

    if (
      eventType === "payment_intent.succeeded" &&
      typeof paymentIntent.amount_received === "number" &&
      paymentIntent.amount_received !== existing.amount
    ) {
      return {
        outcome: "mismatch",
        reason: `Amount received mismatch: expected ${existing.amount}, got ${paymentIntent.amount_received}`,
      };
    }

    if (eventType === "payment_intent.succeeded") {
      this.payments.set(paymentIntent.id, {
        ...existing,
        status: "completed",
        failureReason: null,
        lastWebhookEventId: eventId,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      this.processedEvents.add(eventId);
      return { outcome: "updated", status: "completed" };
    }

    if (existing.status === "completed") {
      this.processedEvents.add(eventId);
      return { outcome: "updated", status: "completed" };
    }

    const nextStatus: PaymentStatus = "failed";
    this.payments.set(paymentIntent.id, {
      ...existing,
      status: nextStatus,
      failureReason: paymentIntent.last_payment_error?.message || "Payment failed or was declined.",
      lastWebhookEventId: eventId,
      updatedAt: new Date().toISOString(),
    });
    this.processedEvents.add(eventId);
    return { outcome: "updated", status: nextStatus };
  }
}

const TEST_WEBHOOK_SECRET = "whsec_test_secret_12345";

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function createMockStripe(): {
  stripe: StripeLike;
  createSpy: ReturnType<typeof vi.fn>;
} {
  let counter = 0;
  const createSpy = vi.fn(async (params: any) => {
    counter += 1;
    return {
      id: `pi_test_${counter}`,
      client_secret: `pi_test_${counter}_secret_abc`,
      amount: params.amount,
      currency: params.currency,
    };
  });

  const stripe: StripeLike = {
    paymentIntents: {
      create: createSpy,
    },
    webhooks: {
      constructEvent(payload: Buffer | string, header: string, secret: string) {
        const raw = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
        const parts = Object.fromEntries(
          header.split(",").map((kv) => {
            const [k, v] = kv.split("=");
            return [k, v];
          })
        );
        if (!parts.t || !parts.v1) {
          throw new Error("Invalid stripe-signature header");
        }
        const expected = crypto
          .createHmac("sha256", secret)
          .update(`${parts.t}.${raw}`)
          .digest("hex");
        if (parts.v1 !== expected) {
          throw new Error("Signature mismatch");
        }
        return JSON.parse(raw);
      },
    },
  };

  return { stripe, createSpy };
}

describe("Payment security, Stripe webhooks, and production SPA server", () => {
  let store: InMemoryPaymentStore;
  let createSpy: ReturnType<typeof vi.fn>;
  let app: Awaited<ReturnType<typeof createApp>>;

  const mockAuth: FirebaseAuthLike = {
    async verifyIdToken(token: string) {
      if (token === "valid-user-1") {
        return { uid: "user_1", email: "contractor@example.com", email_verified: true };
      }
      if (token === "valid-user-2") {
        return { uid: "user_2", email: "other@example.com", email_verified: true };
      }
      throw new Error("Invalid token");
    },
  };

  beforeEach(async () => {
    store = new InMemoryPaymentStore();
    const mockStripe = createMockStripe();
    createSpy = mockStripe.createSpy;

    app = await createApp({
      getStripe: () => mockStripe.stripe,
      getStripeWebhookSecret: () => TEST_WEBHOOK_SECRET,
      getAuth: () => ({ auth: mockAuth, error: null }),
      getPaymentStore: () => ({ store, error: null }),
      mountFrontend: false,
    });
  });

  it("rejects unauthenticated checkout requests with 401", async () => {
    const res = await request(app)
      .post("/api/create-payment-intent")
      .send({ productIds: ["activation"] });

    expect(res.status).toBe(401);
    expect(createSpy).not.toHaveBeenCalled();
    expect(store.payments.size).toBe(0);
  });

  it("rejects invalid Firebase ID tokens with 401", async () => {
    const res = await request(app)
      .post("/api/create-payment-intent")
      .set("Authorization", "Bearer forged-token")
      .send({ productIds: ["activation"] });

    expect(res.status).toBe(401);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("allows normal authenticated checkout for Activation ($199) and creates pending server record", async () => {
    const res = await request(app)
      .post("/api/create-payment-intent")
      .set("Authorization", "Bearer valid-user-1")
      .send({ productIds: ["activation"] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentIntentId: "pi_test_1",
      clientSecret: "pi_test_1_secret_abc",
      amount: 19900,
      currency: "usd",
      planName: "The Activation",
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 19900,
        currency: "usd",
        metadata: expect.objectContaining({
          userId: "user_1",
          productIds: "activation",
        }),
      })
    );

    const saved = await store.getPaymentById("pi_test_1");
    expect(saved).toMatchObject({
      userId: "user_1",
      amount: 19900,
      currency: "usd",
      status: "pending",
    });
  });

  it("calculates multi-addon totals server-side and ignores browser-tampered amount and currency", async () => {
    const res = await request(app)
      .post("/api/create-payment-intent")
      .set("Authorization", "Bearer valid-user-1")
      .send({
        productIds: ["gap-report", "review-pack"], // $49 + $29 = $78 (7800 cents)
        amount: 1,
        currency: "eur",
        userId: "spoofed_uid",
        status: "completed",
      });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(7800);
    expect(res.body.currency).toBe("usd");

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 7800,
        currency: "usd",
        metadata: expect.objectContaining({
          userId: "user_1",
        }),
      })
    );

    const saved = await store.getPaymentById("pi_test_1");
    expect(saved?.amount).toBe(7800);
    expect(saved?.currency).toBe("usd");
    expect(saved?.userId).toBe("user_1");
    expect(saved?.status).toBe("pending");
  });

  it("rejects empty carts, unknown products, duplicates, and invalid plan+addon combinations", async () => {
    const cases = [
      { productIds: [] },
      { productIds: ["does-not-exist"] },
      { productIds: ["tier1"] }, // parent menu is not directly purchasable
      { productIds: ["gap-report", "gap-report"] },
      { productIds: ["activation", "gap-report"] },
      { amount: 100 }, // missing productIds
    ];

    for (const payload of cases) {
      const res = await request(app)
        .post("/api/create-payment-intent")
        .set("Authorization", "Bearer valid-user-1")
        .send(payload);
      expect(res.status).toBe(400);
    }
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects Stripe webhooks with missing or invalid signatures", async () => {
    const payload = JSON.stringify({
      id: "evt_invalid_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_test_1", amount: 19900, currency: "usd" } },
    });

    const missingSigRes = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .send(payload);
    expect(missingSigRes.status).toBe(400);

    const badSigRes = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=deadbeef")
      .send(payload);
    expect(badSigRes.status).toBe(400);
  });

  it("completes payment only via verified webhook and processes duplicate events idempotently", async () => {
    await request(app)
      .post("/api/create-payment-intent")
      .set("Authorization", "Bearer valid-user-1")
      .send({ productIds: ["activation"] });

    // Before webhook: status endpoint MUST report pending (even if user navigates to success page)
    const beforeRes = await request(app)
      .get("/api/payments/pi_test_1")
      .set("Authorization", "Bearer valid-user-1");
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.status).toBe("pending");

    const eventPayload = JSON.stringify({
      id: "evt_success_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test_1",
          amount: 19900,
          amount_received: 19900,
          currency: "usd",
        },
      },
    });
    const sig = signStripePayload(eventPayload, TEST_WEBHOOK_SECRET);

    const firstWebhook = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", sig)
      .send(eventPayload);

    expect(firstWebhook.status).toBe(200);
    expect(firstWebhook.body).toEqual({ received: true, status: "completed" });

    // Duplicate delivery of the exact same Stripe event
    const duplicateWebhook = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", sig)
      .send(eventPayload);

    expect(duplicateWebhook.status).toBe(200);
    expect(duplicateWebhook.body).toEqual({ received: true, duplicate: true });

    // Verified status endpoint now returns completed
    const afterRes = await request(app)
      .get("/api/payments/pi_test_1")
      .set("Authorization", "Bearer valid-user-1");
    expect(afterRes.status).toBe(200);
    expect(afterRes.body).toMatchObject({
      paymentIntentId: "pi_test_1",
      status: "completed",
      amount: 19900,
      currency: "usd",
    });

    // Another user cannot view this payment record
    const otherUserRes = await request(app)
      .get("/api/payments/pi_test_1")
      .set("Authorization", "Bearer valid-user-2");
    expect(otherUserRes.status).toBe(403);
  });

  it("handles failed PaymentIntent webhooks and rejects amount/currency mismatches", async () => {
    await request(app)
      .post("/api/create-payment-intent")
      .set("Authorization", "Bearer valid-user-1")
      .send({ productIds: ["local-pulse"] }); // $29 = 2900 cents

    // Attempted webhook with mismatched amount -> rejected, payment remains pending
    const mismatchPayload = JSON.stringify({
      id: "evt_mismatch_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test_1",
          amount: 100,
          amount_received: 100,
          currency: "usd",
        },
      },
    });
    const mismatchRes = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signStripePayload(mismatchPayload, TEST_WEBHOOK_SECRET))
      .send(mismatchPayload);
    expect(mismatchRes.status).toBe(400);
    expect((await store.getPaymentById("pi_test_1"))?.status).toBe("pending");

    // Failed PaymentIntent webhook -> marks failed with reason
    const failedPayload = JSON.stringify({
      id: "evt_failed_1",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_test_1",
          amount: 2900,
          currency: "usd",
          last_payment_error: { message: "Your card was declined." },
        },
      },
    });
    const failedRes = await request(app)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signStripePayload(failedPayload, TEST_WEBHOOK_SECRET))
      .send(failedPayload);

    expect(failedRes.status).toBe(200);
    expect(failedRes.body).toEqual({ received: true, status: "failed" });

    const statusRes = await request(app)
      .get("/api/payments/pi_test_1")
      .set("Authorization", "Bearer valid-user-1");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      status: "failed",
      failureReason: "Your card was declined.",
    });
  });

  describe("Production SPA serving and client-route fallback", () => {
    const tempDist = fs.mkdtempSync(path.join(os.tmpdir(), "vibegrowth-dist-"));
    fs.writeFileSync(
      path.join(tempDist, "index.html"),
      "<!doctype html><html><body><div id='root'>SPA_OK</div></body></html>"
    );

    afterAll(() => {
      fs.rmSync(tempDist, { recursive: true, force: true });
    });

    it("serves built SPA index.html for direct client route visits and JSON 404 for unknown /api routes", async () => {
      const prodApp = await createApp({
        mountFrontend: true,
        isProduction: true,
        distPath: tempDist,
      });

      const directRouteRes = await request(prodApp).get("/payment-success?payment_intent=pi_123");
      expect(directRouteRes.status).toBe(200);
      expect(directRouteRes.text).toContain("SPA_OK");

      const unknownApiRes = await request(prodApp).get("/api/nonexistent");
      expect(unknownApiRes.status).toBe(404);
      expect(unknownApiRes.body).toEqual({ error: "API route not found." });
    });
  });
});
