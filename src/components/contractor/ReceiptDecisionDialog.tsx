import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, X } from 'lucide-react';
import { useLanguage, useT } from '@/lib/i18n';
import { currencyFractionDigits, formatDate } from '@/lib/format';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import { receiptErrorText } from '@/lib/payments/receipt-error-text';
import { stageReceiptBalance, stageReceiptExcess, stageReceiptTotalExcess } from '@/lib/payments/stage-receipt-balance';
import { decideStagePaymentReceipt, signReceiptUrl, type StagePayment, type StagePaymentReceipt } from '@/lib/supabase/verifications';
import { useSubstagePayments } from '@/lib/supabase/substage-payments';
import { substageLabelWith } from '@/lib/stage-labels';
import type { ProjectStageRow } from '@/types/project';
import { DocumentViewer } from '@/components/project/DocumentViewer';
import { ReceiptThumb } from '@/components/project/ReceiptThumb';
import { cn } from '@/lib/utils';

type Decision = 'accept' | 'record' | 'needs_top_up' | 'flag';

/**
 * "Did this payment arrive?" — the contractor's receipt decision as one question
 * (18 Nov redesign, docs/mockups/2026-11-18-contractor-project/confirm-*.png).
 *
 * It replaces a two-step form and a five-line confirmation, and keeps every decision the
 * database accepts: the plain yes allows work; "the amount is different" offers allow
 * anyway, record and decide later, or ask for the rest; "it hasn't arrived" flags the
 * receipt with a reason the homeowner reads. Each is sent with the stage price and the
 * receipt's decision as read, so a receipt that changed underneath is refused, not
 * decided twice.
 */
export function ReceiptDecisionDialog({ receipt, payment, stage, projectName, stageName, currency, rate, onClose, onDecided }: {
  receipt: StagePaymentReceipt;
  payment: StagePayment;
  stage: Pick<ProjectStageRow, 'id' | 'stage_number' | 'milestone_amount' | 'paid_by_part'>;
  projectName: string;
  stageName: string;
  /** The project currency and the budget rate it is held at. */
  currency: string; rate: number;
  onClose: () => void;
  onDecided: () => void | Promise<void>;
}) {
  const t = useT(); const { lang } = useLanguage();
  const parts = useSubstagePayments(stage.id, !!stage.paid_by_part, payment);
  const [step, setStep] = useState<'ask' | 'different' | 'missing'>('ask');
  const [choice, setChoice] = useState<Exclude<Decision, 'flag'>>('accept');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ url: string | null } | null>(null);
  const busy = useRef(false);
  const viewing = useRef(false); viewing.current = !!viewer;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !viewing.current && !busy.current) onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const money = (value: number | null | undefined, code: string | null | undefined) => value == null || !Number.isFinite(value) ? '—'
    : `${value.toLocaleString(locale, { maximumFractionDigits: currencyFractionDigits(code) })} ${code ?? ''}`.trim();
  const scheduled = stage.milestone_amount != null && Number.isFinite(Number(stage.milestone_amount)) ? Number(stage.milestone_amount) : payment.amount * rate;
  const part = receipt.substageId ? parts?.parts?.find(row => row.id === receipt.substageId) ?? null : null;
  const partLabel = part ? t('project.historyView.part', { n: part.number ?? '', name: substageLabelWith(t, { name: part.name, substage_key: part.key }) }) : null;
  const projected = stageReceiptBalance({ ...payment, receipts: payment.receipts?.map(row => row.id === receipt.id ? { ...row, decision: 'received' as const } : row) }, currency, rate, scheduled);
  const remainingAfter = projected.remaining;
  // Accepting this receipt (alone or combined with other pending receipts on the stage)
  // would take the stage past its price (18–19 Nov): say by how much.
  // The excess still carries forward to the next stages; nothing here changes that.
  const excessConfirmedAfter = stageReceiptExcess(projected, scheduled);
  const excessTotalAfter = stageReceiptTotalExcess(projected, scheduled);
  const excessAfter = excessConfirmedAfter != null && excessConfirmedAfter > 0 ? excessConfirmedAfter : excessTotalAfter;

  async function decide(action: Decision) {
    if (busy.current) return;
    const topUp = action === 'needs_top_up' ? amount.trim() : undefined;
    if (action === 'needs_top_up' && !canonicalReceiptAmount(topUp)) { setError(t('project.stages.receiptAmountInvalid')); return; }
    if (action === 'flag' && !note.trim()) { setError(t('project.receiptFlow.reasonRequired')); return; }
    busy.current = true; setWorking(true); setError(null);
    try {
      await decideStagePaymentReceipt(receipt.id, action, note.trim() || undefined, topUp, { stageAmount: scheduled, decision: receipt.decision });
      await onDecided();
      onClose();
    } catch (failure) {
      setError(receiptErrorText(t, failure));
    } finally { busy.current = false; setWorking(false); }
  }

  async function openLarge() {
    setViewer({ url: null });
    const url = await signReceiptUrl(receipt.path).catch(() => null);
    if (url) setViewer({ url }); else { setViewer(null); setError(t('project.receiptFlow.openReceipt')); }
  }

  function startDifferent() {
    setStep('different'); setChoice('accept'); setError(null);
    if (!amount && remainingAfter != null && remainingAfter > 0) setAmount(String(Math.round(remainingAfter * 100) / 100));
  }

  const name = receipt.path.split('/').pop() ?? 'receipt';
  const button = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="receipt-decision-title"
      onClick={event => { if (event.target === event.currentTarget && !busy.current) onClose(); }} data-receipt-decision={receipt.id}>
      <div className="flex h-full w-full flex-col overflow-y-auto bg-white dark:bg-[#1e1e1e] sm:grid sm:h-auto sm:max-h-[92vh] sm:max-w-[860px] sm:grid-cols-[320px_minmax(0,1fr)] sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl">
        <div className="flex items-center justify-between border-b border-brand-border-grey px-4 py-3 sm:hidden dark:border-[#2c2c2c]">
          <button type="button" onClick={onClose} disabled={working} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green dark:text-state-complete"><ArrowLeft className="size-4" aria-hidden />{t('common.cancel')}</button>
        </div>

        <div className="order-2 flex flex-col gap-2 bg-brand-off-white p-4 sm:order-1 sm:p-5 dark:bg-[#141414]">
          <ReceiptThumb size="lg" path={receipt.path} label={t('contractorView.viewLarge')} onOpen={() => { void openLarge(); }} />
          <p className="text-xs text-brand-mid-grey">{t('contractorView.uploadedOn', { date: formatDate(receipt.submittedAt) })}</p>
        </div>

        <div className="relative order-1 flex flex-col p-4 sm:order-2 sm:overflow-y-auto sm:p-6">
          <button type="button" onClick={onClose} disabled={working} aria-label={t('common.close')} className="absolute right-4 top-4 hidden rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white sm:block dark:hover:bg-[#2c2c2c]"><X className="size-5" aria-hidden /></button>
          <p className="pr-8 text-[11px] font-semibold uppercase tracking-wider text-brand-mid-grey">{[projectName, stageName, partLabel].filter(Boolean).join(' · ')}</p>
          <h2 id="receipt-decision-title" className="mt-1.5 text-xl font-extrabold tracking-tight text-brand-near-black sm:text-2xl dark:text-white">{t('contractorView.question')}</h2>

          <dl className="mt-4 divide-y divide-brand-border-grey rounded-xl border border-brand-border-grey text-sm dark:divide-[#2c2c2c] dark:border-[#2c2c2c]">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3"><dt className="text-brand-mid-grey">{t('contractorView.onReceipt')}</dt>
              <dd className="text-right font-mono font-semibold tabular-nums">{money(receipt.amount, receipt.currency)}
                {receipt.projectAmount != null && receipt.projectCurrency && receipt.projectCurrency !== receipt.currency && <span className="block text-[11px] font-normal text-brand-mid-grey">{t('project.receiptFlow.projectEquivalent', { amount: money(receipt.projectAmount, receipt.projectCurrency) })}</span>}</dd></div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-3"><dt className="text-brand-mid-grey">{part ? t('contractorView.partPrice', { n: part.number ?? '' }) : t('contractorView.stagePrice')}</dt>
              <dd className="font-mono font-semibold tabular-nums">{money(part ? Number(part.price) : scheduled, part ? parts?.currency ?? currency : currency)}</dd></div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-3"><dt className="text-brand-mid-grey">{t('contractorView.stillDueAfter')}</dt>
              <dd className="font-mono font-semibold tabular-nums">{money(remainingAfter, currency)}</dd></div>
          </dl>
          {excessAfter != null && excessAfter > 0 && <div role="status" data-excess-indicator className="mt-3 rounded-xl border border-state-held/40 bg-state-held/10 px-4 py-3 text-[13px] leading-relaxed">
            <p className="flex items-center gap-2 font-semibold text-brand-near-black dark:text-white"><AlertCircle className="size-4 shrink-0 text-state-held" aria-hidden />{t('contractorView.overBy', { excessAmount: money(excessAfter, currency) })}</p>
            <p className="mt-1 text-brand-mid-grey">{t('contractorView.excessPaymentBody', { receiptAmount: money(receipt.projectAmount ?? receipt.amount, receipt.projectAmount != null ? receipt.projectCurrency : receipt.currency), expectedAmount: money(scheduled, currency), excessAmount: money(excessAfter, currency) })}</p>
          </div>}
          <p className="mt-3 flex items-center gap-2 text-[13px] text-brand-near-black dark:text-white"><AlertCircle className="size-4 shrink-0 text-state-held" aria-hidden />{t('contractorView.checkAccount')}</p>
          {receipt.decisionNote && <p className="mt-2 whitespace-pre-wrap text-xs text-brand-mid-grey">{receipt.decisionNote}</p>}

          {step === 'ask' && <div className="mt-6 flex flex-col gap-2.5 sm:mt-auto sm:pt-6" data-step="ask">
            <button type="button" disabled={working} onClick={() => { void decide('accept'); }} className={cn(button, 'bg-brand-green text-white hover:bg-brand-green-hover')}>
              {working && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('contractorView.arrived')}</button>
            <button type="button" disabled={working} onClick={startDifferent} className={cn(button, 'border border-brand-border-grey bg-white text-brand-near-black dark:border-[#2c2c2c] dark:bg-transparent dark:text-white')}>{t('contractorView.different')}</button>
            <button type="button" disabled={working} onClick={() => { setStep('missing'); setError(null); }} className={cn(button, 'border border-brand-border-grey bg-white text-state-alert dark:border-[#2c2c2c] dark:bg-transparent')}>{t('contractorView.notArrived')}</button>
          </div>}

          {step === 'different' && <form className="mt-5 flex flex-col gap-3" data-step="different" onSubmit={event => { event.preventDefault(); void decide(choice); }}>
            <fieldset disabled={working} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t('contractorView.differentHelp')}</legend>
              {(['accept', 'record', 'needs_top_up'] as const).map(value => (
                <label key={value} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm', choice === value ? 'border-brand-green bg-brand-green/5' : 'border-brand-border-grey dark:border-[#2c2c2c]')}>
                  <input type="radio" name="receipt-decision" value={value} checked={choice === value} onChange={() => { setChoice(value); setError(null); }} className="accent-brand-green" />
                  {t(value === 'accept' ? 'contractorView.allowAnyway' : value === 'record' ? 'contractorView.recordOnly' : 'contractorView.askRest')}
                </label>))}
              {choice === 'needs_top_up' && <label className="block text-xs font-medium">{t('contractorView.askAmount', { currency: receipt.currency ?? currency })}
                <input inputMode="decimal" value={amount} onChange={event => { const raw = event.target.value; setAmount(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw); setError(null); }}
                  className="mt-1 min-h-11 w-full rounded-lg border border-brand-border-grey bg-white px-3 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#141414]" /></label>}
              <label className="block text-xs font-medium">{t('contractorView.noteOptional')}
                <textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-3 text-sm dark:border-[#2c2c2c] dark:bg-[#141414]" /></label>
            </fieldset>
            <button type="submit" disabled={working} className={cn(button, 'bg-brand-green text-white')}>{working && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('contractorView.confirmChoice')}</button>
            <button type="button" disabled={working} onClick={() => { setStep('ask'); setError(null); }} className="text-sm font-semibold text-brand-mid-grey underline underline-offset-4">{t('common.back')}</button>
          </form>}

          {step === 'missing' && <form className="mt-5 flex flex-col gap-3" data-step="missing" onSubmit={event => { event.preventDefault(); void decide('flag'); }}>
            <label className="block text-xs font-medium">{t('contractorView.reasonLabel')}
              <textarea value={note} required maxLength={2000} disabled={working} onChange={event => { setNote(event.target.value); setError(null); }} rows={3} className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-3 text-sm dark:border-[#2c2c2c] dark:bg-[#141414]" /></label>
            <button type="submit" disabled={working || !note.trim()} className={cn(button, 'bg-state-alert text-white')}>{working && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('contractorView.tellHomeowner')}</button>
            <button type="button" disabled={working} onClick={() => { setStep('ask'); setError(null); }} className="text-sm font-semibold text-brand-mid-grey underline underline-offset-4">{t('common.back')}</button>
          </form>}

          {error && <p role="alert" className="mt-3 rounded-lg border border-state-alert/30 p-3 text-sm text-state-alert">{error}</p>}
        </div>
      </div>
      {viewer && <DocumentViewer name={name} url={viewer.url} loading={!viewer.url} onClose={() => setViewer(null)} />}
    </div>
  );
}
