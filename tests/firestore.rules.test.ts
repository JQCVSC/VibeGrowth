import fs from "fs";
import path from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-vibegrowth";
const RULES_PATH = path.join(process.cwd(), "firestore.rules");

function parseEmulatorHost(): { host?: string; port?: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) return {};
  const lastColon = raw.lastIndexOf(":");
  if (lastColon === -1) return { host: raw };
  const host = raw.slice(0, lastColon);
  const port = Number(raw.slice(lastColon + 1));
  return Number.isFinite(port) ? { host, port } : { host };
}

describe("Firestore Security Rules (Emulator)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const emulatorEndpoint = parseEmulatorHost();
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(RULES_PATH, "utf8"),
        ...emulatorEndpoint,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, "admins", "allowlisted_admin_uid"), {
        email: "strategist@vibegrowth.agency",
      });

      await setDoc(doc(db, "audits", "audit_1"), {
        businessName: "Desert Sun Roofing",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "owner@desertsun.example",
        reviewStatus: "pending_review",
        draftStatus: "ready",
        draft: {
          label: "PRELIMINARY RECOMMENDATIONS — NOT A VERIFIED LIVE AUDIT",
          executiveSummary: "Private preliminary recommendations.",
        },
        createdAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "payments", "pi_customer_1"), {
        userId: "customer_1",
        amount: 19900,
        currency: "usd",
        planName: "The Activation",
        productIds: ["activation"],
        status: "completed",
        stripePaymentIntentId: "pi_customer_1",
        createdAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "payments", "pi_customer_2"), {
        userId: "customer_2",
        amount: 4900,
        currency: "usd",
        planName: "Gap Report",
        productIds: ["gap-report"],
        status: "pending",
        stripePaymentIntentId: "pi_customer_2",
        createdAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "leads", "lead_1"), {
        name: "Jane Contractor",
        email: "jane@example.com",
        brand: "Jane HVAC",
        service: "Google Maps Dominance",
        message: "Interested in ranking in Queen Creek.",
        createdAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "users", "customer_1"), {
        displayName: "Customer One",
        email: "customer1@example.com",
        updatedAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "users", "customer_2"), {
        displayName: "Customer Two",
        email: "customer2@example.com",
        updatedAt: new Date("2026-11-15T12:00:00.000Z"),
      });

      await setDoc(doc(db, "stripe_events", "evt_1"), {
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_customer_1",
      });
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  describe("audits collection", () => {
    it("denies unauthenticated and non-admin reads and writes on audit drafts", async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      const customerDb = testEnv
        .authenticatedContext("customer_1", {
          email: "customer1@example.com",
          email_verified: true,
        })
        .firestore();
      const unverifiedBootstrapSpoofDb = testEnv
        .authenticatedContext("spoof_uid", {
          email: "jeremycodjoe@gmail.com",
          email_verified: false,
        })
        .firestore();

      for (const db of [unauthDb, customerDb, unverifiedBootstrapSpoofDb]) {
        await assertFails(getDoc(doc(db, "audits", "audit_1")));
        await assertFails(getDocs(collection(db, "audits")));
        await assertFails(
          setDoc(doc(db, "audits", "audit_new"), {
            businessName: "Spoof Biz",
            reviewStatus: "approved",
          })
        );
        await assertFails(updateDoc(doc(db, "audits", "audit_1"), { reviewStatus: "approved" }));
        await assertFails(deleteDoc(doc(db, "audits", "audit_1")));
      }
    });

    it("allows authorized admins to read audits while keeping all client audit writes server-only", async () => {
      const claimAdminDb = testEnv
        .authenticatedContext("claim_admin", {
          admin: true,
          email: "ops@vibegrowth.agency",
          email_verified: true,
        })
        .firestore();
      const allowlistedAdminDb = testEnv
        .authenticatedContext("allowlisted_admin_uid", {
          email: "strategist@vibegrowth.agency",
          email_verified: true,
        })
        .firestore();
      const bootstrapOwnerDb = testEnv
        .authenticatedContext("owner_uid", {
          email: "JeremyCodjoe@gmail.com",
          email_verified: true,
        })
        .firestore();

      for (const adminDb of [claimAdminDb, allowlistedAdminDb, bootstrapOwnerDb]) {
        await assertSucceeds(getDoc(doc(adminDb, "audits", "audit_1")));
        await assertSucceeds(getDocs(collection(adminDb, "audits")));
        await assertFails(
          setDoc(doc(adminDb, "audits", "audit_client_write"), {
            businessName: "Client Write Blocked",
          })
        );
        await assertFails(
          updateDoc(doc(adminDb, "audits", "audit_1"), { reviewStatus: "approved" })
        );
        await assertFails(deleteDoc(doc(adminDb, "audits", "audit_1")));
      }
    });
  });

  describe("payments collection", () => {
    it("allows customers to read only their own payment records and denies all client writes", async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      const customer1Db = testEnv
        .authenticatedContext("customer_1", {
          email: "customer1@example.com",
          email_verified: true,
        })
        .firestore();

      await assertFails(getDoc(doc(unauthDb, "payments", "pi_customer_1")));
      await assertSucceeds(getDoc(doc(customer1Db, "payments", "pi_customer_1")));
      await assertSucceeds(
        getDocs(query(collection(customer1Db, "payments"), where("userId", "==", "customer_1")))
      );

      // Cannot read another customer's payment or list all payments
      await assertFails(getDoc(doc(customer1Db, "payments", "pi_customer_2")));
      await assertFails(getDocs(collection(customer1Db, "payments")));

      // Cannot create, update, or delete payment records from the browser
      await assertFails(
        setDoc(doc(customer1Db, "payments", "pi_forged"), {
          userId: "customer_1",
          amount: 1,
          currency: "usd",
          status: "completed",
        })
      );
      await assertFails(
        updateDoc(doc(customer1Db, "payments", "pi_customer_1"), { status: "failed" })
      );
      await assertFails(deleteDoc(doc(customer1Db, "payments", "pi_customer_1")));
    });

    it("allows admins to read payments while denying admin client writes", async () => {
      const adminDb = testEnv
        .authenticatedContext("claim_admin", { admin: true })
        .firestore();

      await assertSucceeds(getDoc(doc(adminDb, "payments", "pi_customer_2")));
      await assertSucceeds(getDocs(collection(adminDb, "payments")));
      await assertFails(
        updateDoc(doc(adminDb, "payments", "pi_customer_2"), { status: "completed" })
      );
      await assertFails(deleteDoc(doc(adminDb, "payments", "pi_customer_2")));
    });
  });

  describe("leads collection", () => {
    it("preserves public lead creation with validation while restricting reads/updates/deletes to admins", async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      const customerDb = testEnv
        .authenticatedContext("customer_1", {
          email: "customer1@example.com",
          email_verified: true,
        })
        .firestore();
      const adminDb = testEnv
        .authenticatedContext("claim_admin", { admin: true })
        .firestore();

      // Valid public submission succeeds (existing Contact.tsx workflow)
      await assertSucceeds(
        setDoc(doc(unauthDb, "leads", "lead_valid_public"), {
          name: "Local Owner",
          email: "owner@localroofing.com",
          brand: "Local Roofing LLC",
          service: "Google Maps Dominance",
          message: "Need help with Maps ranking.",
          createdAt: serverTimestamp(),
        })
      );

      // Invalid payloads (extra shadow field, invalid service, or client timestamp) fail
      await assertFails(
        setDoc(doc(unauthDb, "leads", "lead_bad_field"), {
          name: "Local Owner",
          email: "owner@localroofing.com",
          service: "Google Maps Dominance",
          isAdmin: true,
          createdAt: serverTimestamp(),
        })
      );
      await assertFails(
        setDoc(doc(unauthDb, "leads", "lead_bad_service"), {
          name: "Local Owner",
          email: "owner@localroofing.com",
          service: "Unauthorized Service",
          createdAt: serverTimestamp(),
        })
      );

      // Non-admins cannot read, update, or delete leads
      await assertFails(getDoc(doc(unauthDb, "leads", "lead_1")));
      await assertFails(getDocs(collection(customerDb, "leads")));
      await assertFails(updateDoc(doc(customerDb, "leads", "lead_1"), { name: "Tampered" }));
      await assertFails(deleteDoc(doc(customerDb, "leads", "lead_1")));

      // Admins can read and delete leads
      await assertSucceeds(getDoc(doc(adminDb, "leads", "lead_1")));
      await assertSucceeds(getDocs(collection(adminDb, "leads")));
      await assertSucceeds(deleteDoc(doc(adminDb, "leads", "lead_1")));
    });
  });

  describe("users, admins, and stripe_events collections", () => {
    it("enforces owner-only verified access on users and admin list/delete access", async () => {
      const customer1VerifiedDb = testEnv
        .authenticatedContext("customer_1", {
          email: "customer1@example.com",
          email_verified: true,
        })
        .firestore();
      const customer1UnverifiedDb = testEnv
        .authenticatedContext("customer_1", {
          email: "customer1@example.com",
          email_verified: false,
        })
        .firestore();
      const adminDb = testEnv
        .authenticatedContext("claim_admin", { admin: true })
        .firestore();

      await assertSucceeds(getDoc(doc(customer1VerifiedDb, "users", "customer_1")));
      await assertSucceeds(
        setDoc(doc(customer1VerifiedDb, "users", "customer_1"), {
          displayName: "Updated Name",
          email: "customer1@example.com",
          updatedAt: serverTimestamp(),
        })
      );

      // Unverified users cannot write; verified users cannot access others or list users
      await assertFails(
        setDoc(doc(customer1UnverifiedDb, "users", "customer_1"), {
          displayName: "Blocked",
          email: "customer1@example.com",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(getDoc(doc(customer1VerifiedDb, "users", "customer_2")));
      await assertFails(getDocs(collection(customer1VerifiedDb, "users")));
      await assertFails(deleteDoc(doc(customer1VerifiedDb, "users", "customer_1")));

      // Admins can list and delete user docs
      await assertSucceeds(getDocs(collection(adminDb, "users")));
      await assertSucceeds(deleteDoc(doc(adminDb, "users", "customer_2")));
    });

    it("denies all client reads and writes to admins and stripe_events", async () => {
      const customerDb = testEnv
        .authenticatedContext("customer_1", { email_verified: true })
        .firestore();
      const adminDb = testEnv
        .authenticatedContext("claim_admin", { admin: true })
        .firestore();

      for (const db of [customerDb, adminDb]) {
        await assertFails(getDoc(doc(db, "admins", "allowlisted_admin_uid")));
        await assertFails(getDocs(collection(db, "admins")));
        await assertFails(setDoc(doc(db, "admins", "customer_1"), { email: "hack@example.com" }));
        await assertFails(deleteDoc(doc(db, "admins", "allowlisted_admin_uid")));

        await assertFails(getDoc(doc(db, "stripe_events", "evt_1")));
        await assertFails(getDocs(collection(db, "stripe_events")));
        await assertFails(setDoc(doc(db, "stripe_events", "evt_2"), { eventId: "evt_2" }));
        await assertFails(deleteDoc(doc(db, "stripe_events", "evt_1")));

        for (const col of ["audit_rate_limits", "audit_usage", "audit_dedup"]) {
          await assertFails(getDoc(doc(db, col, "doc_1")));
          await assertFails(getDocs(collection(db, col)));
          await assertFails(setDoc(doc(db, col, "doc_2"), { count: 1 }));
          await assertFails(deleteDoc(doc(db, col, "doc_1")));
        }
      }
    });
  });
});
