import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Flag, Loader2, Send } from 'lucide-react';
import { useLanguage, useT } from '@/lib/i18n';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import {
  disputeContractorVerification,
  fetchStageContractorVerification,
  recordContractorStageVerification,
  requestStagePayment,
  type ContractorPaymentDispute,
  type ContractorStageVerification,
} from '@/lib/supabase/contractor-payments';

interface Props {
  stageId: string;
  isContractor: boolean;
  readOnly?: boolean;
  settled: boolean;
  currencyCode: string;
  fxRate: number;
  scheduledAmount?: number | null;
  onChanged: () => void | Promise<void>;
}

/**
 * Per-stage offline payment verification (18 Nov).
 *
 * - Contractor view: asks "Has the Homeowner paid for this stage?"
 *   · Yes -> enter/confirm received amount -> calls record_contractor_stage_verification
 *   · No  -> "Request payment from Homeowner" button
 * - Homeowner view: when verified by contractor without a bank receipt, displays
 *   "Recorded by your contractor — no receipt" with a "Not right? Tell us" link
 *   that flags a dispute in Admin Action Center without stalling active site work.
 */
export function ContractorPaymentVerificationBar({
  stageId, isContractor, readOnly = false, settled, currencyCode, fxRate, scheduledAmount, onChanged,
}: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const [verification, setVerification] = useState<ContractorStageVerification | null>(null);
  const [dispute, setDispute] = useState<ContractorPaymentDispute | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const [amount, setAmount] = useState(() => (scheduledAmount != null && scheduledAmount > 0 ? String(Math.round(scheduledAmount * 100) / 100) : ''));
  const [note, setNote] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(stageId);
  current.current = stageId;

  const load = useCallback(async () => {
    try {
      const res = await fetchStageContractorVerification(stageId);
      if (current.current !== stageId) return;
      setVerification(res.verification);
      setDispute(res.dispute);
      setLoaded(true);
    } catch {
      if (current.current === stageId) setLoaded(true);
    }
  }, [stageId]);

  useEffect(() => {
    setAnswer(null);
    setRequestSent(false);
    setDisputing(false);
    setDisputeReason('');
    setError(null);
    setAmount(scheduledAmount != null && scheduledAmount > 0 ? String(Math.round(scheduledAmount * 100) / 100) : '');
    void load();
  }, [load, stageId, scheduledAmount]);

  const formatAmount = (value: number, iso: string) =>
    `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 }).format(value)} ${iso}`;

  async function handleConfirmPaid(e: React.FormEvent) {
    e.preventDefault();
    if (working) return;
    const trimmed = amount.trim();
    const parsed = trimmed ? canonicalReceiptAmount(trimmed) : null;
    if (trimmed && !parsed) {
      setError(t('project.stages.receiptAmountInvalid'));
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await recordContractorStageVerification({
        stageId,
        amount: parsed ? Number(parsed) : null,
        currency: parsed ? currencyCode : null,
        fxRate: parsed ? fxRate : null,
        note,
      });
      if (current.current !== stageId) return;
      setAnswer(null);
      setNote('');
      await load();
      await onChanged();
    } catch (err) {
      if (current.current === stageId) {
        setError(err instanceof Error ? err.message : t('common.somethingWrong'));
      }
    } finally {
      if (current.current === stageId) setWorking(false);
    }
  }

  async function handleRequestPayment() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await requestStagePayment({
        stageId,
        amount: scheduledAmount != null && scheduledAmount > 0 ? scheduledAmount : null,
        currency: scheduledAmount != null && scheduledAmount > 0 ? currencyCode : null,
      });
      if (current.current !== stageId) return;
      setRequestSent(true);
    } catch (err) {
      if (current.current === stageId) {
        setError(err instanceof Error ? err.message : t('common.somethingWrong'));
      }
    } finally {
      if (current.current === stageId) setWorking(false);
    }
  }

  async function handleDisputeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!verification || working) return;
    setWorking(true);
    setError(null);
    try {
      await disputeContractorVerification(verification.id, disputeReason);
      if (current.current !== stageId) return;
      setDisputing(false);
      setDisputeReason('');
      await load();
    } catch (err) {
      if (current.current === stageId) {
        setError(err instanceof Error ? err.message : t('common.somethingWrong'));
      }
    } finally {
      if (current.current === stageId) setWorking(false);
    }
  }

  if (!loaded) return null;

  // ── Homeowner view: only shown when the contractor recorded an offline verification ──
  if (!isContractor) {
    if (!verification) return null;
    return (
      <div className="space-y-2 rounded-lg border border-brand-border-grey bg-brand-off-white p-3 text-xs dark:border-[#2c2c2c] dark:bg-[#141414]" data-contractor-recorded>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold text-brand-near-black dark:text-white">
            <CheckCircle2 className="size-4 shrink-0 text-brand-green" aria-hidden />
            {t('project.clientUi.contractorRecorded')}
            {verification.amount != null && verification.currency && (
              <span className="font-mono font-normal text-brand-mid-grey">
                · {formatAmount(verification.amount, verification.currency)}
              </span>
            )}
          </p>
          {!readOnly && !dispute && !disputing && (
            <button type="button" onClick={() => setDisputing(true)} data-action="dispute-contractor-payment"
              className="font-semibold text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black dark:hover:text-white">
              {t('project.clientUi.disputeLink')}
            </button>
          )}
        </div>

        {dispute && (
          <p role="status" className="flex items-center gap-1.5 text-state-held" data-dispute-recorded>
            <Flag className="size-3.5 shrink-0" aria-hidden />
            {t('project.clientUi.disputeSubmitted')}
          </p>
        )}

        {disputing && !dispute && (
          <form onSubmit={handleDisputeSubmit} className="space-y-2 pt-1" data-dispute-form>
            <label className="block text-xs font-medium text-brand-near-black dark:text-white">
              {t('project.clientUi.disputeReasonLabel')}
              <textarea
                value={disputeReason}
                maxLength={2000}
                rows={2}
                disabled={working}
                onChange={e => setDisputeReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-2 text-xs dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={working}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {t('project.clientUi.disputeSubmit')}
              </button>
              <button type="button" disabled={working} onClick={() => { setDisputing(false); setError(null); }}
                className="px-2 py-1.5 text-brand-mid-grey underline underline-offset-4">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}

        {error && <p role="alert" className="text-state-alert">{error}</p>}
      </div>
    );
  }

  // ── Contractor view ─────────────────────────────────────────────────────────────
  if (verification) {
    return (
      <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-xs" data-contractor-verified>
        <p className="flex items-center gap-1.5 font-semibold text-brand-near-black dark:text-white">
          <CheckCircle2 className="size-4 shrink-0 text-brand-green" aria-hidden />
          {t('contractorView.stagePaymentRecordedByYou')}
          {verification.amount != null && verification.currency && (
            <span className="font-mono font-normal text-brand-mid-grey">
              · {formatAmount(verification.amount, verification.currency)}
            </span>
          )}
        </p>
      </div>
    );
  }

  if (readOnly || settled) return null;

  return (
    <div className="space-y-2.5 rounded-lg border border-brand-border-grey bg-white p-3 text-xs dark:border-[#2c2c2c] dark:bg-[#141414]" data-contractor-payment-prompt>
      <p className="font-semibold text-brand-near-black dark:text-white">{t('contractorView.stagePaymentQuestion')}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setAnswer('yes'); setRequestSent(false); setError(null); }}
          data-action="stage-paid-yes"
          className={answer === 'yes'
            ? 'rounded-lg bg-brand-green px-3 py-1.5 font-semibold text-white'
            : 'rounded-lg border border-brand-border-grey px-3 py-1.5 font-semibold text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white'}>
          {t('contractorView.stagePaymentYes')}
        </button>
        <button type="button" onClick={() => { setAnswer('no'); setError(null); }}
          data-action="stage-paid-no"
          className={answer === 'no'
            ? 'rounded-lg bg-brand-near-black px-3 py-1.5 font-semibold text-white dark:bg-white dark:text-brand-near-black'
            : 'rounded-lg border border-brand-border-grey px-3 py-1.5 font-semibold text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white'}>
          {t('contractorView.stagePaymentNo')}
        </button>
      </div>

      {answer === 'yes' && (
        <form onSubmit={handleConfirmPaid} className="space-y-2.5 border-t border-brand-border-grey pt-2.5 dark:border-[#2c2c2c]" data-contractor-paid-form>
          <label className="block font-medium text-brand-near-black dark:text-white">
            {t('contractorView.stagePaymentAmountLabel', { currency: currencyCode })}
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              disabled={working}
              onChange={e => {
                const raw = e.target.value;
                setAmount(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw);
                setError(null);
              }}
              className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
            />
          </label>
          <label className="block font-medium text-brand-near-black dark:text-white">
            {t('contractorView.noteOptional')}
            <textarea
              value={note}
              maxLength={2000}
              rows={2}
              disabled={working}
              onChange={e => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-2 text-xs dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={working}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-50">
              {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t('contractorView.stagePaymentConfirm')}
            </button>
            <button type="button" disabled={working} onClick={() => { setAnswer(null); setError(null); }}
              className="px-2 py-1.5 text-brand-mid-grey underline underline-offset-4">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {answer === 'no' && (
        <div className="space-y-2 border-t border-brand-border-grey pt-2.5 dark:border-[#2c2c2c]" data-request-payment-box>
          {requestSent ? (
            <p role="status" className="text-brand-green dark:text-[#b4d8bf]">{t('contractorView.paymentRequestSent')}</p>
          ) : (
            <button type="button" disabled={working} onClick={() => { void handleRequestPayment(); }} data-action="request-payment"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-50">
              {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
              {t('contractorView.requestPayment')}
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-state-alert">{error}</p>}
    </div>
  );
}
