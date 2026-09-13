import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { authoriseRelease, confirmFunding, ineligibilityReason, openReconciliation, type Payment } from '@/lib/supabase/payments';
import { formatUSDFull } from '@/lib/budget';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';

// Extracted from LedgerPanel.tsx unchanged (Phase 5 step 2): the three ledger acts —
// confirm received, authorise release, open reconciliation — in one dialog, so the
// cross-project panel on /admin/budgets and the Workspace's Financials tab share it.
// The database decides; this translates its refusal.

export interface StageRef { id: string; projectId: string; stageNumber: number; name: string; status: string; milestone: number | null }
export interface Contractor { userId: string; email: string }

export type LedgerModalState =
  | { kind: 'confirm'; payment: Payment }
  | { kind: 'authorise'; stage: StageRef }
  | { kind: 'reconcile'; payment: Payment }
  | null;

export function LedgerModal({ modal, projectName, stage, contractors, onClose, onDone }: {
  modal: NonNullable<LedgerModalState>;
  projectName: string;
  stage: StageRef | null;
  contractors: Contractor[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [note, setNote]   = useState('');
  const [amount, setAmount] = useState(String(stage?.milestone ?? ''));
  const [beneficiary, setBeneficiary] = useState(contractors[0]?.userId ?? '');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = stage?.stageNumber ?? 0;
  const title = modal.kind === 'confirm' ? t('admin.ledger.confirmTitle') : modal.kind === 'authorise' ? t('admin.ledger.authoriseTitle') : t('admin.ledger.openReconciliation');
  const body  = modal.kind === 'confirm'
    ? t('admin.ledger.confirmBody', { amount: formatUSDFull(modal.payment.amount), n, project: projectName })
    : modal.kind === 'authorise'
      ? t('admin.ledger.authoriseBody', { n, project: projectName })
      : t('admin.ledger.reconcileBody');

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (modal.kind === 'confirm') await confirmFunding(modal.payment.id, note || undefined);
      else if (modal.kind === 'reconcile') await openReconciliation(modal.payment.id, note || undefined);
      else await authoriseRelease(modal.stage.id, Number(amount), beneficiary, note || undefined);
      onDone();
    } catch (err) {
      // The database's reason, in the reader's language; anything else verbatim.
      const reason = ineligibilityReason(err) ?? /^(bad_beneficiary|already_authorised):/.exec((err as { message?: string })?.message ?? '')?.[1] ?? null;
      const key = reason ? (`admin.ledger.refusal.${reason}` as TKey) : null;
      setError(key && t(key) !== key ? t(key) : errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} exit={{ y: 12 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-brand-near-black">{title}</h3>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black"><X className="size-4" /></button>
        </div>
        <p className="text-xs text-brand-mid-grey">{body}</p>

        {modal.kind === 'authorise' && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="text-xs text-brand-near-black">
              {t('admin.ledger.amount')}
              <input type="number" min={1} step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm tabular-nums" />
            </label>
            <label className="text-xs text-brand-near-black">
              {t('admin.ledger.beneficiary')}
              <select value={beneficiary} onChange={e => setBeneficiary(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm">
                {contractors.map(c => <option key={c.userId} value={c.userId}>{c.email}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className="mt-4 block text-xs text-brand-near-black">
          {t('admin.ledger.note')}
          <input value={note} onChange={e => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm" />
        </label>

        {error && <p className="mt-3 text-xs text-state-held">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-semibold text-brand-near-black">{t('common.cancel')}</button>
          <button type="button" onClick={submit} disabled={busy || (modal.kind === 'authorise' && (!beneficiary || !(Number(amount) > 0)))}
            className="flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {modal.kind === 'confirm' ? t('admin.ledger.confirm') : modal.kind === 'authorise' ? t('admin.ledger.authorise') : t('admin.ledger.openReconciliation')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
