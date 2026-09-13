import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import type { VerificationDecision } from '@/lib/supabase/verifications';

// Extracted from routes/admin/reviews.tsx unchanged (Phase 5 step 2), renamed from
// RecordDecisionModal: this records a VERIFIER's decision on a stage (087, on behalf,
// with a reason). A 091 *decision* — what the client agreed to — is a different record
// with its own modal.
export function RecordVerificationModal({
  open, verifierName, onClose, onConfirm,
}: {
  open: boolean;
  verifierName: string;
  onClose: () => void;
  onConfirm: (input: { decision: Exclude<VerificationDecision, 'pending'>; findings: string; reason: string; visited: boolean }) => Promise<void>;
}) {
  const t = useT();
  const [decision, setDecision] = useState<Exclude<VerificationDecision, 'pending'>>('verified');
  const [findings, setFindings] = useState('');
  const [reason, setReason]     = useState('');
  const [visited, setVisited]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) { setError(t('admin.verification.errReason')); return; }
    // "Verified" means visited (087 CHECK). Said here so the person sees it before the
    // database says it; the database says it anyway.
    if (decision === 'verified' && !visited) { setError(t('admin.verification.errVisit')); return; }
    setBusy(true); setError(null);
    try {
      await onConfirm({ decision, findings: findings.trim(), reason: reason.trim(), visited });
      setFindings(''); setReason('');
    } catch (err) {
      const msg = errorMessage(err, '');
      setError(
        msg.includes('reason_required') ? t('admin.verification.errReason')
        : msg.includes('visit_required') ? t('admin.verification.errVisit')
        : msg || t('common.somethingWrong'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={busy ? undefined : onClose}
        >
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-brand-border-grey bg-white p-6"
          >
            <h2 className="text-sm font-bold text-brand-near-black">{t('admin.verification.recordTitle', { name: verifierName })}</h2>
            <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.verification.recordBody')}</p>

            <label htmlFor="rd-decision" className="mt-4 block text-xs font-medium text-brand-near-black">{t('admin.verification.decision')}</label>
            <select
              id="rd-decision" value={decision}
              onChange={e => setDecision(e.target.value as Exclude<VerificationDecision, 'pending'>)}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
            >
              <option value="verified">{t('admin.verification.decisionVerified')}</option>
              <option value="rejected">{t('admin.verification.decisionRejected')}</option>
              <option value="needs_more_evidence">{t('admin.verification.decisionMore')}</option>
            </select>

            <label className="mt-3 flex items-center gap-2 text-xs text-brand-near-black">
              <input type="checkbox" checked={visited} onChange={e => setVisited(e.target.checked)} className="size-3.5 accent-[#0a0a0a]" />
              {t('admin.verification.visited')}
            </label>

            <label htmlFor="rd-findings" className="mt-3 block text-xs font-medium text-brand-near-black">{t('admin.verification.findingsLabel')}</label>
            <textarea
              id="rd-findings" value={findings} onChange={e => setFindings(e.target.value)} rows={3}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none"
            />

            <label htmlFor="rd-reason" className="mt-3 block text-xs font-medium text-brand-near-black">{t('admin.verification.reasonLabel')}</label>
            <input
              id="rd-reason" type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder={t('admin.verification.reasonPlaceholder')}
              className="mt-1.5 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm text-brand-near-black placeholder:text-brand-mid-grey focus:border-brand-near-black focus:outline-none"
            />

            {error && <p role="alert" className="mt-2 text-xs text-state-alert">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 rounded-lg border border-brand-border-grey py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-off-white disabled:opacity-40">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={submit} disabled={busy || !reason.trim()}
                className="flex-1 rounded-lg bg-brand-near-black py-2 text-xs font-semibold text-white disabled:opacity-40">
                {busy ? t('admin.verification.recording') : t('admin.verification.recordDecision')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
