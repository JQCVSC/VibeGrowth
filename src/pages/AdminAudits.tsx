import React, { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { auth } from "../firebase";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, User } from "firebase/auth";
import {
  AUDIT_REVIEW_STATUSES,
  AuditRecord,
  AuditReviewStatus,
  PRELIMINARY_DRAFT_LABEL,
} from "../../shared/audit";

const REVIEW_STATUS_LABELS: Record<AuditReviewStatus, string> = {
  pending_review: "Pending Human Review",
  approved: "Approved (Internal)",
  needs_revision: "Needs Revision",
  archived: "Archived",
};

export const AdminAudits = () => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authErrorState, setAuthErrorState] = useState<"session_expired" | "forbidden" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reviewStatus, setReviewStatus] = useState<AuditReviewStatus>("pending_review");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const fetchAudits = useCallback(async (activeUser: User) => {
    setLoading(true);
    setAuthErrorState(null);
    setError(null);
    try {
      const idToken = await activeUser.getIdToken();
      const res = await fetch("/api/admin/audits", {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (res.status === 401) {
        setAuthErrorState("session_expired");
        setAudits([]);
        return;
      }
      if (res.status === 403) {
        setAuthErrorState("forbidden");
        setAudits([]);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load audit drafts.");
      }

      const list: AuditRecord[] = Array.isArray(data.audits) ? data.audits : [];
      setAudits(list);
      if (list.length > 0) {
        setSelectedId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0].id));
      }
    } catch (err: any) {
      setError(err?.message || "Unable to load audits.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchAudits(user);
  }, [authReady, user, fetchAudits]);

  const selectedAudit = audits.find((a) => a.id === selectedId) || null;

  useEffect(() => {
    if (selectedAudit) {
      setReviewStatus(selectedAudit.reviewStatus);
      setReviewerNotes(selectedAudit.reviewerNotes || "");
      setActionMessage(null);
    }
  }, [selectedAudit?.id, selectedAudit?.reviewStatus, selectedAudit?.reviewerNotes]);

  const handleLogin = async () => {
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      if (credential.user) {
        setUser(credential.user);
        await fetchAudits(credential.user);
      }
    } catch (err: any) {
      if (err.code === "auth/popup-closed-by-user") return;
      setError("Google Sign-In failed. Please try again.");
    }
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedAudit || savingReview) return;

    setSavingReview(true);
    setActionMessage(null);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/admin/audits/${encodeURIComponent(selectedAudit.id)}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            reviewStatus,
            reviewerNotes,
          }),
        }
      );

      if (res.status === 401) {
        setAuthErrorState("session_expired");
        setAudits([]);
        return;
      }
      if (res.status === 403) {
        setAuthErrorState("forbidden");
        setAudits([]);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update review status.");
      }

      const updated: AuditRecord = data.audit;
      setAudits((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setActionMessage("Review status saved internally. Nothing was emailed or published.");
    } catch (err: any) {
      setError(err?.message || "Unable to save review update.");
    } finally {
      setSavingReview(false);
    }
  };

  const handleRegenerateDraft = async () => {
    if (!user || !selectedAudit || regenerating) return;

    setRegenerating(true);
    setActionMessage(null);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/admin/audits/${encodeURIComponent(selectedAudit.id)}/regenerate-draft`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      if (res.status === 401) {
        setAuthErrorState("session_expired");
        setAudits([]);
        return;
      }
      if (res.status === 403) {
        setAuthErrorState("forbidden");
        setAudits([]);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.audit) {
        const updated: AuditRecord = data.audit;
        setAudits((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to regenerate preliminary draft.");
      }

      if (data.audit?.draftStatus !== "ready") {
        setError(data.audit?.draftError || "Preliminary draft could not be generated.");
        return;
      }

      setActionMessage("Preliminary draft regenerated and queued for human review.");
    } catch (err: any) {
      setError(err?.message || "Unable to regenerate preliminary draft.");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="pt-36 pb-20 px-6 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary mb-3">
              <ShieldCheck className="w-4 h-4" />
              Internal Admin Workspace
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tighter uppercase">
              Audit <span className="text-brand-primary italic">Draft Review</span>
            </h1>
          </div>

          {user && !authErrorState && (
            <button
              onClick={() => fetchAudits(user)}
              disabled={loading}
              className="glass px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:border-brand-primary transition-colors inline-flex items-center gap-2 w-fit"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh Queue
            </button>
          )}
        </div>

        {!authReady || loading ? (
          <div className="glass rounded-[40px] p-16 text-center">
            <Loader2 className="w-10 h-10 text-brand-primary animate-spin mx-auto mb-4" />
            <p className="text-white/50 text-sm uppercase tracking-widest font-bold">
              Verifying Administrator Session...
            </p>
          </div>
        ) : !user ? (
          <div className="glass rounded-[40px] p-12 md:p-20 text-center max-w-2xl mx-auto">
            <LogIn className="w-12 h-12 text-brand-primary mx-auto mb-6" />
            <h2 className="text-3xl font-display font-bold mb-4 uppercase">
              Administrator Sign-In Required
            </h2>
            <p className="text-white/50 mb-8">
              Preliminary audit drafts are private. Sign in with an authorized administrator account to review submissions.
            </p>
            <button
              onClick={handleLogin}
              className="bg-brand-primary text-white px-10 py-4 rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform inline-flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              Sign In with Google
            </button>
          </div>
        ) : authErrorState === "session_expired" ? (
          <div className="glass rounded-[40px] p-12 md:p-20 text-center max-w-2xl mx-auto border border-yellow-500/30">
            <LogIn className="w-12 h-12 text-yellow-400 mx-auto mb-6" />
            <h2 className="text-3xl font-display font-bold mb-4 uppercase">
              Session Expired or Revoked
            </h2>
            <p className="text-white/60 mb-8">
              Your Google authentication token expired or was revoked. Sign in again to verify administrator access.
            </p>
            <button
              type="button"
              onClick={handleLogin}
              className="bg-brand-primary text-white px-10 py-4 rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform inline-flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              Sign In Again
            </button>
          </div>
        ) : authErrorState === "forbidden" ? (
          <div className="glass rounded-[40px] p-12 md:p-20 text-center max-w-2xl mx-auto border border-red-500/30">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-6" />
            <h2 className="text-3xl font-display font-bold mb-4 uppercase">
              Access Denied
            </h2>
            <p className="text-white/50">
              Signed in as <span className="text-white">{user.email || user.uid}</span>, which does not have administrator permissions to view private audit drafts.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="p-5 rounded-3xl bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-sm text-white/80 leading-relaxed">
                <strong className="uppercase tracking-wider text-yellow-300 block mb-1">
                  Human Review Required Before Sharing
                </strong>
                All AI-generated drafts are <strong>preliminary recommendations only</strong>, generated without live web browsing, Google Business Profile access, or ranking inspection. Drafts are never emailed or published automatically — any live checks, personal walkthrough videos, or follow-up emails must be done manually outside the app after human review.
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm"
              >
                {error}
              </div>
            )}

            {audits.length === 0 ? (
              <div className="glass rounded-[40px] p-16 text-center text-white/50">
                No audit requests have been submitted yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Audit List */}
                <div className="lg:col-span-4 space-y-4">
                  {audits.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full text-left p-6 rounded-3xl border transition-all ${
                        selectedAudit?.id === item.id
                          ? "bg-brand-primary/10 border-brand-primary"
                          : "glass border-white/10 hover:border-white/25"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-display font-bold text-lg">
                          {item.businessName}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/10 text-white/70 shrink-0">
                          {item.draftStatus}
                        </span>
                      </div>
                      <div className="text-xs text-white/50 mb-3">
                        {item.industry} • {item.serviceArea}
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                        <span className="text-brand-primary">
                          {REVIEW_STATUS_LABELS[item.reviewStatus]}
                        </span>
                        <span className="text-white/30">
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleDateString()
                            : ""}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Selected Audit & Draft Inspector */}
                <div className="lg:col-span-8">
                  {selectedAudit && (
                    <motion.div
                      key={selectedAudit.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="glass rounded-[40px] p-8 md:p-10 space-y-8"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-white/10 pb-6">
                        <div>
                          <h2 className="text-3xl font-display font-bold mb-2">
                            {selectedAudit.businessName}
                          </h2>
                          <p className="text-white/60 text-sm">
                            {selectedAudit.industry} • {selectedAudit.serviceArea}
                          </p>
                        </div>
                        <button
                          onClick={handleRegenerateDraft}
                          disabled={regenerating}
                          className="bg-white/10 hover:bg-brand-primary text-white px-5 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-colors inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`}
                          />
                          {regenerating ? "Generating..." : "Regenerate Draft"}
                        </button>
                      </div>

                      {/* Contact details (admin-only, never sent to Gemini) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-white/5 p-6 rounded-3xl border border-white/10">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 block">
                            Customer Email (Private)
                          </span>
                          <span>{selectedAudit.email}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 block">
                            Phone (Private)
                          </span>
                          <span>{selectedAudit.phone || "Not provided"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 block">
                            Website Entered
                          </span>
                          <span className="break-all">
                            {selectedAudit.websiteUrl || "None entered"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 block">
                            Google Profile Link Entered
                          </span>
                          <span className="break-all">
                            {selectedAudit.googleProfileUrl || "None entered"}
                          </span>
                        </div>
                        <div className="md:col-span-2 pt-2 border-t border-white/10 text-xs text-white/40">
                          Vertex AI Privacy Scope: Business name, industry, service area (scrubbed of any embedded emails, phone numbers, or URLs), and link-entered booleans (hasWebsite={String(selectedAudit.hasWebsite)}, hasGoogleProfile={String(selectedAudit.hasGoogleProfile)}) are sent to Vertex AI. Email, phone, and actual URLs are never sent.
                        </div>
                      </div>

                      {/* Preliminary Draft Content */}
                      {selectedAudit.draftStatus === "ready" && selectedAudit.draft ? (
                        <div className="space-y-6">
                          <div className="p-4 rounded-2xl bg-brand-primary/10 border border-brand-primary/30">
                            <div className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-1">
                              {selectedAudit.draft.label || PRELIMINARY_DRAFT_LABEL}
                            </div>
                            <p className="text-xs text-white/70">
                              {selectedAudit.draft.disclaimer}
                            </p>
                            <div className="text-[10px] text-white/40 mt-2">
                              Model: {selectedAudit.draft.model} • Generated:{" "}
                              {new Date(selectedAudit.draft.generatedAt).toLocaleString()}
                            </div>
                          </div>

                          <div>
                            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">
                              Preliminary Executive Summary
                            </h3>
                            <p className="text-white/80 leading-relaxed">
                              {selectedAudit.draft.executiveSummary}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-3">
                                GBP Manual Checklist
                              </h4>
                              <ul className="space-y-2 text-sm text-white/75 list-disc pl-4">
                                {selectedAudit.draft.googleProfileChecklist.map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-3">
                                Website Conversion Checklist
                              </h4>
                              <ul className="space-y-2 text-sm text-white/75 list-disc pl-4">
                                {selectedAudit.draft.websiteConversionChecklist.map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-3">
                                Local Visibility Opportunities
                              </h4>
                              <ul className="space-y-2 text-sm text-white/75 list-disc pl-4">
                                {selectedAudit.draft.localVisibilityOpportunities.map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-3">
                                Human Strategist Verification Tasks
                              </h4>
                              <ul className="space-y-2 text-sm text-white/75 list-disc pl-4">
                                {selectedAudit.draft.humanReviewerVerificationTasks.map(
                                  (item, i) => (
                                    <li key={i}>{item}</li>
                                  )
                                )}
                              </ul>
                            </div>
                          </div>

                          <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-brand-primary mb-3">
                              Review Engine Next Steps
                            </h4>
                            <ul className="space-y-2 text-sm text-white/75 list-disc pl-4 mb-4">
                              {selectedAudit.draft.reviewEngineNextSteps.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                            <div className="pt-3 border-t border-white/10 text-sm text-white/80">
                              <strong className="text-white">Suggested CTA: </strong>
                              {selectedAudit.draft.suggestedCallToAction}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`p-6 rounded-3xl border text-sm ${
                            selectedAudit.draftStatus === "failed"
                              ? "bg-red-500/10 border-red-500/30 text-red-200"
                              : selectedAudit.draftStatus === "unavailable"
                                ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-100"
                                : "bg-white/5 border-white/10 text-white/60"
                          }`}
                        >
                          <strong className="text-white block mb-1 uppercase tracking-wider text-xs">
                            Draft Status: {selectedAudit.draftStatus}
                          </strong>
                          {selectedAudit.draftError ||
                            "No preliminary draft is currently available."}
                        </div>
                      )}

                      {/* Human Review Decision Form */}
                      <form
                        onSubmit={handleSaveReview}
                        className="border-t border-white/10 pt-8 space-y-4"
                      >
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
                          <ClipboardCheck className="w-4 h-4 text-brand-primary" />
                          Human Review Decision (Internal Record Only)
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label
                              htmlFor="admin-review-status"
                              className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2"
                            >
                              Review Status
                            </label>
                            <select
                              id="admin-review-status"
                              value={reviewStatus}
                              onChange={(e) =>
                                setReviewStatus(e.target.value as AuditReviewStatus)
                              }
                              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary"
                            >
                              {AUDIT_REVIEW_STATUSES.map((status) => (
                                <option key={status} value={status} className="bg-brand-secondary">
                                  {REVIEW_STATUS_LABELS[status]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-2">
                            <label
                              htmlFor="admin-reviewer-notes"
                              className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2"
                            >
                              Strategist Notes (Internal)
                            </label>
                            <input
                              id="admin-reviewer-notes"
                              type="text"
                              maxLength={2000}
                              placeholder="Notes from manual GBP/website verification..."
                              value={reviewerNotes}
                              onChange={(e) => setReviewerNotes(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary"
                            />
                          </div>
                        </div>

                        {actionMessage && (
                          <div
                            role="status"
                            className="flex items-center gap-2 text-green-400 text-sm"
                          >
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>{actionMessage}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-4">
                          <div className="text-xs text-white/40">
                            {selectedAudit.reviewedBy
                              ? `Last reviewed by ${selectedAudit.reviewedBy}${
                                  selectedAudit.reviewedAt
                                    ? ` on ${new Date(selectedAudit.reviewedAt).toLocaleString()}`
                                    : ""
                                }`
                              : "Not yet reviewed by a human strategist."}
                          </div>

                          <button
                            type="submit"
                            disabled={savingReview}
                            className="bg-brand-primary text-white px-8 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform disabled:opacity-50"
                          >
                            {savingReview ? "Saving..." : "Save Review"}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
