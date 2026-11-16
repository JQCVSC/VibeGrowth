import { motion } from "motion/react";
import { Send, MapPin, Mail, Phone, Instagram, Twitter, Linkedin, Loader2 } from "lucide-react";
import { useState, FormEvent } from "react";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { logFirestoreError, OperationType } from "../lib/firestoreError";

const ALLOWED_SERVICES = [
  "Google Maps Dominance",
  "Review Automation & AI",
  "Instant Lead Landing Page",
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Contact = () => {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    brand: "",
    service: "Google Maps Dominance",
    message: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (honeypot.trim().length > 0) {
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 5000);
      return;
    }

    const name = formState.name.trim();
    const email = formState.email.trim();
    const brand = formState.brand.trim();
    const service = formState.service.trim();
    const message = formState.message.trim();

    if (name.length < 1 || name.length > 100) {
      setError("Please enter your name (1–100 characters).");
      return;
    }
    if (email.length < 5 || email.length > 254 || !EMAIL_REGEX.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (brand.length > 120) {
      setError("Brand name must be 120 characters or fewer.");
      return;
    }
    if (!ALLOWED_SERVICES.includes(service as (typeof ALLOWED_SERVICES)[number])) {
      setError("Please select a valid service.");
      return;
    }
    if (message.length > 2000) {
      setError("Message must be 2000 characters or fewer.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await addDoc(collection(db, "leads"), {
        name,
        email,
        brand,
        service,
        message,
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
      setFormState({
        name: "",
        email: "",
        brand: "",
        service: "Google Maps Dominance",
        message: "",
      });
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, "leads");
      setError("Something went wrong. Please check your details and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pt-40 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}>
            <h1 className="text-6xl md:text-8xl font-display font-bold tracking-tighter mb-8">
              LET'S <span className="text-brand-primary italic">TALK</span>
            </h1>
            <p className="text-xl text-white/50 mb-12 max-w-md leading-relaxed">
              Have a project in mind? We'd love to hear from you. Fill out the form and our team will get back to you within 24 hours.
            </p>

            <div className="space-y-8 mb-12">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-brand-primary">
                  <Mail className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">
                    Email Us
                  </div>
                  <div className="text-lg font-medium">hello@vibegrowth.agency</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-brand-primary">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">
                    Visit Us
                  </div>
                  <div className="text-lg font-medium">San Tan Valley, AZ 85140</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-brand-primary">
                  <Phone className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">
                    Call Us
                  </div>
                  <div className="text-lg font-medium">+1 (480) 555-0123</div>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              {[Instagram, Twitter, Linkedin].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="w-12 h-12 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors"
                >
                  <Icon className="w-5 h-5" />
                </a>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass p-8 md:p-12 rounded-[40px] relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/10 blur-[100px]" />

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="h-full flex flex-col items-center justify-center text-center py-20"
              >
                <div className="w-20 h-20 bg-brand-primary rounded-full flex items-center justify-center mb-8">
                  <Send className="text-white w-10 h-10" />
                </div>
                <h2 className="text-4xl font-display font-bold mb-4">MESSAGE SENT!</h2>
                <p className="text-white/50">
                  We'll be in touch shortly. Check your inbox for a confirmation email.
                </p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                {/* Honeypot anti-spam field */}
                <input
                  type="text"
                  name="companyWebsite"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Full Name
                    </label>
                    <input
                      required
                      maxLength={100}
                      type="text"
                      placeholder="John Doe"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.name}
                      onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Email Address
                    </label>
                    <input
                      required
                      maxLength={254}
                      type="email"
                      placeholder="john@example.com"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Brand Name
                    </label>
                    <input
                      maxLength={120}
                      type="text"
                      placeholder="Your Company"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.brand}
                      onChange={(e) => setFormState({ ...formState, brand: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                      Service Needed
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors appearance-none"
                      value={formState.service}
                      onChange={(e) => setFormState({ ...formState, service: e.target.value })}
                    >
                      {ALLOWED_SERVICES.map((svc) => (
                        <option key={svc} value={svc} className="bg-brand-secondary">
                          {svc}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">
                    Your Message
                  </label>
                  <textarea
                    rows={4}
                    maxLength={2000}
                    placeholder="Tell us about your project..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                    value={formState.message}
                    onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  />
                </div>

                {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-brand-primary text-white py-5 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Message"
                  )}
                </button>
              </form>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};
