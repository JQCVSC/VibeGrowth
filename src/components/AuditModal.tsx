import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { useAudit } from "../context/AuditContext";
import {
  ALLOWED_AUDIT_INDUSTRIES,
  findEmbeddedContactOrUrl,
} from "../../shared/audit";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+()\-. \s]{7,30}$/;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export const AuditModal = () => {
  const { isAuditModalOpen, closeAuditModal } = useAudit();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hpContact, setHpContact] = useState("");
  const [submissionId, setSubmissionId] = useState<string>(() => createSubmissionId());
  const [formState, setFormState] = useState({
    businessName: "",
    industry: "Roofing",
    serviceArea: "San Tan Valley, AZ",
    email: "",
    phone: "",
    websiteUrl: "",
    googleProfileUrl: "",
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const updateFormField = (
    field: keyof typeof formState,
    value: string
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    setSubmissionId(createSubmissionId());
    if (error) {
      setError(null);
    }
  };

  const resetAndClose = () => {
    closeAuditModal();
    setTimeout(() => {
      setIsSubmitted(false);
      setError(null);
      setHpContact("");
      setSubmissionId(createSubmissionId());
      setFormState({
        businessName: "",
        industry: "Roofing",
        serviceArea: "San Tan Valley, AZ",
        email: "",
        phone: "",
        websiteUrl: "",
        googleProfileUrl: "",
      });
    }, 500);
  };

  useEffect(() => {
    if (!isAuditModalOpen) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const container = dialogRef.current;
      if (!container) return;
      const firstFocusable = container.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([tabindex="-1"]):not([disabled]), select:not([disabled]), button:not([disabled])'
      );
      (firstFocusable || container).focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resetAndClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from<HTMLElement>(
          dialogRef.current.querySelectorAll(
            'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isAuditModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const businessName = formState.businessName.trim();
    const industry = formState.industry.trim();
    const serviceArea = formState.serviceArea.trim();
    const email = formState.email.trim();
    const phone = formState.phone.trim();
    const websiteUrl = formState.websiteUrl.trim();
    const googleProfileUrl = formState.googleProfileUrl.trim();

    if (businessName.length < 1 || businessName.length > 120) {
      setError("Please enter a valid business name (1–120 characters).");
      return;
    }
    if (findEmbeddedContactOrUrl(businessName)) {
      setError(
        "Please keep email addresses, phone numbers, and URLs out of Business Name — use the dedicated fields below."
      );
      return;
    }
    if (
      !ALLOWED_AUDIT_INDUSTRIES.includes(
        industry as (typeof ALLOWED_AUDIT_INDUSTRIES)[number]
      )
    ) {
      setError("Please select a valid industry.");
      return;
    }
    if (serviceArea.length < 2 || serviceArea.length > 120) {
      setError("Please enter your service area (2–120 characters).");
      return;
    }
    if (findEmbeddedContactOrUrl(serviceArea)) {
      setError(
        "Please keep email addresses, phone numbers, and URLs out of Service Area — use the dedicated fields below."
      );
      return;
    }
    if (email.length < 5 || email.length > 254 || !EMAIL_REGEX.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (phone.length > 0 && (phone.length > 30 || !PHONE_REGEX.test(phone))) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (
      websiteUrl.length > 0 &&
      (websiteUrl.length > 300 || !isValidHttpUrl(websiteUrl))
    ) {
      setError("Website URL must start with http:// or https://.");
      return;
    }
    if (
      googleProfileUrl.length > 0 &&
      (googleProfileUrl.length > 500 || !isValidHttpUrl(googleProfileUrl))
    ) {
      setError("Google Business Profile URL must start with http:// or https://.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submissionId,
        },
        body: JSON.stringify({
          businessName,
          industry,
          serviceArea,
          email,
          phone,
          websiteUrl,
          googleProfileUrl,
          hpContact,
          submissionId,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setSubmissionId(createSubmissionId());
      }
      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong submitting your request. Please try again."
        );
      }

      setIsSubmitted(true);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError(
          "The request timed out. You can safely click Submit again — retries will not create a duplicate request."
        );
      } else {
        setError(
          err?.message ||
            "Something went wrong submitting your request. Please check your details and try again."
        );
      }
    } finally {
      clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            onClick={resetAndClose}
            aria-hidden="true"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-modal-title"
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto glass rounded-[40px] border border-white/10 p-8 md:p-12 focus:outline-none"
          >
            <button
              type="button"
              onClick={resetAndClose}
              aria-label="Close visibility review modal"
              className="absolute top-6 right-6 z-10 w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>

            {!isSubmitted ? (
              <div>
                <div className="mb-8">
                  <h2
                    id="audit-modal-title"
                    className="text-4xl font-display font-bold mb-4 tracking-tighter"
                  >
                    REQUEST A <span className="text-brand-primary italic">VISIBILITY REVIEW</span>
                  </h2>
                  <p className="text-white/50">
                    Submit your business details below. We store your request and prepare an internal preliminary planning draft for a strategist to manually review before reaching out by email.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Honeypot anti-spam field */}
                  <input
                    type="text"
                    name="hpContact"
                    tabIndex={-1}
                    autoComplete="off"
                    value={hpContact}
                    onChange={(e) => setHpContact(e.target.value)}
                    className="hidden"
                    aria-hidden="true"
                  />

                  <div className="space-y-2">
                    <label
                      htmlFor="audit-business-name"
                      className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                    >
                      Business Name
                    </label>
                    <input
                      id="audit-business-name"
                      required
                      maxLength={120}
                      type="text"
                      placeholder="e.g. San Tan Roofing Co."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.businessName}
                      onChange={(e) => updateFormField("businessName", e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label
                        htmlFor="audit-industry"
                        className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                      >
                        Industry / Trade
                      </label>
                      <select
                        id="audit-industry"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors appearance-none"
                        value={formState.industry}
                        onChange={(e) => updateFormField("industry", e.target.value)}
                      >
                        {ALLOWED_AUDIT_INDUSTRIES.map((ind) => (
                          <option key={ind} value={ind} className="bg-brand-secondary">
                            {ind}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="audit-service-area"
                        className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                      >
                        Service Area
                      </label>
                      <input
                        id="audit-service-area"
                        required
                        maxLength={120}
                        type="text"
                        placeholder="e.g. San Tan Valley, Johnson Ranch"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                        value={formState.serviceArea}
                        onChange={(e) => updateFormField("serviceArea", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label
                        htmlFor="audit-email"
                        className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                      >
                        Email Address
                      </label>
                      <input
                        id="audit-email"
                        required
                        maxLength={254}
                        type="email"
                        placeholder="your@email.com"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                        value={formState.email}
                        onChange={(e) => updateFormField("email", e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="audit-phone"
                        className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                      >
                        Phone Number (Optional)
                      </label>
                      <input
                        id="audit-phone"
                        maxLength={30}
                        type="tel"
                        placeholder="(480) 000-0000"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                        value={formState.phone}
                        onChange={(e) => updateFormField("phone", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="audit-website-url"
                      className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                    >
                      Website URL (Optional)
                    </label>
                    <input
                      id="audit-website-url"
                      maxLength={300}
                      type="url"
                      placeholder="https://yourbusiness.com"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.websiteUrl}
                      onChange={(e) => updateFormField("websiteUrl", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="audit-google-profile-url"
                      className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4 block"
                    >
                      Google Business Profile Link (Optional)
                    </label>
                    <input
                      id="audit-google-profile-url"
                      maxLength={500}
                      type="url"
                      placeholder="https://maps.google.com/..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.googleProfileUrl}
                      onChange={(e) => updateFormField("googleProfileUrl", e.target.value)}
                    />
                  </div>

                  <p className="text-xs text-white/45 leading-relaxed px-2">
                    Privacy Notice: Your business name, industry, service area (with embedded emails, phone numbers, and URLs blocked/scrubbed), and yes/no flags indicating whether website or profile links were entered are sent to Google Cloud Vertex AI to prepare an internal preliminary draft. Your email, phone number, and actual URLs stay private for human review only.
                  </p>

                  {error && (
                    <p
                      role="alert"
                      aria-live="assertive"
                      className="text-red-500 text-sm text-center"
                    >
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-brand-primary text-white py-6 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Submitting Request...
                      </>
                    ) : (
                      <>
                        Submit Review Request <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-10"
              >
                <div className="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <CheckCircle2 className="w-10 h-10 text-brand-primary" aria-hidden="true" />
                </div>
                <h2 id="audit-modal-title" className="text-4xl font-display font-bold mb-6">
                  REQUEST SAVED!
                </h2>
                <p className="text-xl text-white/70 leading-relaxed mb-10">
                  Your details have been saved and queued with an internal preliminary draft for our team. This form does not automatically inspect live rankings, create a video, or send an email — a strategist manually reviews your online presence before reaching out to your inbox.
                </p>
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="bg-white text-black px-10 py-4 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-primary hover:text-white transition-all"
                >
                  Close Window
                </button>
              </motion.div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
