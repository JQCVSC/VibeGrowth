import { createHash } from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import {
  ALLOWED_AUDIT_INDUSTRIES,
  AUDIT_REVIEW_STATUSES,
  AuditIndustry,
  AuditReviewStatus,
  findEmbeddedContactOrUrl,
  PRELIMINARY_DRAFT_LABEL,
  PreliminaryAuditDraft,
  SanitizedGeminiAuditInput,
  scrubEmbeddedPiiAndUrls,
} from "../shared/audit.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+()\-. \s]{7,30}$/;
const SUBMISSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

export const DEFAULT_VERTEX_LOCATION = "global";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_VERTEX_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
export const DEFAULT_AUDIT_DEDUP_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_AUDIT_DAILY_AI_LIMIT = 100;
export const DEFAULT_AUDIT_USAGE_RETENTION_DAYS = 30;
export const DEFAULT_ADMIN_REGEN_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_ADMIN_REGEN_MAX_PER_ADMIN = 10;
export const DEFAULT_ADMIN_REGEN_MAX_PER_AUDIT = 3;

export class AuditValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AuditValidationError";
    this.statusCode = statusCode;
  }
}

export interface ValidatedAuditSubmission {
  isHoneypot: false;
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  email: string;
  phone: string;
  websiteUrl: string;
  googleProfileUrl: string;
  hasWebsite: boolean;
  hasGoogleProfile: boolean;
  submissionId: string | null;
}

export type AuditSubmissionResult =
  | { isHoneypot: true }
  | ValidatedAuditSubmission;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateAuditSubmission(
  rawBody: unknown,
  headerSubmissionId?: string
): AuditSubmissionResult {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new AuditValidationError("Request body must be a JSON object.");
  }

  const body = rawBody as Record<string, unknown>;

  // Honeypot check (if filled by a bot, silently drop without storing or calling Gemini)
  if (typeof body.hpContact === "string" && body.hpContact.trim().length > 0) {
    return { isHoneypot: true };
  }

  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  if (businessName.length < 1 || businessName.length > 120) {
    throw new AuditValidationError("Business name must be between 1 and 120 characters.");
  }
  if (findEmbeddedContactOrUrl(businessName)) {
    throw new AuditValidationError(
      "Please keep email addresses, phone numbers, and URLs out of Business Name — use the dedicated fields below."
    );
  }

  const industry = typeof body.industry === "string" ? body.industry.trim() : "";
  if (!ALLOWED_AUDIT_INDUSTRIES.includes(industry as AuditIndustry)) {
    throw new AuditValidationError("Please select a valid industry.");
  }

  const serviceArea =
    typeof body.serviceArea === "string" ? body.serviceArea.trim() : "";
  if (serviceArea.length < 2 || serviceArea.length > 120) {
    throw new AuditValidationError("Service area must be between 2 and 120 characters.");
  }
  if (findEmbeddedContactOrUrl(serviceArea)) {
    throw new AuditValidationError(
      "Please keep email addresses, phone numbers, and URLs out of Service Area — use the dedicated fields below."
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length < 5 || email.length > 254 || !EMAIL_REGEX.test(email)) {
    throw new AuditValidationError("Please provide a valid email address.");
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (phone.length > 30 || (phone.length > 0 && !PHONE_REGEX.test(phone))) {
    throw new AuditValidationError("Please provide a valid phone number.");
  }

  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  if (websiteUrl.length > 300 || (websiteUrl.length > 0 && !isValidHttpUrl(websiteUrl))) {
    throw new AuditValidationError("Website URL must start with http:// or https://.");
  }

  const googleProfileUrl =
    typeof body.googleProfileUrl === "string" ? body.googleProfileUrl.trim() : "";
  if (
    googleProfileUrl.length > 500 ||
    (googleProfileUrl.length > 0 && !isValidHttpUrl(googleProfileUrl))
  ) {
    throw new AuditValidationError(
      "Google Business Profile URL must start with http:// or https://."
    );
  }

  const rawSubmissionId =
    typeof headerSubmissionId === "string" && headerSubmissionId.trim().length > 0
      ? headerSubmissionId.trim()
      : typeof body.submissionId === "string" && body.submissionId.trim().length > 0
        ? body.submissionId.trim()
        : null;

  if (rawSubmissionId !== null && !SUBMISSION_ID_REGEX.test(rawSubmissionId)) {
    throw new AuditValidationError("Invalid submissionId format.");
  }

  return {
    isHoneypot: false,
    businessName,
    industry: industry as AuditIndustry,
    serviceArea,
    email,
    phone,
    websiteUrl,
    googleProfileUrl,
    hasWebsite: websiteUrl.length > 0,
    hasGoogleProfile: googleProfileUrl.length > 0,
    submissionId: rawSubmissionId,
  };
}

export function validateReviewUpdate(rawBody: unknown): {
  reviewStatus: AuditReviewStatus;
  reviewerNotes: string;
} {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new AuditValidationError("Request body must be a JSON object.");
  }

  const body = rawBody as Record<string, unknown>;
  const reviewStatus =
    typeof body.reviewStatus === "string" ? body.reviewStatus.trim() : "";
  if (!AUDIT_REVIEW_STATUSES.includes(reviewStatus as AuditReviewStatus)) {
    throw new AuditValidationError("Invalid reviewStatus value.");
  }

  const reviewerNotes =
    typeof body.reviewerNotes === "string" ? body.reviewerNotes.trim() : "";
  if (reviewerNotes.length > 2000) {
    throw new AuditValidationError("Reviewer notes must be 2000 characters or fewer.");
  }

  return {
    reviewStatus: reviewStatus as AuditReviewStatus,
    reviewerNotes,
  };
}

/**
 * Strips all PII (email, phone) and actual URLs before any prompt is constructed for Gemini,
 * including defense-in-depth scrubbing of embedded contacts or links inside free-text fields.
 */
export function sanitizeAuditInputForGemini(input: {
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  hasWebsite: boolean;
  hasGoogleProfile: boolean;
}): SanitizedGeminiAuditInput {
  return {
    businessName: scrubEmbeddedPiiAndUrls(input.businessName) || "Local Service Business",
    industry: input.industry,
    serviceArea: scrubEmbeddedPiiAndUrls(input.serviceArea) || "Local Service Area",
    hasWebsiteLink: Boolean(input.hasWebsite),
    hasGoogleProfileLink: Boolean(input.hasGoogleProfile),
  };
}

export function hashAbuseKey(prefix: string, rawValue: string): string {
  const digest = createHash("sha256").update(rawValue.trim().toLowerCase()).digest("hex");
  return `${prefix}_${digest.slice(0, 32)}`;
}

export function computeAuditFingerprintKey(input: {
  email: string;
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  phone?: string;
  websiteUrl?: string;
  googleProfileUrl?: string;
}): string {
  const canonical = [
    input.email.trim().toLowerCase(),
    input.businessName.trim().toLowerCase().replace(/\s+/g, " "),
    input.industry,
    input.serviceArea.trim().toLowerCase().replace(/\s+/g, " "),
    (input.phone ?? "").trim().replace(/\s+/g, " "),
    (input.websiteUrl ?? "").trim(),
    (input.googleProfileUrl ?? "").trim(),
  ].join("|");
  return hashAbuseKey("fp", canonical);
}

export function computeSubmissionIdKey(submissionId: string): string {
  return hashAbuseKey("sid", submissionId);
}

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export function createIpRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
  now?: () => number;
}): RateLimiter {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  const maxRequests = options?.maxRequests ?? 5;
  const now = options?.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  return {
    check(key: string) {
      const currentTime = now();
      const cutoff = currentTime - windowMs;
      const normalizedKey = key || "unknown";

      const timestamps = (hits.get(normalizedKey) || []).filter((ts) => ts > cutoff);
      if (timestamps.length >= maxRequests) {
        hits.set(normalizedKey, timestamps);
        const oldest = timestamps[0] ?? currentTime;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - currentTime) / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      timestamps.push(currentTime);
      hits.set(normalizedKey, timestamps);

      if (hits.size > 1000) {
        for (const [k, list] of hits.entries()) {
          if (list.every((ts) => ts <= cutoff)) {
            hits.delete(k);
          }
        }
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export interface AbuseCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: string;
}

export interface AuditAbuseGuard {
  checkRateLimit(params: { clientIp: string; email: string }): Promise<AbuseCheckResult>;
  checkAdminRegenerateLimit(params: {
    adminUid: string;
    auditId: string;
  }): Promise<AbuseCheckResult>;
  consumeDailyAiBudget(): Promise<{ allowed: boolean; remaining: number }>;
}

export function createInMemoryAuditAbuseGuard(options?: {
  ipWindowMs?: number;
  maxPerIp?: number;
  emailWindowMs?: number;
  maxPerEmail?: number;
  adminRegenWindowMs?: number;
  maxRegenPerAdmin?: number;
  maxRegenPerAudit?: number;
  maxDailyAiDrafts?: number;
  now?: () => number;
}): AuditAbuseGuard {
  const now = options?.now ?? (() => Date.now());
  const ipLimiter = createIpRateLimiter({
    windowMs: options?.ipWindowMs ?? 15 * 60 * 1000,
    maxRequests: options?.maxPerIp ?? 5,
    now,
  });
  const emailLimiter = createIpRateLimiter({
    windowMs: options?.emailWindowMs ?? 60 * 60 * 1000,
    maxRequests: options?.maxPerEmail ?? 2,
    now,
  });
  const adminRegenLimiter = createIpRateLimiter({
    windowMs: options?.adminRegenWindowMs ?? DEFAULT_ADMIN_REGEN_WINDOW_MS,
    maxRequests: options?.maxRegenPerAdmin ?? DEFAULT_ADMIN_REGEN_MAX_PER_ADMIN,
    now,
  });
  const auditRegenLimiter = createIpRateLimiter({
    windowMs: options?.adminRegenWindowMs ?? DEFAULT_ADMIN_REGEN_WINDOW_MS,
    maxRequests: options?.maxRegenPerAudit ?? DEFAULT_ADMIN_REGEN_MAX_PER_AUDIT,
    now,
  });
  const maxDailyAiDrafts = options?.maxDailyAiDrafts ?? DEFAULT_AUDIT_DAILY_AI_LIMIT;
  const dailyCounts = new Map<string, number>();

  return {
    async checkRateLimit({ clientIp, email }) {
      const ipCheck = ipLimiter.check(hashAbuseKey("ip", clientIp || "unknown"));
      if (!ipCheck.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: ipCheck.retryAfterSeconds,
          reason: "Too many audit requests from this IP. Please wait before trying again.",
        };
      }
      const emailCheck = emailLimiter.check(hashAbuseKey("email", email));
      if (!emailCheck.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: emailCheck.retryAfterSeconds,
          reason:
            "An audit request for this email address was already submitted recently. Please wait before submitting another.",
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async checkAdminRegenerateLimit({ adminUid, auditId }) {
      const adminCheck = adminRegenLimiter.check(hashAbuseKey("admin_regen", adminUid || "unknown"));
      if (!adminCheck.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: adminCheck.retryAfterSeconds,
          reason: "Too many draft regenerations triggered by this admin account. Please wait before retrying.",
        };
      }
      const auditCheck = auditRegenLimiter.check(hashAbuseKey("audit_regen", auditId));
      if (!auditCheck.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: auditCheck.retryAfterSeconds,
          reason: "This audit draft was regenerated multiple times recently. Please wait before regenerating again.",
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async consumeDailyAiBudget() {
      const dateKey = new Date(now()).toISOString().slice(0, 10);
      const current = dailyCounts.get(dateKey) ?? 0;
      if (current >= maxDailyAiDrafts) {
        return { allowed: false, remaining: 0 };
      }
      const next = current + 1;
      dailyCounts.set(dateKey, next);
      return { allowed: true, remaining: Math.max(0, maxDailyAiDrafts - next) };
    },
  };
}

export interface VertexDraftGenerator {
  generateDraft(
    sanitizedInput: SanitizedGeminiAuditInput
  ): Promise<
    | { status: "ready"; draft: PreliminaryAuditDraft }
    | { status: "unavailable"; reason: string }
    | { status: "failed"; reason: string }
  >;
}

const AUDIT_DRAFT_SYSTEM_INSTRUCTION = `
You are an internal marketing strategist assistant for VibeGrowth Agency preparing a PRELIMINARY PLANNING DRAFT for human review only.

CRITICAL TRUTHFULNESS & SAFETY RULES:
1. You have NO internet access, NO browser, NO Google Maps access, and NO live tools.
2. You MUST NOT claim, state, or imply that you checked, visited, analyzed, scraped, or observed any live website, Google Business Profile, review count, star rating, Map Pack ranking, keyword position, or competitor.
3. Explicitly frame every section as preliminary recommendations and checklist items for the human strategist to verify manually before sharing anything with the business owner.
4. Keep advice practical, tailored to the provided industry, service area, and whether website/profile links were provided (without ever fabricating live URL observations).
5. Keep output concise: executiveSummary <= 80 words, 3-4 short items (<= 22 words each) per checklist array, suggestedCallToAction <= 30 words.
`.trim();

export function buildAuditDraftPrompt(input: SanitizedGeminiAuditInput): string {
  return JSON.stringify(
    {
      task: "Prepare a structured preliminary local-marketing audit draft for internal human review.",
      notice:
        "Preliminary recommendations only — not a verified live audit. Do not claim any live site or profile was inspected.",
      businessProfileSummary: {
        businessName: input.businessName,
        industry: input.industry,
        serviceArea: input.serviceArea,
        websiteLinkProvided: input.hasWebsiteLink,
        googleProfileLinkProvided: input.hasGoogleProfileLink,
      },
    },
    null,
    2
  );
}

const DRAFT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    disclaimer: {
      type: Type.STRING,
      description:
        "Clear notice that these are preliminary recommendations pending human review and live verification.",
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        "Short preliminary strategy summary tailored to the business name, trade, and service area without claiming live inspection.",
    },
    googleProfileChecklist: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 preliminary Google Business Profile items for a strategist to check.",
    },
    websiteConversionChecklist: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 preliminary website/landing page conversion items to check.",
    },
    localVisibilityOpportunities: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 local service-area keyword or neighborhood positioning ideas.",
    },
    reviewEngineNextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 practical review collection and response workflow recommendations.",
    },
    humanReviewerVerificationTasks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Concrete live checks the human strategist must verify before contacting the lead.",
    },
    suggestedCallToAction: {
      type: Type.STRING,
      description: "Suggested next step to discuss after the human strategist verifies the live audit.",
    },
  },
  required: [
    "disclaimer",
    "executiveSummary",
    "googleProfileChecklist",
    "websiteConversionChecklist",
    "localVisibilityOpportunities",
    "reviewEngineNextSteps",
    "humanReviewerVerificationTasks",
    "suggestedCallToAction",
  ],
};

function sanitizeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8);
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createVertexAuditDraftGenerator(): VertexDraftGenerator {
  return {
    async generateDraft(sanitizedInput: SanitizedGeminiAuditInput) {
      const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
      const location =
        process.env.GOOGLE_CLOUD_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
      const timeoutMs = parseBoundedInt(
        process.env.AUDIT_DRAFT_TIMEOUT_MS,
        DEFAULT_VERTEX_TIMEOUT_MS,
        500,
        30_000
      );
      const maxOutputTokens = parseBoundedInt(
        process.env.AUDIT_DRAFT_MAX_OUTPUT_TOKENS,
        DEFAULT_MAX_OUTPUT_TOKENS,
        256,
        4096
      );

      if (!project) {
        return {
          status: "unavailable",
          reason:
            "Vertex AI draft generation is not configured (GOOGLE_CLOUD_PROJECT is unset).",
        };
      }

      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const ai = new GoogleGenAI({
          vertexai: true,
          project,
          location,
          httpOptions: {
            timeout: timeoutMs,
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });

        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            const timeoutErr = new Error(
              `Vertex AI draft generation timed out after ${timeoutMs}ms.`
            );
            timeoutErr.name = "TimeoutError";
            controller.abort(timeoutErr);
            reject(timeoutErr);
          }, timeoutMs);
        });

        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: buildAuditDraftPrompt(sanitizedInput),
            config: {
              abortSignal: controller.signal,
              maxOutputTokens,
              systemInstruction: AUDIT_DRAFT_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: DRAFT_RESPONSE_SCHEMA,
            },
          }),
          timeoutPromise,
        ]);

        const rawText = response.text?.trim();
        if (!rawText) {
          return {
            status: "failed",
            reason: "Vertex AI returned an empty response.",
          };
        }

        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const draft: PreliminaryAuditDraft = {
          label: PRELIMINARY_DRAFT_LABEL,
          disclaimer:
            typeof parsed.disclaimer === "string" && parsed.disclaimer.trim().length > 0
              ? parsed.disclaimer.trim()
              : "Preliminary recommendations only — not a verified live audit. Human strategist verification of live listings and website is required before sharing.",
          preliminaryOnly: true,
          requiresHumanReview: true,
          model,
          generatedAt: new Date().toISOString(),
          executiveSummary:
            typeof parsed.executiveSummary === "string"
              ? parsed.executiveSummary.trim()
              : "",
          googleProfileChecklist: sanitizeStringArray(parsed.googleProfileChecklist),
          websiteConversionChecklist: sanitizeStringArray(parsed.websiteConversionChecklist),
          localVisibilityOpportunities: sanitizeStringArray(
            parsed.localVisibilityOpportunities
          ),
          reviewEngineNextSteps: sanitizeStringArray(parsed.reviewEngineNextSteps),
          humanReviewerVerificationTasks: sanitizeStringArray(
            parsed.humanReviewerVerificationTasks
          ),
          suggestedCallToAction:
            typeof parsed.suggestedCallToAction === "string"
              ? parsed.suggestedCallToAction.trim()
              : "",
        };

        return { status: "ready", draft };
      } catch (err: any) {
        console.error("Vertex AI audit draft generation failed:", err);
        return {
          status: "failed",
          reason: err?.message || "Vertex AI draft generation failed.",
        };
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    },
  };
}
