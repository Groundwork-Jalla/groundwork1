import { useRef, useState, type FormEvent } from 'react';
import { Loader2, Receipt, Check, ExternalLink, Clock } from 'lucide-react';
import { useT, useLanguage } from '@/lib/i18n';
import { useMoney, useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { confirmedBillAmount, normaliseBudgetInput } from '@/lib/budget/bill-budget';
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
  const { lang } = useLanguage();
  // The figure the client is about to transfer, in the currency they will transfer it
  // in. This read `formatUSDFull` — dollars — on the one screen whose whole job is to
  // name an amount somebody must pay. Rendered from StageTracker, inside the provider.
  const money = useMoney();
  const currency = useProjectMoneyContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const scope = `${projectId}:${stageId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const inFlight = useRef<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [draft, setDraft] = useState<{ scope: string; amount: string; file: File | null }>({ scope, amount: '', file: null });
  const amount = draft.scope === scope ? draft.amount : '';
  const file = draft.scope === scope ? draft.file : null;
  const busy = working === scope;
  const error = failure?.scope === scope ? failure.message : null;
  const code = currency?.code ?? 'USD';
  const fxRate = currency?.rate ?? 1;

  // Nothing owed, or already settled: there is no handshake to show. A stage with no
  // incoming tranche at all is free (amount is CHECKed > 0, so a free stage has no
  // row), and 132 opens it without anybody paying anything.
  if (!payment || payment.state === 'funded' || payment.state === 'reconciled') return null;

  const awaitingReceipt = payment.state === 'expected';
  const hasReceiptAmount = payment.receiptAmount != null && Number.isFinite(payment.receiptAmount)
    && payment.receiptAmount > 0 && !!payment.receiptCurrency;
  const hasReceiptSnapshot = hasReceiptAmount && !!payment.receiptPath && !!payment.receiptUploadedAt;
  const shownReceiptAmount = hasReceiptAmount
    ? `${payment.receiptAmount!.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 })} ${payment.receiptCurrency}`
    : null;
  const shownReceiptUsd = hasReceiptAmount && payment.receiptCurrency !== 'USD'
    && payment.receiptAmountUsd != null && Number.isFinite(payment.receiptAmountUsd)
    ? new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 2,
    }).format(payment.receiptAmountUsd) : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current === scope) return;
    if (confirmedBillAmount(amount) === null) {
      setFailure({ scope, message: t('project.stages.receiptAmountInvalid') });
      return;
    }
    if (!file) {
      setFailure({ scope, message: t('project.stages.receiptFileRequired') });
      return;
    }
    inFlight.current = scope;
    setWorking(scope);
    setFailure(null);
    try {
      await uploadStagePaymentReceipt(projectId, stageId, file, { amount, currency: code, fxRate });
      if (currentScope.current === scope) {
        await onChanged();
        if (currentScope.current === scope) {
          setDraft({ scope, amount: '', file: null });
          if (fileRef.current) fileRef.current.value = '';
        }
      }
    } catch {
      if (currentScope.current === scope) setFailure({ scope, message: t('project.stages.receiptFailed') });
    } finally {
      if (inFlight.current === scope) inFlight.current = null;
      if (currentScope.current === scope) setWorking(null);
    }
  }

  async function handleConfirm() {
    if (inFlight.current === scope || !hasReceiptSnapshot) return;
    inFlight.current = scope;
    setWorking(scope);
    setFailure(null);
    try {
      await confirmStagePayment(stageId, undefined, { path: payment!.receiptPath!, uploadedAt: payment!.receiptUploadedAt! });
      if (currentScope.current === scope) await onChanged();
    } catch (error) {
      if (currentScope.current === scope) {
        const stale = /stale_receipt/.test((error as { message?: string } | null)?.message ?? '');
        if (stale) {
          try { await onChanged(); } catch { /* Keep the original reason visible. */ }
        }
        if (currentScope.current === scope) {
          setFailure({ scope, message: t(stale ? 'project.stages.receiptChanged' : 'project.stages.confirmFailed') });
        }
      }
    } finally {
      if (inFlight.current === scope) inFlight.current = null;
      if (currentScope.current === scope) setWorking(null);
    }
  }

  async function openReceipt() {
    if (!payment?.receiptPath) return;
    const url = await signReceiptUrl(payment.receiptPath);
    // A private bucket hands back a signed URL or nothing. Opening a dead tab would be
    // worse than the button appearing to do nothing, so it does nothing.
    if (currentScope.current !== scope) return;
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
    if (!hasReceiptSnapshot) {
      return <div className={shell}><p className="text-xs leading-relaxed text-brand-mid-grey">{t('project.stages.receiptAmountMissing')}</p></div>;
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
        <p className="mt-3 text-base font-semibold tabular-nums text-brand-near-black dark:text-white">{shownReceiptAmount}</p>
        {shownReceiptUsd && <p className="text-xs tabular-nums text-brand-mid-grey">{shownReceiptUsd}</p>}
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
  if (!awaitingReceipt && hasReceiptSnapshot) {
    return (
      <div className={shell}>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-brand-mid-grey">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('project.stages.receiptSent')}
        </p>
        <p className="mt-3 text-base font-semibold tabular-nums text-brand-near-black dark:text-white">{shownReceiptAmount}</p>
        {shownReceiptUsd && <p className="text-xs tabular-nums text-brand-mid-grey">{shownReceiptUsd}</p>}
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
        {t('project.stages.receiptBody', { amount: money(payment.amount) })}
      </p>

      {!awaitingReceipt && <p className="mt-2 text-xs leading-relaxed text-brand-mid-grey">{t('project.stages.receiptAmountMissing')}</p>}
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <div>
        <label htmlFor={`receipt-amount-${stageId}`} className="block text-xs font-medium text-brand-near-black dark:text-white">
          {t('project.stages.receiptAmountLabel', { currency: code })}
        </label>
        <input
          id={`receipt-amount-${stageId}`}
          name="receipt-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          disabled={busy}
          onChange={e => {
            const raw = e.target.value;
            const next = /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw;
            setDraft({ scope, amount: next, file });
            setFailure(null);
          }}
          className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm tabular-nums text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
        />
        <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t('project.stages.receiptAmountHint')}</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        aria-label={t('project.stages.receiptChoose')}
        disabled={busy}
        onChange={e => { setDraft({ scope, amount, file: e.target.files?.[0] ?? null }); setFailure(null); }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-brand-border-grey bg-white py-2.5 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-50 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
      >
        {t('project.stages.receiptFileChoose')}
      </button>
      {file && <p className="break-all text-xs text-brand-mid-grey">{file.name}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-near-black py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {busy ? t('project.stages.receiptUploading') : t('project.stages.receiptChoose')}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-state-alert">{error}</p>}
      </form>
    </div>
  );
}
