import React, { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { motion } from "motion/react";
import { CreditCard, CheckCircle2, AlertCircle, Loader2, LogIn, ArrowRight, Zap, ShieldCheck } from "lucide-react";
import { db, auth } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { useNavigate } from "react-router-dom";

// Load Stripe publishable key from environment variables
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

const PRICING_PLANS = [
  {
    id: "activation",
    name: "The Activation",
    price: 19900,
    displayPrice: "$199",
    period: "One-Time Setup",
    description: "\"We get your digital foundation poured so Google actually knows you exist in San Tan Valley.\"",
    target: "New Businesses / Digital Foundation",
    featureHeader: "What's Included:",
    features: [
      "The \"Instant Lead\" Site: A fast, mobile-friendly landing page designed to make the phone ring.",
      "The Review Engine Kit: Custom QR Codes and a printable \"Review Flyer\" to get 5-star ratings on the job site.",
      "The Profile Blueprint: Exact keywords, categories, and bio to copy-paste into your Google Profile for maximum ranking.",
      "Pro Share Assets: Professional link previews so your business looks elite when you text customers your website."
    ],
    pitch: "We get your digital foundation poured so Google actually knows you exist in San Tan Valley.",
    icon: <Zap className="w-6 h-6" />,
    color: "bg-blue-500/20 text-blue-400"
  },
  {
    id: "tier1",
    name: "On-Demand Growth Menu",
    price: 2900,
    displayPrice: "From $29",
    period: "Pay-As-You-Go Fixes",
    description: "\"No monthly bills. Just call or text when you need a boost to beat the competition.\"",
    target: "Solo-operators (Handymen, House Cleaners)",
    featureHeader: "The Menu:",
    features: [
      "$49 | The \"Competition Gap\" Report",
      "$29 | The \"Review Response\" Pack",
      "$29 | The \"Local Pulse\" Post",
      "$39 | The \"Site Refresh\""
    ],
    subItems: [
      { id: "gap-report", name: "The \"Competition Gap\" Report", price: 4900, description: "A deep-dive audit showing exactly why your #1 local competitor is beating you and how to take their spot." },
      { id: "review-pack", name: "The \"Review Response\" Pack", price: 2900, description: "Professional, SEO-optimized responses for your 5 most recent reviews to help you climb the Google Map Pack." },
      { id: "local-pulse", name: "The \"Local Pulse\" Post", price: 2900, description: "One custom Google Business update (e.g., Monsoon Prep, Local Project Showcase) to keep your profile active." },
      { id: "site-refresh", name: "The \"Site Refresh\"", price: 3900, description: "A quick update to your landing page—adding new \"Before & After\" photos or updating your service list." }
    ],
    pitch: "No monthly bills. Just call or text when you need a boost to beat the competition.",
    icon: <ShieldCheck className="w-6 h-6" />,
    color: "bg-green-500/20 text-green-400",
    popular: true
  }
];

const CheckoutForm = ({ amount, clientSecret, planName }: { amount: number, clientSecret: string, planName: string }) => {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsLoading(true);

    // Record the payment attempt in Firestore
    try {
      if (auth.currentUser) {
        await addDoc(collection(db, "payments"), {
          userId: auth.currentUser.uid,
          amount,
          planName,
          status: "pending",
          createdAt: serverTimestamp(),
          stripePaymentIntentId: clientSecret.split('_secret_')[0],
        });
      }
    } catch (err) {
      console.error("Error recording payment attempt:", err);
    }

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment-success`,
      },
      redirect: 'if_required',
    });

    if (error) {
      if (error.type === "card_error" || error.type === "validation_error") {
        setMessage(error.message || "An error occurred.");
      } else {
        setMessage("An unexpected error occurred.");
      }
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      // Manual navigation for success state to avoid iframe redirect issues
      navigate(`/payment-success?payment_intent=${paymentIntent.id}&redirect_status=succeeded`);
    }

    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement className="bg-white/5 p-4 rounded-2xl border border-white/10" />
      <button
        disabled={isLoading || !stripe || !elements}
        className="w-full bg-brand-primary text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          `Pay ${(amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
        )}
      </button>
      {message && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 p-4 rounded-xl border border-red-400/20">
          <AlertCircle className="w-4 h-4" />
          {message}
        </div>
      )}
    </form>
  );
};

export const Payment = () => {
  const [clientSecret, setClientSecret] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<typeof PRICING_PLANS[0] | null>(null);
  const [selectedSubItems, setSelectedSubItems] = useState<string[]>([]);
  const [step, setStep] = useState<"plans" | "selection" | "checkout">("plans");
  const [user, setUser] = useState(auth.currentUser);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  const calculateTotal = () => {
    if (!selectedPlan) return 0;
    if (selectedPlan.id === "activation") return selectedPlan.price;
    
    return selectedPlan.subItems?.reduce((acc, item) => {
      if (selectedSubItems.includes(item.id)) return acc + item.price;
      return acc;
    }, 0) || 0;
  };

  const handleSelectPlan = (plan: typeof PRICING_PLANS[0]) => {
    if (!user) {
      handleLogin();
      return;
    }

    setSelectedPlan(plan);
    if (plan.subItems) {
      setStep("selection");
    } else {
      initializeCheckout(plan.price);
    }
  };

  const initializeCheckout = async (amount: number) => {
    setStep("checkout");
    setIsInitializing(true);
    setClientSecret("");
    setConfigError(null);

    if (!STRIPE_PUBLISHABLE_KEY) {
      setIsInitializing(false);
      return;
    }

    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to initialize payment");
      }

      const data = await res.json();
      setClientSecret(data.clientSecret);
    } catch (err: any) {
      console.error("Error creating payment intent:", err);
      setConfigError(err.message);
    } finally {
      setIsInitializing(false);
    }
  };

  const toggleSubItem = (id: string) => {
    setSelectedSubItems(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return;
      }
      console.error("Login Error:", error);
    }
  };

  const appearance = {
    theme: 'night' as const,
    variables: {
      colorPrimary: '#FF5C00',
      colorBackground: '#1A1A1A',
      colorText: '#ffffff',
      colorDanger: '#df1b41',
      fontFamily: 'Inter, system-ui, sans-serif',
      spacingUnit: '4px',
      borderRadius: '16px',
    },
  };

  return (
    <div className="pt-40 pb-20 px-6 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {step === "plans" ? (
          <div className="space-y-20">
            <div className="text-center max-w-3xl mx-auto">
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-5xl md:text-7xl font-display font-bold tracking-tighter uppercase mb-6"
              >
                Local Growth <br />
                <span className="text-brand-primary italic">Pricing</span>
              </motion.h1>
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-xl text-white/50"
              >
                Simple, transparent pricing for San Tan Valley businesses. <br />
                Choose the tier that matches your growth goals.
              </motion.p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {PRICING_PLANS.map((plan, index) => (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`glass p-8 rounded-[40px] flex flex-col relative overflow-hidden group ${plan.popular ? 'border-brand-primary/50' : ''}`}
                >
                  {plan.popular && (
                    <div className="absolute top-6 right-6 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}
                  
                  <div className={`w-12 h-12 ${plan.color} rounded-2xl flex items-center justify-center mb-6`}>
                    {plan.icon}
                  </div>

                  <h3 className="text-2xl font-display font-bold mb-2 uppercase tracking-tight">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-4xl font-display font-bold">{plan.displayPrice}</span>
                    <span className="text-white/40 text-sm font-bold uppercase tracking-widest">{plan.period}</span>
                  </div>

                  <p className="text-white/50 text-sm mb-8 leading-relaxed">
                    {plan.description}
                  </p>

                  <div className="space-y-4 mb-10 flex-grow">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary">{plan.featureHeader || "What's Included:"}</p>
                    {plan.features.map((feature, fIndex) => (
                      <div key={fIndex} className="flex items-start gap-3 text-sm text-white/70">
                        <CheckCircle2 className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-6 border-t border-white/10">
                    <p className="text-xs italic text-white/40 mb-6">"{plan.pitch}"</p>
                    <button
                      onClick={() => handleSelectPlan(plan)}
                      className={`w-full py-4 rounded-2xl font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        plan.popular 
                          ? 'bg-brand-primary text-white hover:scale-105' 
                          : 'bg-white/5 text-white hover:bg-white/10'
                      }`}
                    >
                      Select Plan <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : step === "selection" && selectedPlan ? (
          <div className="max-w-2xl mx-auto">
            <button 
              onClick={() => setStep("plans")}
              className="mb-8 text-white/40 hover:text-white flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors"
            >
              <ArrowRight className="w-4 h-4 rotate-180" /> Back to Plans
            </button>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass p-8 md:p-12 rounded-[40px] relative overflow-hidden"
            >
              <div className="relative z-10">
                <h2 className="text-3xl font-display font-bold tracking-tighter uppercase mb-2">{selectedPlan.name}</h2>
                <p className="text-white/50 mb-8">Select the services you need today. No monthly commitment.</p>

                <div className="space-y-4 mb-10">
                  {selectedPlan.subItems?.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleSubItem(item.id)}
                      className={`w-full text-left p-6 rounded-3xl border transition-all flex items-center gap-4 ${
                        selectedSubItems.includes(item.id)
                          ? 'bg-brand-primary/10 border-brand-primary'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                        selectedSubItems.includes(item.id)
                          ? 'bg-brand-primary border-brand-primary'
                          : 'border-white/20'
                      }`}>
                        {selectedSubItems.includes(item.id) && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                      <div className="flex-grow">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold">{item.name}</span>
                          <span className="text-brand-primary font-display font-bold">${item.price / 100}</span>
                        </div>
                        <p className="text-xs text-white/40">{item.description}</p>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="p-6 bg-white/5 rounded-3xl border border-white/10 mb-8">
                  <div className="flex justify-between items-center text-xl font-display font-bold">
                    <span>Total</span>
                    <span className="text-brand-primary italic">${calculateTotal() / 100}</span>
                  </div>
                </div>

                <button
                  disabled={selectedSubItems.length === 0}
                  onClick={() => initializeCheckout(calculateTotal())}
                  className="w-full bg-brand-primary text-white py-5 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
                >
                  Proceed to Checkout
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <button 
              onClick={() => selectedPlan?.subItems ? setStep("selection") : setStep("plans")}
              className="mb-8 text-white/40 hover:text-white flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors"
            >
              <ArrowRight className="w-4 h-4 rotate-180" /> {selectedPlan?.subItems ? "Back to Menu" : "Back to Plans"}
            </button>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass p-8 md:p-12 rounded-[40px] relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/10 blur-[100px]" />
              
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-brand-primary/20 rounded-2xl flex items-center justify-center text-brand-primary">
                    <CreditCard className="w-6 h-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-display font-bold tracking-tighter uppercase">Secure Checkout</h1>
                    <img 
                      src="https://i.imgur.com/nI2CZ2l.png" 
                      alt="VIBEGROWTH" 
                      className="h-6 w-auto opacity-50" 
                      referrerPolicy="no-referrer" 
                    />
                  </div>
                </div>

                <div className="mb-10 p-6 bg-white/5 rounded-3xl border border-white/10">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-white/60">{selectedPlan?.name}</span>
                    <span className="font-bold">${calculateTotal() / 100}</span>
                  </div>
                  {selectedSubItems.length > 0 && (
                    <div className="space-y-1 mb-4">
                      {selectedPlan?.subItems?.filter(item => selectedSubItems.includes(item.id)).map(item => (
                        <div key={item.id} className="flex justify-between items-center text-[10px] text-white/30 uppercase tracking-widest">
                          <span>• {item.name}</span>
                          <span>${item.price / 100}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="h-px bg-white/10 mb-4" />
                  <div className="flex justify-between items-center text-xl font-display font-bold">
                    <span>Total</span>
                    <span className="text-brand-primary italic">${calculateTotal() / 100}</span>
                  </div>
                </div>

                {!STRIPE_PUBLISHABLE_KEY || configError ? (
                  <div className="p-8 bg-brand-primary/5 rounded-3xl border border-brand-primary/20 text-center">
                    <AlertCircle className="w-12 h-12 text-brand-primary mx-auto mb-4" />
                    <h3 className="text-xl font-display font-bold mb-2 uppercase">Payment Setup Required</h3>
                    <p className="text-white/50 text-sm mb-6">
                      {configError || "Stripe keys are not yet configured. You can continue building the rest of the site and add the keys later via the AI Studio Secrets panel."}
                    </p>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">
                      DEVELOPMENT MODE
                    </div>
                  </div>
                ) : clientSecret && stripePromise ? (
                  <Elements options={{ clientSecret, appearance }} stripe={stripePromise}>
                    <CheckoutForm amount={calculateTotal()} clientSecret={clientSecret} planName={selectedPlan?.name || ""} />
                  </Elements>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
                    <p className="text-white/40 text-sm uppercase tracking-widest font-bold">Initializing Secure Payment...</p>
                  </div>
                )}

                <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-widest text-white/20">
                  <div className="flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Secure SSL
                  </div>
                  <div className="flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Stripe Verified
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
};
