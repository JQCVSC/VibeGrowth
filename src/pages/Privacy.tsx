import { motion } from "motion/react";
import { ShieldCheck, Lock, Server, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export const Privacy = () => {
  return (
    <div className="pt-36 pb-24 px-6 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-14"
        >
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary mb-4">
            <ShieldCheck className="w-4 h-4" />
            Legal & Data Handling
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter leading-none mb-6 uppercase">
            Privacy <span className="text-brand-primary italic">Policy</span>
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
            The technical data-handling disclosures below accurately describe how this web application processes data. Before public launch, the business owner must replace all{" "}
            <code className="text-yellow-200">[OWNER ACTION REQUIRED: ...]</code>{" "}
            fields with verified business entity, address, and contact details reviewed by legal counsel.
          </div>
        </div>

        <div className="space-y-8">
          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              1. Who Operates This Website
            </h2>
            <p className="text-white/70 leading-relaxed">
              This website is operated by VibeGrowth Agency (Legal Entity:{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: Legal Entity Name]</span>,
              Mailing Address:{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: Business Mailing Address]</span>,
              Privacy Contact:{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: privacy@yourdomain.com]</span>).
            </p>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <div className="flex items-center gap-3 text-brand-primary">
              <Server className="w-5 h-5" />
              <h2 className="text-2xl font-display font-bold uppercase tracking-tight text-white">
                2. Visibility Review & Audit Intake Requests
              </h2>
            </div>
            <p className="text-white/70 leading-relaxed">
              When you submit the Visibility Review request modal, we collect your business name,
              industry/trade, service area, email address, and any optional phone number, website
              URL, or Google Business Profile URL you choose to enter.
            </p>
            <ul className="space-y-3 text-white/70 list-disc pl-6 leading-relaxed">
              <li>
                <strong className="text-white">How AI Preliminary Drafts Work:</strong> To help our
                team prepare internally, your business name, industry, service area (validated and
                scrubbed to remove embedded emails, phone numbers, and URLs), and yes/no flags
                indicating whether a website or Google Business Profile link was entered are sent
                server-side to Google Cloud Vertex AI.
              </li>
              <li>
                <strong className="text-white">What Stays Private:</strong> Your email address,
                phone number, and actual website or Google Business Profile URLs are{" "}
                <strong className="text-white">never</strong> sent to Vertex AI. Those fields are
                stored privately in Cloud Firestore for authorized human strategist review only.
              </li>
              <li>
                <strong className="text-white">Manual Review Only:</strong> Submitting the form
                does not automatically inspect live Google rankings, record a video, or send an
                automated email. Any follow-up is prepared manually by a human strategist.
              </li>
            </ul>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <div className="flex items-center gap-3 text-brand-primary">
              <Lock className="w-5 h-5" />
              <h2 className="text-2xl font-display font-bold uppercase tracking-tight text-white">
                3. Contact Forms, Accounts & Payments
              </h2>
            </div>
            <ul className="space-y-3 text-white/70 list-disc pl-6 leading-relaxed">
              <li>
                <strong className="text-white">Contact Form Inquiries:</strong> Information you
                enter on the Contact page (full name, email, brand name, selected service, and
                message) is stored in Cloud Firestore so our team can respond to your inquiry.
              </li>
              <li>
                <strong className="text-white">Google Sign-In (Firebase Authentication):</strong>{" "}
                If you sign in to complete a service payment or access authorized administrative
                tools, Firebase Authentication verifies your Google account identity (UID, display
                name, and email).
              </li>
              <li>
                <strong className="text-white">Payment Processing (Stripe):</strong> Credit card
                and payment method details are collected and processed directly by Stripe. We do
                not store raw card numbers on our servers; we store server-verified Stripe Payment
                Intent IDs, payment status, currency, amount, and selected plan names in Cloud
                Firestore to confirm completed orders.
              </li>
            </ul>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              4. Abuse Prevention, Security Hashing & Retention
            </h2>
            <p className="text-white/70 leading-relaxed">
              To protect our audit intake pipeline from spam, duplicate retry storms, and abuse, our
              server processes short-lived rate-limit and deduplication records in Cloud Firestore:
            </p>
            <ul className="space-y-3 text-white/70 list-disc pl-6 leading-relaxed">
              <li>
                IP addresses, normalized email addresses, and submission fingerprints in rate-limit
                and deduplication collections are stored only as one-way SHA-256 cryptographic
                hashes — never as raw IP addresses or raw emails.
              </li>
              <li>
                Sliding-window rate-limit and deduplication records carry short-term expiration
                timestamps (15 to 60 minutes) and are purged automatically via Firestore TTL
                policies and scheduled server cleanup.
              </li>
              <li>
                Aggregate daily AI usage counters contain no personal information and expire after
                up to 30 days. Lead, audit review, and payment records are retained as needed to
                deliver requested services and comply with accounting or legal obligations.
              </li>
            </ul>
          </section>

          <section className="glass rounded-[32px] p-8 md:p-10 space-y-4">
            <h2 className="text-2xl font-display font-bold uppercase tracking-tight">
              5. Your Choices & Contact
            </h2>
            <p className="text-white/70 leading-relaxed">
              You may request access to, correction of, or deletion of inquiry or audit contact
              records you submitted by contacting{" "}
              <span className="text-white">[OWNER ACTION REQUIRED: privacy@yourdomain.com]</span>{" "}
              or via our{" "}
              <Link to="/contact" className="text-brand-primary underline hover:text-white">
                Contact page
              </Link>
              . Also review our{" "}
              <Link to="/terms" className="text-brand-primary underline hover:text-white">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
