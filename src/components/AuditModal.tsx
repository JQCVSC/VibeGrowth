import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { useAudit } from "../context/AuditContext";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { logFirestoreError, OperationType } from "../lib/firestoreError";

const ALLOWED_INDUSTRIES = [
  "Roofing",
  "Landscaping",
  "Plumbing",
  "HVAC",
  "Electrical",
  "Other Service Pro",
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+()\-. \s]{7,30}$/;

export const AuditModal = () => {
  const { isAuditModalOpen, closeAuditModal } = useAudit();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [formState, setFormState] = useState({
    businessName: "",
    industry: "Roofing",
    email: "",
    phone: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Silent honeypot drop for automated form spam
    if (honeypot.trim().length > 0) {
      setIsSubmitted(true);
      return;
    }

    const businessName = formState.businessName.trim();
    const industry = formState.industry.trim();
    const email = formState.email.trim();
    const phone = formState.phone.trim();

    if (businessName.length < 1 || businessName.length > 120) {
      setError("Please enter a valid business name (1–120 characters).");
      return;
    }
    if (!ALLOWED_INDUSTRIES.includes(industry as (typeof ALLOWED_INDUSTRIES)[number])) {
      setError("Please select a valid industry.");
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

    setIsSubmitting(true);
    setError(null);

    try {
      await addDoc(collection(db, "audits"), {
        businessName,
        industry,
        email,
        phone,
        createdAt: serverTimestamp(),
      });
      setIsSubmitted(true);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, "audits");
      setError("Something went wrong submitting your audit. Please check your details and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    closeAuditModal();
    setTimeout(() => {
      setIsSubmitted(false);
      setError(null);
      setHoneypot("");
      setFormState({
        businessName: "",
        industry: "Roofing",
        email: "",
        phone: "",
      });
    }, 500);
  };

  return (
    <AnimatePresence>
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            onClick={resetAndClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-xl glass rounded-[40px] overflow-hidden border border-white/10 p-8 md:p-12"
          >
            <button
              onClick={resetAndClose}
              className="absolute top-6 right-6 z-10 w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {!isSubmitted ? (
              <div>
                <div className="mb-10">
                  <h2 className="text-4xl font-display font-bold mb-4 tracking-tighter">
                    GET YOUR <span className="text-brand-primary italic">FREE AUDIT</span>
                  </h2>
                  <p className="text-white/50">
                    Enter your details below and I'll personally record a video breakdown of your local Google ranking.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Honeypot anti-spam field */}
                  <input
                    type="text"
                    name="websiteUrl"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="hidden"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Business Name
                    </label>
                    <input
                      required
                      maxLength={120}
                      type="text"
                      placeholder="e.g. STV Landscaping Pros"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.businessName}
                      onChange={(e) =>
                        setFormState({ ...formState, businessName: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Industry
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors appearance-none"
                      value={formState.industry}
                      onChange={(e) => setFormState({ ...formState, industry: e.target.value })}
                    >
                      {ALLOWED_INDUSTRIES.map((ind) => (
                        <option key={ind} value={ind} className="bg-brand-secondary">
                          {ind}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Email Address
                    </label>
                    <input
                      required
                      maxLength={254}
                      type="email"
                      placeholder="your@email.com"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Phone Number (Optional)
                    </label>
                    <input
                      maxLength={30}
                      type="tel"
                      placeholder="(480) 000-0000"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.phone}
                      onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    />
                  </div>

                  {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-brand-primary text-white py-6 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Running Audit...
                      </>
                    ) : (
                      <>
                        Run My Local Audit <ArrowRight className="w-4 h-4" />
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
                  <CheckCircle2 className="w-10 h-10 text-brand-primary" />
                </div>
                <h2 className="text-4xl font-display font-bold mb-6">GOT IT!</h2>
                <p className="text-xl text-white/70 leading-relaxed mb-10">
                  I’m running your local audit now. I’m a neighbor here in STV, so I’ll personally record a 2-minute breakdown of your Google ranking and send it to your inbox within 24 hours.
                </p>
                <button
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
