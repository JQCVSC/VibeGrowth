import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, FirebaseAuthLike } from "../server/app.js";
import {
  AuditAbuseGuard,
  buildAuditDraftPrompt,
  createInMemoryAuditAbuseGuard,
  createIpRateLimiter,
  createVertexAuditDraftGenerator,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_VERTEX_LOCATION,
  DEFAULT_VERTEX_TIMEOUT_MS,
  sanitizeAuditInputForGemini,
  VertexDraftGenerator,
} from "../server/auditService.js";
import {
  AuditStore,
  ClaimAuditResult,
  ClaimOrCreateAuditParams,
  cleanupExpiredAuditRecords,
  CreateAuditInput,
  DecodedFirebaseUser,
  DuplicateAuditLookupResult,
  FirestoreAuditAbuseGuard,
  FirestoreAuditStore,
  isAdminUser,
  PaymentRecord,
  PaymentStore,
} from "../server/firebaseAdmin.js";
import {
  AuditDraftStatus,
  AuditRecord,
  AuditReviewStatus,
  PRELIMINARY_DRAFT_LABEL,
  PreliminaryAuditDraft,
  SanitizedGeminiAuditInput,
} from "../shared/audit.js";

const { generateContentSpy } = vi.hoisted(() => ({
  generateContentSpy: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class MockGoogleGenAI {
    models = {
      generateContent: generateContentSpy,
    };
  }
  return {
    ...actual,
    GoogleGenAI: MockGoogleGenAI,
  };
});

class InMemoryAuditStore implements AuditStore {
  audits = new Map<string, AuditRecord>();
  private dedup = new Map<
    string,
    { auditId: string; fingerprintKey: string; expiresAtMs: number }
  >();
  private counter = 0;

  async isAdminUser(user: DecodedFirebaseUser): Promise<boolean> {
    return (
      user.admin === true ||
      (user.email === "jeremycodjoe@gmail.com" && user.email_verified === true)
    );
  }

  async createAuditRequest(input: CreateAuditInput): Promise<AuditRecord> {
    this.counter += 1;
    const id = `audit_${this.counter}`;
    const now = new Date().toISOString();
    const record: AuditRecord = {
      id,
      ...input,
      reviewStatus: "pending_review",
      draftStatus: "generating",
      draft: null,
      draftError: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewerNotes: "",
      createdAt: now,
      updatedAt: now,
    };
    this.audits.set(id, record);
    return record;
  }

  async findRecentDuplicateAudit(params: {
    fingerprintKey: string;
    submissionIdKey: string | null;
    nowMs?: number;
  }): Promise<DuplicateAuditLookupResult> {
    const nowMs = params.nowMs ?? Date.now();
    if (params.submissionIdKey) {
      const sidEntry = this.dedup.get(params.submissionIdKey);
      if (sidEntry && sidEntry.expiresAtMs > nowMs) {
        if (sidEntry.fingerprintKey !== params.fingerprintKey) {
          return { status: "conflict" };
        }
        const existing = this.audits.get(sidEntry.auditId);
        if (existing) return { status: "duplicate", audit: existing };
      }
    }
    const fpEntry = this.dedup.get(params.fingerprintKey);
    if (fpEntry && fpEntry.expiresAtMs > nowMs) {
      const existing = this.audits.get(fpEntry.auditId);
      if (existing) return { status: "duplicate", audit: existing };
    }
    return { status: "none" };
  }

  async claimOrCreateAuditRequest(
    params: ClaimOrCreateAuditParams
  ): Promise<ClaimAuditResult> {
    const nowMs = params.nowMs ?? Date.now();
    const dedupWindowMs = params.dedupWindowMs ?? 15 * 60 * 1000;

    if (params.submissionIdKey) {
      const sidEntry = this.dedup.get(params.submissionIdKey);
      if (sidEntry && sidEntry.expiresAtMs > nowMs) {
        if (sidEntry.fingerprintKey !== params.fingerprintKey) {
          return { status: "conflict" };
        }
        const existing = this.audits.get(sidEntry.auditId);
        if (existing) return { status: "duplicate", audit: existing };
      }
    }
    const fpEntry = this.dedup.get(params.fingerprintKey);
    if (fpEntry && fpEntry.expiresAtMs > nowMs) {
      const existing = this.audits.get(fpEntry.auditId);
      if (existing) return { status: "duplicate", audit: existing };
    }

    const created = await this.createAuditRequest(params.input);
    const lock = {
      auditId: created.id,
      fingerprintKey: params.fingerprintKey,
      expiresAtMs: nowMs + dedupWindowMs,
    };
    this.dedup.set(params.fingerprintKey, lock);
    if (params.submissionIdKey) {
      this.dedup.set(params.submissionIdKey, lock);
    }
    return { status: "created", audit: created };
  }

  async saveAuditDraftSuccess(
    auditId: string,
    draft: PreliminaryAuditDraft
  ): Promise<AuditRecord | null> {
    const existing = this.audits.get(auditId);
    if (!existing) return null;
    const updated: AuditRecord = {
      ...existing,
      draft,
      draftStatus: "ready",
      draftError: null,
      reviewStatus: "pending_review",
      updatedAt: new Date().toISOString(),
    };
    this.audits.set(auditId, updated);
    return updated;
  }

  async saveAuditDraftFailure(
    auditId: string,
    draftStatus: Extract<AuditDraftStatus, "unavailable" | "failed">,
    reason: string
  ): Promise<AuditRecord | null> {
    const existing = this.audits.get(auditId);
    if (!existing) return null;
    const updated: AuditRecord = {
      ...existing,
      draft: null,
      draftStatus,
      draftError: reason,
      updatedAt: new Date().toISOString(),
    };
    this.audits.set(auditId, updated);
    return updated;
  }

  async listAudits(limit = 50): Promise<AuditRecord[]> {
    return Array.from(this.audits.values()).reverse().slice(0, limit);
  }

  async getAuditById(auditId: string): Promise<AuditRecord | null> {
    return this.audits.get(auditId) || null;
  }

  async updateAuditReview(
    auditId: string,
    params: {
      reviewStatus: AuditReviewStatus;
      reviewerNotes: string;
      reviewedBy: string;
    }
  ): Promise<AuditRecord | null> {
    const existing = this.audits.get(auditId);
    if (!existing) return null;
    const updated: AuditRecord = {
      ...existing,
      reviewStatus: params.reviewStatus,
      reviewerNotes: params.reviewerNotes,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.audits.set(auditId, updated);
    return updated;
  }
}

describe("Audit intake, Gemini preliminary drafts, and admin review security", () => {
  let auditStore: InMemoryAuditStore;
  let abuseGuard: AuditAbuseGuard;
  let draftSpy: ReturnType<typeof vi.fn<VertexDraftGenerator["generateDraft"]>>;
  let verifyTokenSpy: ReturnType<
    typeof vi.fn<(token: string, checkRevoked?: boolean) => Promise<DecodedFirebaseUser>>
  >;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    generateContentSpy.mockReset();
    auditStore = new InMemoryAuditStore();
    abuseGuard = createInMemoryAuditAbuseGuard({
      maxPerIp: 3,
      maxPerEmail: 2,
      maxDailyAiDrafts: 20,
    });

    verifyTokenSpy = vi.fn(async (token: string, checkRevoked?: boolean) => {
      if (token === "revoked-admin-token") {
        if (checkRevoked) {
          const err: any = new Error("Token revoked");
          err.code = "auth/id-token-revoked";
          throw err;
        }
        return {
          uid: "admin_uid",
          email: "jeremycodjoe@gmail.com",
          email_verified: true,
        };
      }
      if (token === "admin-token") {
        return {
          uid: "admin_uid",
          email: "jeremycodjoe@gmail.com",
          email_verified: true,
        };
      }
      if (token === "regular-user-token") {
        return {
          uid: "customer_uid",
          email: "customer@example.com",
          email_verified: true,
        };
      }
      throw new Error("Invalid token");
    });

    const mockAuth: FirebaseAuthLike = {
      verifyIdToken: verifyTokenSpy,
    };

    draftSpy = vi.fn<VertexDraftGenerator["generateDraft"]>(
      async (input: SanitizedGeminiAuditInput) => ({
        status: "ready" as const,
        draft: {
          label: PRELIMINARY_DRAFT_LABEL,
          disclaimer:
            "Preliminary recommendations only — not a verified live audit. Human review required before sharing.",
          preliminaryOnly: true as const,
          requiresHumanReview: true as const,
          model: DEFAULT_GEMINI_MODEL,
          generatedAt: new Date().toISOString(),
          executiveSummary: `Preliminary growth plan for ${input.businessName} in ${input.serviceArea}.`,
          googleProfileChecklist: ["Confirm primary and secondary categories manually."],
          websiteConversionChecklist: ["Check mobile call-to-action placement manually."],
          localVisibilityOpportunities: ["Highlight San Tan Valley service neighborhoods."],
          reviewEngineNextSteps: ["Deploy QR review cards on completed jobs."],
          humanReviewerVerificationTasks: ["Inspect live Google Business Profile and website."],
          suggestedCallToAction: "Offer a 15-minute live walkthrough after human verification.",
        },
      })
    );

    const generator: VertexDraftGenerator = {
      generateDraft: (input) => draftSpy(input),
    };

    app = await createApp({
      getAuth: () => ({ auth: mockAuth, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: abuseGuard, error: null }),
      getAuditDraftGenerator: () => generator,
      auditRateLimiter: createIpRateLimiter({ windowMs: 60_000, maxRequests: 50 }),
      mountFrontend: false,
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.AUDIT_DRAFT_TIMEOUT_MS;
    delete process.env.AUDIT_DRAFT_MAX_OUTPUT_TOKENS;
  });

  it("defaults Vertex AI configuration to gemini-3.8-flash, global, bounded tokens and timeout", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(DEFAULT_VERTEX_LOCATION).toBe("global");
    expect(DEFAULT_VERTEX_TIMEOUT_MS).toBe(12_000);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(2048);
  });

  it("scrubs embedded email addresses, phone numbers, and URLs in businessName and serviceArea while keeping safe text", () => {
    const cleanPreserved = sanitizeAuditInputForGemini({
      businessName: "STV Plumbing Co. 24/7",
      industry: "Plumbing",
      serviceArea: "San Tan Valley, AZ 85140",
      hasWebsite: true,
      hasGoogleProfile: true,
    });
    expect(cleanPreserved.businessName).toBe("STV Plumbing Co. 24/7");
    expect(cleanPreserved.serviceArea).toBe("San Tan Valley, AZ 85140");

    const dirty = sanitizeAuditInputForGemini({
      businessName: "Sun Roofing owner@sunroof.example example.xyz (480) 555-1234",
      industry: "Roofing",
      serviceArea: "Queen Creek https://sunroof.example/quote www.sunroof.net example.photography sub.example.photography/contact 555-8899",
      hasWebsite: false,
      hasGoogleProfile: false,
    });

    const serialized = JSON.stringify(dirty);
    expect(serialized).not.toContain("owner@sunroof.example");
    expect(serialized).not.toContain("480");
    expect(serialized).not.toContain("555-1234");
    expect(serialized).not.toContain("555-8899");
    expect(serialized).not.toContain("sunroof.example");
    expect(serialized).not.toContain("sunroof.net");
    expect(serialized).not.toContain("example.xyz");
    expect(serialized).not.toContain("example.photography");
    expect(dirty.businessName).toContain("[redacted-email]");
    expect(dirty.businessName).toContain("[redacted-phone]");
    expect(dirty.businessName).toContain("[redacted-url]");
    expect(dirty.serviceArea).toContain("[redacted-url]");

    const prompt = buildAuditDraftPrompt(dirty);
    expect(prompt).toContain("Preliminary recommendations only");
    expect(prompt).not.toContain("https://");
    expect(prompt).not.toContain("@");
  });

  it("rejects submissions that embed email addresses, phone numbers, or URLs inside businessName or serviceArea", async () => {
    const badPayloads = [
      {
        businessName: "Acme owner@acme.com Plumbing",
        industry: "Plumbing",
        serviceArea: "San Tan Valley, AZ",
        email: "contact@acme.example",
      },
      {
        businessName: "Acme Plumbing",
        industry: "Plumbing",
        serviceArea: "Call 480-555-9012 San Tan Valley",
        email: "contact@acme.example",
      },
      {
        businessName: "Acme https://acme.example Plumbing",
        industry: "Plumbing",
        serviceArea: "San Tan Valley, AZ",
        email: "contact@acme.example",
      },
      {
        businessName: "Acme Plumbing",
        industry: "Plumbing",
        serviceArea: "Serving www.acme.example",
        email: "contact@acme.example",
      },
      {
        businessName: "Visit example.xyz Plumbing",
        industry: "Plumbing",
        serviceArea: "San Tan Valley, AZ",
        email: "contact@acme.example",
      },
      {
        businessName: "Acme Plumbing",
        industry: "Plumbing",
        serviceArea: "San Tan Valley example.photography",
        email: "contact@acme.example",
      },
    ];

    for (const payload of badPayloads) {
      const res = await request(app).post("/api/audits").send(payload);
      expect(res.status).toBe(400);
    }

    expect(auditStore.audits.size).toBe(0);
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("submits valid audit request server-side, sends zero PII/URLs to Gemini, and keeps draft private", async () => {
    const res = await request(app).post("/api/audits").send({
      businessName: "STV Plumbing Co",
      industry: "Plumbing",
      serviceArea: "San Tan Valley & Encanterra",
      email: "secret-owner@stvplumbing.example",
      phone: "(480) 555-8899",
      websiteUrl: "https://stvplumbing.example/private-path",
      googleProfileUrl: "https://maps.google.com/?cid=123456789",
      hpContact: "",
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.auditId).toBe("audit_1");
    expect(res.body.draft).toBeUndefined();

    expect(draftSpy).toHaveBeenCalledTimes(1);
    const geminiArg = draftSpy.mock.calls[0][0];
    expect(geminiArg).toEqual({
      businessName: "STV Plumbing Co",
      industry: "Plumbing",
      serviceArea: "San Tan Valley & Encanterra",
      hasWebsiteLink: true,
      hasGoogleProfileLink: true,
    });
    const serializedArg = JSON.stringify(geminiArg);
    expect(serializedArg).not.toContain("secret-owner@stvplumbing.example");
    expect(serializedArg).not.toContain("555-8899");
    expect(serializedArg).not.toContain("https://");

    const stored = await auditStore.getAuditById("audit_1");
    expect(stored).toMatchObject({
      businessName: "STV Plumbing Co",
      email: "secret-owner@stvplumbing.example",
      websiteUrl: "https://stvplumbing.example/private-path",
      reviewStatus: "pending_review",
      draftStatus: "ready",
    });
    expect(stored?.draft?.preliminaryOnly).toBe(true);
    expect(stored?.draft?.requiresHumanReview).toBe(true);
    expect(stored?.draft?.label).toBe(PRELIMINARY_DRAFT_LABEL);
  });

  it("scrubs legacy stored records with embedded PII/URLs during admin draft regeneration", async () => {
    const legacy = await auditStore.createAuditRequest({
      businessName: "Legacy Solar call 480-555-4321",
      industry: "Electrical",
      serviceArea: "Mesa test@legacy.example legacy.com",
      email: "owner@legacy.example",
      phone: "",
      websiteUrl: "",
      googleProfileUrl: "",
      hasWebsite: false,
      hasGoogleProfile: false,
    });

    const regenRes = await request(app)
      .post(`/api/admin/audits/${legacy.id}/regenerate-draft`)
      .set("Authorization", "Bearer admin-token");

    expect(regenRes.status).toBe(200);
    expect(draftSpy).toHaveBeenCalledTimes(1);
    const geminiArg = JSON.stringify(draftSpy.mock.calls[0][0]);
    expect(geminiArg).not.toContain("480-555-4321");
    expect(geminiArg).not.toContain("test@legacy.example");
    expect(geminiArg).not.toContain("legacy.com");
  });

  it("silently drops honeypot submissions without writing to DB or calling Gemini", async () => {
    const res = await request(app).post("/api/audits").send({
      businessName: "Bot Corp",
      industry: "Roofing",
      serviceArea: "San Tan Valley",
      email: "bot@spam.example",
      hpContact: "http://spam-bot-link.example",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditStore.audits.size).toBe(0);
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("enforces shared per-IP and per-email rate limits across requests and IPs", async () => {
    // 3 distinct businesses/emails from same IP succeed; 4th hits shared per-IP limit (3)
    for (let i = 0; i < 3; i += 1) {
      const okRes = await request(app)
        .post("/api/audits")
        .set("X-Forwarded-For", "203.0.113.42")
        .send({
          businessName: `Queen Creek HVAC ${i}`,
          industry: "HVAC",
          serviceArea: "Queen Creek, AZ",
          email: `owner${i}@qchvac.example`,
        });
      expect(okRes.status).toBe(201);
    }

    const ipLimitedRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.42")
      .send({
        businessName: "Queen Creek HVAC 4",
        industry: "HVAC",
        serviceArea: "Queen Creek, AZ",
        email: "owner4@qchvac.example",
      });
    expect(ipLimitedRes.status).toBe(429);
    expect(ipLimitedRes.headers["retry-after"]).toBeDefined();

    // Same email across rotating IPs hits shared per-email limit (2)
    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post("/api/audits")
        .set("X-Forwarded-For", `198.51.100.${i + 1}`)
        .send({
          businessName: `Rotating IP Business ${i}`,
          industry: "Roofing",
          serviceArea: "San Tan Valley, AZ",
          email: "shared-target@example.com",
        });
      expect(res.status).toBe(201);
    }

    const emailLimitedRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "198.51.100.99")
      .send({
        businessName: "Rotating IP Business 3",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "shared-target@example.com",
      });
    expect(emailLimitedRes.status).toBe(429);
    expect(emailLimitedRes.headers["retry-after"]).toBeDefined();
  });

  it("deduplicates timeout/retry submissions by Idempotency-Key or normalized payload without re-calling Gemini", async () => {
    const firstRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.10")
      .set("Idempotency-Key", "retry-session-12345")
      .send({
        businessName: "Johnson Ranch Landscaping",
        industry: "Landscaping",
        serviceArea: "Johnson Ranch, AZ",
        email: "hello@jrland.example",
      });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.auditId).toBe("audit_1");
    expect(firstRes.body.duplicate).toBe(false);

    // Retrying with same Idempotency-Key returns existing audit cleanly
    const retryByKey = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.10")
      .set("Idempotency-Key", "retry-session-12345")
      .send({
        businessName: "Johnson Ranch Landscaping",
        industry: "Landscaping",
        serviceArea: "Johnson Ranch, AZ",
        email: "hello@jrland.example",
      });
    expect(retryByKey.status).toBe(200);
    expect(retryByKey.body.duplicate).toBe(true);
    expect(retryByKey.body.auditId).toBe("audit_1");

    // Retrying without Idempotency-Key (or normalized casing/whitespace) also deduplicates
    const retryByFingerprint = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({
        businessName: "  johnson ranch   landscaping ",
        industry: "Landscaping",
        serviceArea: "Johnson Ranch, AZ",
        email: "HELLO@jrland.example",
      });
    expect(retryByFingerprint.status).toBe(200);
    expect(retryByFingerprint.body.duplicate).toBe(true);
    expect(retryByFingerprint.body.auditId).toBe("audit_1");

    expect(auditStore.audits.size).toBe(1);
    expect(draftSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces daily AI draft budget cap while still persisting intake requests", async () => {
    const tightGuard = createInMemoryAuditAbuseGuard({
      maxPerIp: 10,
      maxPerEmail: 10,
      maxDailyAiDrafts: 1,
    });
    const cappedApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: tightGuard, error: null }),
      getAuditDraftGenerator: () => ({ generateDraft: (input) => draftSpy(input) }),
      mountFrontend: false,
    });

    const first = await request(cappedApp).post("/api/audits").send({
      businessName: "First Pro Co",
      industry: "Plumbing",
      serviceArea: "San Tan Valley, AZ",
      email: "first@pro.example",
    });
    expect(first.status).toBe(201);
    expect((await auditStore.getAuditById("audit_1"))?.draftStatus).toBe("ready");

    const second = await request(cappedApp).post("/api/audits").send({
      businessName: "Second Pro Co",
      industry: "HVAC",
      serviceArea: "Queen Creek, AZ",
      email: "second@pro.example",
    });
    expect(second.status).toBe(201);
    expect((await auditStore.getAuditById("audit_2"))?.draftStatus).toBe("unavailable");
    expect(draftSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces maxOutputTokens and hard timeout via AbortSignal in Vertex generator", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "citationgenerator001";
    process.env.AUDIT_DRAFT_TIMEOUT_MS = "500";
    process.env.AUDIT_DRAFT_MAX_OUTPUT_TOKENS = "1024";

    generateContentSpy.mockImplementationOnce(async (args: any) => {
      expect(args.model).toBe("gemini-3.8-flash");
      expect(args.config.maxOutputTokens).toBe(1024);
      expect(args.config.abortSignal).toBeDefined();
      return await new Promise((_resolve) => {
        // Never resolves -> triggers timeout abort
      });
    });

    const generator = createVertexAuditDraftGenerator();
    const res = await generator.generateDraft({
      businessName: "Timeout Test Co",
      industry: "Roofing",
      serviceArea: "San Tan Valley, AZ",
      hasWebsiteLink: false,
      hasGoogleProfileLink: false,
    });

    expect(res.status).toBe("failed");
    if (res.status === "failed") {
      expect(res.reason).toContain("timed out after 500ms");
    }
  });

  it("enforces revocation-checked admin auth, role checks, and fail-closed 503 on Firestore admin errors", async () => {
    await request(app).post("/api/audits").send({
      businessName: "Ironwood Electrical",
      industry: "Electrical",
      serviceArea: "Ironwood Crossing, STV",
      email: "hello@ironwood.example",
    });

    // Unauthenticated -> 401
    expect((await request(app).get("/api/admin/audits")).status).toBe(401);

    // Revoked admin token -> 401 because checkRevoked = true is passed
    const revokedRes = await request(app)
      .get("/api/admin/audits")
      .set("Authorization", "Bearer revoked-admin-token");
    expect(revokedRes.status).toBe(401);
    expect(verifyTokenSpy).toHaveBeenCalledWith("revoked-admin-token", true);

    // Non-admin authenticated user -> 403
    expect(
      (
        await request(app)
          .get("/api/admin/audits")
          .set("Authorization", "Bearer regular-user-token")
      ).status
    ).toBe(403);

    // Admin routes pass with revocation-checked valid admin token
    const adminListRes = await request(app)
      .get("/api/admin/audits")
      .set("Authorization", "Bearer admin-token");
    expect(adminListRes.status).toBe(200);
    expect(adminListRes.body.audits).toHaveLength(1);
    expect(verifyTokenSpy).toHaveBeenCalledWith("admin-token", true);

    // Firestore admin-check failure fails closed with 503 instead of crashing or granting access
    const failingAuditStore: AuditStore = {
      ...auditStore,
      async isAdminUser() {
        throw new Error("Firestore DEADLINE_EXCEEDED");
      },
      createAuditRequest: auditStore.createAuditRequest.bind(auditStore),
      findRecentDuplicateAudit: auditStore.findRecentDuplicateAudit.bind(auditStore),
      claimOrCreateAuditRequest: auditStore.claimOrCreateAuditRequest.bind(auditStore),
      saveAuditDraftSuccess: auditStore.saveAuditDraftSuccess.bind(auditStore),
      saveAuditDraftFailure: auditStore.saveAuditDraftFailure.bind(auditStore),
      listAudits: auditStore.listAudits.bind(auditStore),
      getAuditById: auditStore.getAuditById.bind(auditStore),
      updateAuditReview: auditStore.updateAuditReview.bind(auditStore),
    };

    const failingAdminApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: failingAuditStore, error: null }),
      mountFrontend: false,
    });
    const errorRes = await request(failingAdminApp)
      .get("/api/admin/audits")
      .set("Authorization", "Bearer admin-token");
    expect(errorRes.status).toBe(503);

    // Same safe revocation + fail-closed behavior for cross-user admin lookup on /api/payments/:id
    const failingPaymentStore: PaymentStore = {
      async createPendingPayment() {},
      async getPaymentById(): Promise<PaymentRecord> {
        return {
          userId: "someone_else",
          userEmail: "other@example.com",
          amount: 19900,
          currency: "usd",
          planName: "Activation",
          productIds: ["activation"],
          status: "completed",
          stripePaymentIntentId: "pi_other",
          lastWebhookEventId: "evt_1",
          failureReason: null,
        };
      },
      async isAdminUser() {
        throw new Error("Firestore unavailable");
      },
      async processWebhookEvent() {
        return { outcome: "ignored" };
      },
    };
    const paymentErrApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getPaymentStore: () => ({ store: failingPaymentStore, error: null }),
      mountFrontend: false,
    });
    const revokedPayRes = await request(paymentErrApp)
      .get("/api/payments/pi_other")
      .set("Authorization", "Bearer revoked-admin-token");
    expect(revokedPayRes.status).toBe(401);
    const errPayRes = await request(paymentErrApp)
      .get("/api/payments/pi_other")
      .set("Authorization", "Bearer admin-token");
    expect(errPayRes.status).toBe(503);
  });

  it("saves audit submission gracefully even when Vertex AI is unavailable", async () => {
    const unavailableApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: abuseGuard, error: null }),
      getAuditDraftGenerator: () => ({
        async generateDraft() {
          return {
            status: "unavailable",
            reason: "GOOGLE_CLOUD_PROJECT is unset.",
          };
        },
      }),
      mountFrontend: false,
    });

    const res = await request(unavailableApp).post("/api/audits").send({
      businessName: "Florence Landscaping",
      industry: "Landscaping",
      serviceArea: "Florence, AZ",
      email: "team@florenceland.example",
    });

    expect(res.status).toBe(201);
    const saved = await auditStore.getAuditById("audit_1");
    expect(saved?.draftStatus).toBe("unavailable");
    expect(saved?.reviewStatus).toBe("pending_review");
    expect(saved?.draft).toBeNull();
  });

  it("enforces consistent admin authorization rules in server isAdminUser helper", async () => {
    const fakeDb = {
      collection(name: string) {
        return {
          doc(id: string) {
            return {
              async get() {
                return { exists: name === "admins" && id === "allowlisted_uid" };
              },
            };
          },
        };
      },
    } as any;

    expect(await isAdminUser(fakeDb, { uid: "u1", admin: true })).toBe(true);
    expect(await isAdminUser(fakeDb, { uid: "allowlisted_uid" })).toBe(true);
    expect(
      await isAdminUser(fakeDb, {
        uid: "owner",
        email: "JeremyCodjoe@gmail.com",
        email_verified: true,
      })
    ).toBe(true);
    expect(
      await isAdminUser(fakeDb, {
        uid: "spoof",
        email: "jeremycodjoe@gmail.com",
        email_verified: false,
      })
    ).toBe(false);
    expect(
      await isAdminUser(fakeDb, {
        uid: "regular",
        email: "customer@example.com",
        email_verified: true,
      })
    ).toBe(false);
  });

  it("saves changed optional fields (phone, websiteUrl, googleProfileUrl) instead of silently deduplicating, and returns 409 if an Idempotency-Key is reused for edited data", async () => {
    const firstRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.50")
      .set("Idempotency-Key", "session-key-1")
      .send({
        businessName: "Copper State Roofing",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "info@copperroof.example",
        phone: "(480) 555-0100",
        websiteUrl: "https://copperroof.example",
        googleProfileUrl: "",
      });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.auditId).toBe("audit_1");

    // Reusing the same Idempotency-Key after editing optional fields must fail with 409 Conflict instead of discarding edits
    const conflictRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.50")
      .set("Idempotency-Key", "session-key-1")
      .send({
        businessName: "Copper State Roofing",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "info@copperroof.example",
        phone: "(480) 555-0199",
        websiteUrl: "https://copperroof.example",
        googleProfileUrl: "",
      });
    expect(conflictRes.status).toBe(409);

    // Submitting with edited phone, websiteUrl, or googleProfileUrl and a rotated/new Idempotency-Key creates a new audit with updated values
    const updatedRes = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.51")
      .set("Idempotency-Key", "session-key-2")
      .send({
        businessName: "Copper State Roofing",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "info@copperroof.example",
        phone: "(480) 555-0199",
        websiteUrl: "https://new.copperroof.example",
        googleProfileUrl: "https://maps.google.com/?cid=999",
      });
    expect(updatedRes.status).toBe(201);
    expect(updatedRes.body.duplicate).toBe(false);
    expect(updatedRes.body.auditId).toBe("audit_2");

    const savedUpdated = await auditStore.getAuditById("audit_2");
    expect(savedUpdated?.phone).toBe("(480) 555-0199");
    expect(savedUpdated?.websiteUrl).toBe("https://new.copperroof.example");
    expect(savedUpdated?.googleProfileUrl).toBe("https://maps.google.com/?cid=999");

    // Exact retry with all 7 fields unchanged deduplicates cleanly
    const exactRetry = await request(app)
      .post("/api/audits")
      .set("X-Forwarded-For", "203.0.113.52")
      .send({
        businessName: "Copper State Roofing",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "info@copperroof.example",
        phone: "(480) 555-0199",
        websiteUrl: "https://new.copperroof.example",
        googleProfileUrl: "https://maps.google.com/?cid=999",
      });
    expect(exactRetry.status).toBe(200);
    expect(exactRetry.body.duplicate).toBe(true);
    expect(exactRetry.body.auditId).toBe("audit_2");
  });

  it("enforces shared daily AI cap and per-audit/per-admin throttle on admin draft regeneration", async () => {
    const tightGuard = createInMemoryAuditAbuseGuard({
      maxPerIp: 20,
      maxPerEmail: 20,
      maxDailyAiDrafts: 2,
      maxRegenPerAdmin: 10,
      maxRegenPerAudit: 2,
    });
    const cappedApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: tightGuard, error: null }),
      getAuditDraftGenerator: () => ({ generateDraft: (input) => draftSpy(input) }),
      mountFrontend: false,
    });

    // Public submission consumes 1 of 2 daily AI draft slots
    const created = await request(cappedApp).post("/api/audits").send({
      businessName: "Desert Air HVAC",
      industry: "HVAC",
      serviceArea: "San Tan Valley, AZ",
      email: "owner@desertair.example",
    });
    expect(created.status).toBe(201);
    expect(draftSpy).toHaveBeenCalledTimes(1);

    // 1st admin regeneration consumes the 2nd (final) daily AI draft slot
    const regenOk = await request(cappedApp)
      .post("/api/admin/audits/audit_1/regenerate-draft")
      .set("Authorization", "Bearer admin-token");
    expect(regenOk.status).toBe(200);
    expect(draftSpy).toHaveBeenCalledTimes(2);

    // 2nd admin regeneration must be blocked by the shared daily AI cap (429) without calling Gemini
    const regenCapped = await request(cappedApp)
      .post("/api/admin/audits/audit_1/regenerate-draft")
      .set("Authorization", "Bearer admin-token");
    expect(regenCapped.status).toBe(429);
    expect(draftSpy).toHaveBeenCalledTimes(2);

    // Separate guard with high daily budget still enforces per-audit regeneration throttle
    const throttleGuard = createInMemoryAuditAbuseGuard({
      maxDailyAiDrafts: 100,
      maxRegenPerAdmin: 10,
      maxRegenPerAudit: 2,
    });
    const throttledApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: throttleGuard, error: null }),
      getAuditDraftGenerator: () => ({ generateDraft: (input) => draftSpy(input) }),
      mountFrontend: false,
    });
    expect(
      (
        await request(throttledApp)
          .post("/api/admin/audits/audit_1/regenerate-draft")
          .set("Authorization", "Bearer admin-token")
      ).status
    ).toBe(200);
    expect(
      (
        await request(throttledApp)
          .post("/api/admin/audits/audit_1/regenerate-draft")
          .set("Authorization", "Bearer admin-token")
      ).status
    ).toBe(200);
    const throttledRes = await request(throttledApp)
      .post("/api/admin/audits/audit_1/regenerate-draft")
      .set("Authorization", "Bearer admin-token");
    expect(throttledRes.status).toBe(429);
    expect(throttledRes.headers["retry-after"]).toBeDefined();
  });

  it("clears prior draft and returns non-2xx error when admin draft regeneration fails", async () => {
    let shouldFail = false;
    const toggleApp = await createApp({
      getAuth: () => ({ auth: { verifyIdToken: verifyTokenSpy }, error: null }),
      getAuditStore: () => ({ store: auditStore, error: null }),
      getAuditAbuseGuard: () => ({ guard: abuseGuard, error: null }),
      getAuditDraftGenerator: () => ({
        async generateDraft(input) {
          if (shouldFail) {
            return { status: "failed", reason: "Upstream Vertex quota exceeded." };
          }
          return draftSpy(input);
        },
      }),
      mountFrontend: false,
    });

    await request(toggleApp).post("/api/audits").send({
      businessName: "Sunburst Electric",
      industry: "Electrical",
      serviceArea: "Queen Creek, AZ",
      email: "owner@sunburst.example",
    });

    const before = await auditStore.getAuditById("audit_1");
    expect(before?.draftStatus).toBe("ready");
    expect(before?.draft).not.toBeNull();

    shouldFail = true;
    const failRes = await request(toggleApp)
      .post("/api/admin/audits/audit_1/regenerate-draft")
      .set("Authorization", "Bearer admin-token");

    expect(failRes.status).toBe(502);
    expect(failRes.body.error).toContain("Upstream Vertex quota exceeded.");
    expect(failRes.body.audit.draft).toBeNull();
    expect(failRes.body.audit.draftStatus).toBe("failed");

    const after = await auditStore.getAuditById("audit_1");
    expect(after?.draft).toBeNull();
    expect(after?.draftStatus).toBe("failed");
    expect(after?.draftError).toContain("Upstream Vertex quota exceeded.");
  });

  it("stores TTL expireAt timestamps without raw IP/email and cleans up expired internal records", async () => {
    const collections = new Map<string, Map<string, Record<string, any>>>();
    const getCol = (name: string) => {
      if (!collections.has(name)) collections.set(name, new Map());
      return collections.get(name)!;
    };

    const fakeDb: any = {
      collection(name: string) {
        const col = getCol(name);
        return {
          doc(id?: string) {
            const docId = id || `doc_${col.size + 1}`;
            const ref = {
              id: docId,
              async get() {
                const data = col.get(docId);
                return { id: docId, exists: Boolean(data), data: () => data };
              },
              async set(data: Record<string, any>) {
                col.set(docId, data);
              },
              async update(data: Record<string, any>) {
                col.set(docId, { ...(col.get(docId) || {}), ...data });
              },
              async delete() {
                col.delete(docId);
              },
            };
            return ref;
          },
          where(field: string, op: string, value: any) {
            const cutoffMs = value?.toMillis ? value.toMillis() : Number(value);
            return {
              limit(n: number) {
                return {
                  async get() {
                    const matched: any[] = [];
                    for (const [docId, data] of col.entries()) {
                      const val = data?.[field]?.toMillis ? data[field].toMillis() : null;
                      if (op === "<=" && val !== null && val <= cutoffMs) {
                        matched.push({
                          id: docId,
                          data: () => data,
                          ref: {
                            async delete() {
                              col.delete(docId);
                            },
                          },
                        });
                        if (matched.length >= n) break;
                      }
                    }
                    return { empty: matched.length === 0, docs: matched };
                  },
                };
              },
            };
          },
        };
      },
      async runTransaction(fn: (tx: any) => Promise<any>) {
        const tx = {
          async get(ref: any) {
            return ref.get();
          },
          set(ref: any, data: Record<string, any>) {
            ref.set(data);
          },
          update(ref: any, data: Record<string, any>) {
            ref.update(data);
          },
        };
        return fn(tx);
      },
    };

    let currentMs = Date.UTC(2026, 10, 16, 12, 0, 0);
    const fsGuard = new FirestoreAuditAbuseGuard(fakeDb, {
      ipWindowMs: 15 * 60 * 1000,
      emailWindowMs: 60 * 60 * 1000,
      usageRetentionDays: 30,
      now: () => currentMs,
    });
    const fsStore = new FirestoreAuditStore(fakeDb);

    await fsGuard.checkRateLimit({
      clientIp: "203.0.113.77",
      email: "private-owner@sensitive.example",
    });
    await fsGuard.consumeDailyAiBudget();
    await fsStore.claimOrCreateAuditRequest({
      input: {
        businessName: "Retention Co",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "private-owner@sensitive.example",
        phone: "",
        websiteUrl: "",
        googleProfileUrl: "",
        hasWebsite: false,
        hasGoogleProfile: false,
      },
      fingerprintKey: "fp_test_hash",
      submissionIdKey: "sid_test_hash",
      dedupWindowMs: 15 * 60 * 1000,
      nowMs: currentMs,
    });

    // Verify no raw IP or email exists anywhere in internal rate-limit, dedup, or usage collections
    const internalDump = JSON.stringify({
      rateLimits: Array.from(getCol("audit_rate_limits").entries()),
      dedup: Array.from(getCol("audit_dedup").entries()),
      usage: Array.from(getCol("audit_usage").entries()),
    });
    expect(internalDump).not.toContain("203.0.113.77");
    expect(internalDump).not.toContain("private-owner@sensitive.example");

    // Verify expireAt timestamps exist on all internal collections
    for (const colName of ["audit_rate_limits", "audit_dedup", "audit_usage"]) {
      for (const doc of getCol(colName).values()) {
        expect(typeof doc.expireAt?.toMillis).toBe("function");
      }
    }

    // Advance 2 hours -> rate limits & dedup expire and get deleted, while 30-day usage counter remains
    const afterTwoHours = currentMs + 2 * 60 * 60 * 1000;
    const firstSweep = await cleanupExpiredAuditRecords(fakeDb, afterTwoHours);
    expect(firstSweep.rateLimitsDeleted).toBe(2);
    expect(firstSweep.dedupDeleted).toBe(2);
    expect(firstSweep.usageDeleted).toBe(0);

    // Advance 32 days -> usage counter expires and gets deleted too
    const after32Days = currentMs + 32 * 24 * 60 * 60 * 1000;
    const secondSweep = await cleanupExpiredAuditRecords(fakeDb, after32Days);
    expect(secondSweep.usageDeleted).toBe(1);
  });
});
