import React, { useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import { CheckCircle2, ArrowRight, Loader2, AlertCircle, Clock, LogIn } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { auth } from "../firebase";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, User } from "firebase/auth";

interface VerifiedPaymentResponse {
  paymentIntentId: string;
  status: "pending" | "completed" | "failed";
  amount: number;
  currency: string;
  planName: string;
  failureReason: string | null;
}

export const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const paymentIntentId = searchParams.get("payment_intent");

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [paymentData, setPaymentData] = useState<VerifiedPaymentResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const verifyPaymentWithServer = useCallback(
    async (activeUser: User, intentId: string) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const idToken = await activeUser.getIdToken();
        const res = await fetch(`/api/payments/${encodeURIComponent(intentId)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Unable to verify payment status.");
        }

        setPaymentData(data as VerifiedPaymentResponse);
      } catch (err: any) {
        console.error("Payment verification error:", err);
        setPaymentData(null);
        setErrorMessage(err?.message || "Could not verify payment status with the server.");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!authReady) return;

    if (!paymentIntentId) {
      setIsLoading(false);
      setErrorMessage("No payment reference was provided in this URL.");
      return;
    }

    if (!user) {
      setIsLoading(false);
      return;
    }

    verifyPaymentWithServer(user, paymentIntentId);
  }, [authReady, user, paymentIntentId, verifyPaymentWithServer]);

  // Poll briefly if webhook confirmation is still in flight
  useEffect(() => {
    if (!user || !paymentIntentId) return;
    if (paymentData?.status !== "pending") return;
    if (pollCount >= 8) return;

    const timer = setTimeout(() => {
      setPollCount((c) => c + 1);
      verifyPaymentWithServer(user, paymentIntentId);
    }, 2000);

    return () => clearTimeout(timer);
  }, [user, paymentIntentId, paymentData?.status, pollCount, verifyPaymentWithServer]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === "auth/popup-closed-by-user") {
        return;
      }
      console.error("Login Error:", error);
    }
  };

  return (
    <div className="pt-40 pb-20 px-6 min-h-screen flex items-center justify-center">
      <div className="max-w-2xl mx-auto text-center w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass p-12 md:p-20 rounded-[60px] relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-full bg-brand-primary/5 blur-[100px]" />

          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-10 opacity-50">
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

            {!authReady || isLoading ? (
              <div className="py-8">
                <div className="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
                </div>
                <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tighter mb-6 uppercase">
                  VERIFYING <span className="text-brand-primary italic">PAYMENT</span>
                </h1>
                <p className="max-w-md mx-auto text-lg text-white/50">
                  Checking confirmed payment status with our server...
                </p>
              </div>
            ) : !user ? (
              <div className="py-4">
                <div className="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <LogIn className="w-10 h-10 text-brand-primary" />
                </div>
                <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tighter mb-6 uppercase">
                  SIGN IN TO <span className="text-brand-primary italic">VERIFY</span>
                </h1>
                <p className="max-w-md mx-auto text-lg text-white/50 mb-10">
                  Please sign in with the Google account you used at checkout so we can verify your payment status.
                </p>
                <button
                  onClick={handleLogin}
                  className="bg-brand-primary text-white px-10 py-5 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-105 transition-transform inline-flex items-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In with Google
                </button>
              </div>
            ) : paymentData?.status === "completed" ? (
              <div>
                <div className="w-24 h-24 bg-brand-primary/20 rounded-full flex items-center justify-center mx-auto mb-10">
                  <CheckCircle2 className="w-12 h-12 text-brand-primary" />
                </div>

                <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter mb-8 uppercase">
                  PAYMENT <br />
                  <span className="text-brand-primary italic">SUCCESSFUL</span>
                </h1>

                <div className="max-w-md mx-auto mb-10 p-6 bg-white/5 rounded-3xl border border-white/10 text-left space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/40 uppercase tracking-widest text-xs font-bold">Plan</span>
                    <span className="font-bold">{paymentData.planName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40 uppercase tracking-widest text-xs font-bold">Amount Paid</span>
                    <span className="font-bold text-brand-primary">
                      {(paymentData.amount / 100).toLocaleString("en-US", {
                        style: "currency",
                        currency: paymentData.currency.toUpperCase(),
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-white/40 uppercase tracking-widest text-xs font-bold">Reference</span>
                    <span className="font-mono text-xs text-white/60 truncate">
                      {paymentData.paymentIntentId}
                    </span>
                  </div>
                </div>

                <p className="max-w-md mx-auto text-lg text-white/50 mb-12 leading-relaxed">
                  Your order has been verified and confirmed. Our team will contact you within 24 hours to get started.
                </p>

                <Link
                  to="/"
                  className="bg-brand-primary text-white px-12 py-6 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-110 transition-transform flex items-center justify-center gap-2 mx-auto w-fit"
                >
                  Return Home <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : paymentData?.status === "pending" ? (
              <div className="py-4">
                <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <Clock className="w-10 h-10 text-yellow-400" />
                </div>
                <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tighter mb-6 uppercase">
                  CONFIRMATION <span className="text-brand-primary italic">PENDING</span>
                </h1>
                <p className="max-w-md mx-auto text-lg text-white/50 mb-10 leading-relaxed">
                  We have received your checkout request and are waiting for final webhook confirmation from Stripe. No charge is confirmed until verified.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={() => paymentIntentId && verifyPaymentWithServer(user, paymentIntentId)}
                    className="bg-brand-primary text-white px-10 py-5 rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform"
                  >
                    Check Status Again
                  </button>
                  <Link
                    to="/"
                    className="border border-white/20 px-10 py-5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-all"
                  >
                    Return Home
                  </Link>
                </div>
              </div>
            ) : (
              <div className="py-4">
                <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <AlertCircle className="w-10 h-10 text-red-400" />
                </div>
                <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tighter mb-6 uppercase">
                  PAYMENT <span className="text-red-400 italic">NOT CONFIRMED</span>
                </h1>
                <p className="max-w-md mx-auto text-lg text-white/50 mb-10 leading-relaxed">
                  {paymentData?.failureReason ||
                    errorMessage ||
                    "We could not confirm this payment. Please return to pricing and try again."}
                </p>
                <Link
                  to="/payment"
                  className="bg-brand-primary text-white px-10 py-5 rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform inline-flex items-center gap-2"
                >
                  Back to Pricing <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
