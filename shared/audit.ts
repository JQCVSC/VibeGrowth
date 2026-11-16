export const ALLOWED_AUDIT_INDUSTRIES = [
  "Roofing",
  "Landscaping",
  "Plumbing",
  "HVAC",
  "Electrical",
  "Other Service Pro",
] as const;

export type AuditIndustry = (typeof ALLOWED_AUDIT_INDUSTRIES)[number];

export const AUDIT_REVIEW_STATUSES = [
  "pending_review",
  "approved",
  "needs_revision",
  "archived",
] as const;

export type AuditReviewStatus = (typeof AUDIT_REVIEW_STATUSES)[number];

export type AuditDraftStatus = "generating" | "ready" | "unavailable" | "failed";

export const PRELIMINARY_DRAFT_LABEL =
  "PRELIMINARY RECOMMENDATIONS — NOT A VERIFIED LIVE AUDIT";

export interface PreliminaryAuditDraft {
  label: string;
  disclaimer: string;
  preliminaryOnly: true;
  requiresHumanReview: true;
  model: string;
  generatedAt: string;
  executiveSummary: string;
  googleProfileChecklist: string[];
  websiteConversionChecklist: string[];
  localVisibilityOpportunities: string[];
  reviewEngineNextSteps: string[];
  humanReviewerVerificationTasks: string[];
  suggestedCallToAction: string;
}

export interface SanitizedGeminiAuditInput {
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  hasWebsiteLink: boolean;
  hasGoogleProfileLink: boolean;
}

export interface AuditRecord {
  id: string;
  businessName: string;
  industry: AuditIndustry;
  serviceArea: string;
  email: string;
  phone: string;
  websiteUrl: string;
  googleProfileUrl: string;
  hasWebsite: boolean;
  hasGoogleProfile: boolean;
  reviewStatus: AuditReviewStatus;
  draftStatus: AuditDraftStatus;
  draft: PreliminaryAuditDraft | null;
  draftError: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNotes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

const EMBEDDED_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Matches explicit scheme/www URLs as well as arbitrary bare domain names
// (including newer/longer gTLDs such as .xyz, .photography, .repair, punycode, and subpaths)
// while avoiding false positives on abbreviations ending in a dot (e.g. "Co.", "Inc.") or ratios ("24/7").
const EMBEDDED_URL_REGEX =
  /(?:https?:\/\/|www\.)[^\s<>"']+|(?<![@.\w])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:xn--[a-z0-9]{2,59}|[a-z]{2,24})(?:[/?#][^\s<>"']*)?(?=$|[\s,;!?\])"'<>])/gi;

const EMBEDDED_PHONE_CANDIDATE_REGEX = /(?:\+?\d|\(\d{3}\))[\d\s().-]{5,}\d/g;

function isLikelyPhoneNumber(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) {
    return true;
  }
  if (digits.length === 7 && /^\d{3}[-.\s]\d{4}$/.test(candidate.trim())) {
    return true;
  }
  return false;
}

function isFalsePositiveBareDomain(candidate: string): boolean {
  // Scheme/www matches are always URLs
  if (/^(?:https?:\/\/|www\.)/i.test(candidate)) {
    return false;
  }
  const hostPart = candidate.split(/[/?#]/)[0] || "";
  const labels = hostPart.split(".");
  if (labels.length === 2) {
    const [stem, tld] = labels;
    // Guard against single-character initials like "A.Co" if ever written without space,
    // while still catching short single-char domains on known TLDs like x.com / t.co / g.io
    if (stem.length === 1 && !/^(?:com|net|org|io|co|ai|us|uk|de|ca|xyz|dev|app)$/i.test(tld)) {
      return true;
    }
  }
  return false;
}

export function findEmbeddedContactOrUrl(value: string): "email" | "url" | "phone" | null {
  if (!value) return null;

  EMBEDDED_EMAIL_REGEX.lastIndex = 0;
  if (EMBEDDED_EMAIL_REGEX.test(value)) {
    return "email";
  }

  EMBEDDED_URL_REGEX.lastIndex = 0;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = EMBEDDED_URL_REGEX.exec(value)) !== null) {
    if (!isFalsePositiveBareDomain(urlMatch[0])) {
      return "url";
    }
  }

  EMBEDDED_PHONE_CANDIDATE_REGEX.lastIndex = 0;
  let phoneMatch: RegExpExecArray | null;
  while ((phoneMatch = EMBEDDED_PHONE_CANDIDATE_REGEX.exec(value)) !== null) {
    if (isLikelyPhoneNumber(phoneMatch[0])) {
      return "phone";
    }
  }

  return null;
}

export function scrubEmbeddedPiiAndUrls(value: string): string {
  if (!value) return "";

  let scrubbed = value.replace(EMBEDDED_EMAIL_REGEX, "[redacted-email]");
  scrubbed = scrubbed.replace(EMBEDDED_URL_REGEX, (candidate) =>
    isFalsePositiveBareDomain(candidate) ? candidate : "[redacted-url]"
  );
  scrubbed = scrubbed.replace(EMBEDDED_PHONE_CANDIDATE_REGEX, (candidate) =>
    isLikelyPhoneNumber(candidate) ? "[redacted-phone]" : candidate
  );

  return scrubbed.replace(/\s{2,}/g, " ").trim();
}
