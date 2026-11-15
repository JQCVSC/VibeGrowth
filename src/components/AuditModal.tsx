import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { useAudit } from "../context/AuditContext";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export const AuditModal = () => {
  const { isAuditModalOpen, closeAuditModal } = useAudit();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    businessName: "",
    industry: "Roofing",
    email: "",
    phone: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await addDoc(collection(db, "audits"), {
        ...formState,
        createdAt: serverTimestamp(),
      });
      setIsSubmitted(true);
    } catch (err) {
      console.error("Error submitting audit:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    closeAuditModal();
    setTimeout(() => {
      setIsSubmitted(false);
      setFormState({
        businessName: "",
        industry: "Roofing",
        email: "",
        phone: ""
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
                  <h2 className="text-4xl font-display font-bold mb-4 tracking-tighter">GET YOUR <span className="text-brand-primary italic">FREE AUDIT</span></h2>
                  <p className="text-white/50">Enter your details below and I'll personally record a video breakdown of your local Google ranking.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">Business Name</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. STV Landscaping Pros"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.businessName}
                      onChange={(e) => setFormState({...formState, businessName: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">Industry</label>
                    <select 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors appearance-none"
                      value={formState.industry}
                      onChange={(e) => setFormState({...formState, industry: e.target.value})}
                    >
                      <option className="bg-brand-secondary">Roofing</option>
                      <option className="bg-brand-secondary">Landscaping</option>
                      <option className="bg-brand-secondary">Plumbing</option>
                      <option className="bg-brand-secondary">HVAC</option>
                      <option className="bg-brand-secondary">Electrical</option>
                      <option className="bg-brand-secondary">Other Service Pro</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">Email Address</label>
                    <input 
                      required
                      type="email" 
                      placeholder="your@email.com"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.email}
                      onChange={(e) => setFormState({...formState, email: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-4">Phone Number (Optional)</label>
                    <input 
                      type="tel" 
                      placeholder="(480) 000-0000"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:border-brand-primary transition-colors"
                      value={formState.phone}
                      onChange={(e) => setFormState({...formState, phone: e.target.value})}
                    />
                  </div>

                  {error && (
                    <p className="text-red-500 text-sm text-center">{error}</p>
                  )}

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
