import { useRef, useState } from 'react';
import { Loader2, Receipt, Check, ExternalLink, Clock } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { formatUSDFull } from '@/lib/budget';
import {
  uploadStagePaymentReceipt, confirmStagePayment, signReceiptUrl,
  type StagePayment,
} from '@/lib/supabase/verifications';

// =========================================================
// The money handshake on a locked stage (175).
//
// Favour, 3 Nov 2026: "once they click approve stage, the next thing that should show
// is upload payment receipt. For next stage, and when they upload it, the contractor
// should be able to receive it and see it. And the contractor will now click confirm.
// When the contractor confirms, then that stage unlocks automatically."
//
// Both halves live in one component because they are one conversation seen from two
// sides, and splitting them is how the two drift: the client is told to upload a
// receipt the contractor's screen has no box for, and nobody notices because each
// screen looks right on its own.
//
// ── This component decides nothing ────────────────────────────────────────────────
// Which side you see follows from `isContractor` and the tranche's state, and every
// one of those rules is ALSO enforced in the database — a client cannot confirm
// (not_contractor), a contractor cannot upload (not_client), and a contractor cannot
// confirm a payment with no receipt behind it (no_receipt). So the worst a mistake
// here can do is show somebody a button that refuses them, never let them through.
// =========================================================

interface Props {
  projectId: string;
  stageId: string;
  stageNumber: number;
  payment: StagePayment | undefined;
  isContractor: boolean;
  /** Reload the build: a confirmation opens the stage, which changes the whole list. */
  onChanged: () => void | Promise<void>;
}

export function StagePaymentGate({
  projectId, stageId, stageNumber, payment, isContractor, onChanged,
}: Props) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing owed, or already settled: there is no handshake to show. A stage with no
  // incoming tranche at all is free (amount is CHECKed > 0, so a free stage has no
  // row), and 132 opens it without anybody paying anything.
  if (!payment || payment.state === 'funded' || payment.state === 'reconciled') return null;

  const awaitingReceipt = payment.state === 'expected';

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadStagePaymentReceipt(projectId, stageId, file);
      await onChanged();
    } catch {
      setError(t('project.stages.receiptFailed'));
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again still fires a change event, which is
      // the ordinary way a retry after a failure is attempted.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmStagePayment(stageId);
      await onChanged();
    } catch {
      setError(t('project.stages.confirmFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openReceipt() {
    if (!payment?.receiptPath) return;
    const url = await signReceiptUrl(payment.receiptPath);
    // A private bucket hands back a signed URL or nothing. Opening a dead tab would be
    // worse than the button appearing to do nothing, so it does nothing.
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  const shell =
    'mt-4 rounded-xl border border-brand-border-grey bg-brand-off-white p-4 ' +
    'dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';

  // ── The contractor's side ─────────────────────────────────────────────────────────
  if (isContractor) {
    if (awaitingReceipt) {
      return (
        <div className={shell}>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-brand-mid-grey">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('project.stages.awaitingReceipt', { n: stageNumber })}
          </p>
        </div>
      );
    }
    return (
      <div className={shell}>
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
          <Receipt className="size-4 shrink-0" aria-hidden />
          {t('project.stages.confirmTitle', { n: stageNumber })}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
          {t('project.stages.confirmBody')}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={openReceipt}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-brand-border-grey bg-white py-2.5 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
          >
            <ExternalLink className="size-4" aria-hidden />
            {t('project.stages.confirmView')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-near-black py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {busy ? t('project.stages.confirmWorking') : t('project.stages.confirmAction')}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-state-alert">{error}</p>}
      </div>
    );
  }

  // ── The client's side ─────────────────────────────────────────────────────────────
  if (!awaitingReceipt) {
    return (
      <div className={shell}>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-brand-mid-grey">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('project.stages.receiptSent')}
        </p>
      </div>
    );
  }

  return (
    <div className={shell}>
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <Receipt className="size-4 shrink-0" aria-hidden />
        {t('project.stages.receiptTitle', { n: stageNumber })}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">
        {/* The full figure, not a rounded one: somebody is about to transfer this. */}
        {t('project.stages.receiptBody', { amount: formatUSDFull(payment.amount) })}
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        aria-label={t('project.stages.receiptChoose')}
        onChange={e => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-near-black py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {busy ? t('project.stages.receiptUploading') : t('project.stages.receiptChoose')}
      </button>
      {error && <p className="mt-2 text-xs text-state-alert">{error}</p>}
    </div>
  );
}
