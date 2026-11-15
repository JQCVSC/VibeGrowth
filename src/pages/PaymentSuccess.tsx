import React from "react";
import { motion } from "motion/react";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { db, auth } from "../firebase";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { useEffect } from "react";

export const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const paymentIntentId = searchParams.get("payment_intent");

  useEffect(() => {
    const updatePaymentStatus = async () => {
      if (paymentIntentId && auth.currentUser) {
        try {
          const q = query(
            collection(db, "payments"),
            where("stripePaymentIntentId", "==", paymentIntentId),
            where("userId", "==", auth.currentUser.uid)
          );
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach(async (document) => {
            await updateDoc(doc(db, "payments", document.id), {
              status: "completed",
            });
          });
        } catch (err) {
          console.error("Error updating payment status:", err);
        }
      }
    };

    updatePaymentStatus();
  }, [paymentIntentId]);
  return (
    <div className="pt-40 pb-20 px-6 min-h-screen flex items-center justify-center">
      <div className="max-w-2xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass p-12 md:p-24 rounded-[60px] relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-full bg-brand-primary/5 blur-[100px]" />
          
          <div className="relative z-10">
            <div className="w-24 h-24 bg-brand-primary/20 rounded-full flex items-center justify-center mx-auto mb-10">
              <CheckCircle2 className="w-12 h-12 text-brand-primary" />
            </div>

            <div className="flex items-center justify-center gap-2 mb-8 opacity-50">
              <img 
                src="https://i.imgur.com/nI2CZ2l.png" 
                alt="VIBEGROWTH" 
                className="h-8 w-auto" 
                referrerPolicy="no-referrer" 
              />
              <span className="font-display font-bold text-lg tracking-tighter uppercase">
                VIBE<span className="text-brand-primary italic">GROWTH</span>
              </span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter mb-8 uppercase">
              PAYMENT <br />
              <span className="text-brand-primary italic">SUCCESSFUL</span>
            </h1>
            
            <p className="max-w-md mx-auto text-xl text-white/50 mb-12 leading-relaxed">
              Your order for the Local Visibility Audit & Setup has been confirmed. Our team will contact you within 24 hours to begin your local domination.
            </p>
            
            <Link 
              to="/" 
              className="bg-brand-primary text-white px-12 py-6 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-110 transition-transform flex items-center justify-center gap-2 mx-auto w-fit"
            >
              Return Home <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
