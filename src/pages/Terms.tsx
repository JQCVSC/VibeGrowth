import { motion } from "motion/react";
import { FileText, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export const Terms = () => {
  return (
    <div className="pt-36 pb-24 px-6 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-14"
        >
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary mb-4">
            <FileText className="w-4 h-4" />
            Service Terms
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter leading-none mb-6 uppercase">
            Terms of <span className="text-brand-primary italic">Service</span>
          </h1>
          <p className="text-white/60 text-lg leading-relaxed">
            Effective Date: <span className="text-white font-medium">[OWNER ACTION REQUIRED: Set Effective Date]</span>
          </p>
        </motion.div>

        <div className="p-6 rounded-3xl bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-4 mb-10">
          <AlertCircle className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm text-white/80 leading-relaxed">
            <strong className="uppercase tracking-wider text-yellow-300 block mb-1">
              Pre-Launch Owner Legal Review Notice
            </strong>
            Replace all{" "}
            <code className="text-yellow-200">[OWNER ACTION REQUIRED: ...]</code>{" "}
            fields with your registered business entity, governing jurisdiction, refund policy, and
            legal contact email before going live.
          </div>
        </div>

        <div className="space-y-8">
          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              1. Acceptance of Terms
            </h2>
            <p className="text-white/70 leading-relaxed">
              By accessing or using this website operated by VibeGrowth Agency (Legal Entity:{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: Legal Entity Name]</span>), you
              agree to these Terms of Service and our{" "}
              <Link to="/privacy" className="text-brand-primary underline hover:text-white">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              2. Free Visibility Review Requests & Preliminary Drafts
            </h2>
            <p className="text-white/70 leading-relaxed">
              Submitting a Visibility Review request saves your details for human review and
              generates an internal preliminary planning draft using Google Cloud Vertex AI. You
              understand and agree that:
            </p>
            <ul className="space-y-3 text-white/70 list-disc pl-6 leading-relaxed">
              <li>
                Submission does not perform an automated crawl of your website, Google Business
                Profile, or live search rankings, and does not automatically send an email or
                video.
              </li>
              <li>
                Any AI-assisted preliminary notes are strictly for internal strategist preparation
                and are verified manually before we share recommendations with you.
              </li>
              <li>
                Submitting a review request or contact inquiry does not create an ongoing agency
                retainer or guarantee specific ranking outcomes.
              </li>
            </ul>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              3. Paid Services & Checkout
            </h2>
            <p className="text-white/70 leading-relaxed">
              Paid activation packages and add-on services are billed in USD through Stripe at the
              server-verified prices shown at checkout. Payment confirmation occurs only after
              Stripe webhook verification. Scope, fulfillment timelines, and refund terms are
              governed by{" "}
              <span className="text-white">
                [OWNER ACTION REQUIRED: Specify Refund/Cancellation Policy & Service SOW Link]
              </span>
              .
            </p>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              4. Acceptable Use
            </h2>
            <p className="text-white/70 leading-relaxed">
              You agree not to submit fraudulent contact information, automated spam, unauthorized
              third-party personal data, or excessive requests designed to bypass rate limits, and
              not to attempt unauthorized access to private administrative routes or systems.
            </p>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              5. Limitation of Liability & Governing Law
            </h2>
            <p className="text-white/70 leading-relaxed">
              To the maximum extent permitted by applicable law, this website is provided on an
              "as-is" and "as-available" basis without warranties of specific search engine
              rankings, revenue, or uninterrupted availability. These Terms are governed by the laws
              of{" "}
              <span className="text-white">
                [OWNER ACTION REQUIRED: Governing State / Jurisdiction]
              </span>
              . Questions may be sent to{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: legal@yourdomain.com]</span>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
