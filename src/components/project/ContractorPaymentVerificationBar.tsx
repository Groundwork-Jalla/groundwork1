import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Flag, Loader2, Lock, Pencil, RotateCcw, Send } from 'lucide-react';
import { useLanguage, useT } from '@/lib/i18n';
import { currencyFractionDigits } from '@/lib/format';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import {
  clearContractorStageVerification,
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
  /** True once at least one live payment receipt already exists on this stage. */
  hasReceipts?: boolean;
  /** True once uploaded evidence on this stage or any of its substages has been approved by the Homeowner. */
  lockedAfterApproval?: boolean;
  currencyCode: string;
  fxRate: number;
  scheduledAmount?: number | null;
  onChanged: () => void | Promise<void>;
  onVerificationChange?: (verification: ContractorStageVerification | null) => void;
}

/**
 * Per-stage offline payment verification (18 Nov; full vs. partial + edit/undo 28 Nov).
 *
 * - Contractor view: asks "Has the Homeowner paid for this stage?"
 *   · Yes -> choose Full payment (entire stage + substages) OR Partial payment (amount paid
 *     + total cost of this stage -> calculates remaining balance without marking other
 *     substages as Paid) -> calls record_contractor_stage_verification
 *   · No  -> "Request payment from Homeowner" button
 * - Homeowner view: when verified by contractor without a bank receipt, displays
 *   the recorded amount (and partial remaining balance if partial) with a "Not right? Tell us"
 *   link that flags a dispute in Admin Action Center without stalling active site work.
 */
export function ContractorPaymentVerificationBar({
  stageId, isContractor, readOnly = false, settled, hasReceipts = false, lockedAfterApproval = false, currencyCode, fxRate, scheduledAmount, onChanged, onVerificationChange,
}: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const [verification, setVerification] = useState<ContractorStageVerification | null>(null);
  const [dispute, setDispute] = useState<ContractorPaymentDispute | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>('full');
  const [editing, setEditing] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [amount, setAmount] = useState(() => (scheduledAmount != null && scheduledAmount > 0 ? String(Math.round(scheduledAmount * 100) / 100) : ''));
  const [stageTotal, setStageTotal] = useState(() => (scheduledAmount != null && scheduledAmount > 0 ? String(Math.round(scheduledAmount * 100) / 100) : ''));
  const [note, setNote] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(stageId);
  current.current = stageId;
  // Store parent callback in a ref so inline arrow callbacks from parents never
  // retrigger the fetch effect or cause a collapse/expand layout loop.
  const onVerificationChangeRef = useRef(onVerificationChange);
  onVerificationChangeRef.current = onVerificationChange;

  const load = useCallback(async () => {
    try {
      const res = await fetchStageContractorVerification(stageId);
      if (current.current !== stageId) return;
      setVerification(res.verification);
      setDispute(res.dispute);
      setLoaded(true);
      onVerificationChangeRef.current?.(res.verification);
    } catch {
      if (current.current === stageId) {
        setLoaded(true);
        onVerificationChangeRef.current?.(null);
      }
    }
  }, [stageId]);

  useEffect(() => {
    setVerification(null);
    setDispute(null);
    setLoaded(false);
    setAnswer(null);
    setPaymentMode('full');
    setEditing(false);
    setConfirmUndo(false);
    setRequestSent(false);
    setDisputing(false);
    setDisputeReason('');
    setError(null);
    void load();
  }, [load, stageId]);

  // Keep the default pre-filled amounts aligned with scheduledAmount when the user
  // is not actively editing the confirmation form, without collapsing or re-fetching.
  useEffect(() => {
    if (answer !== 'yes' && !editing) {
      const defaultVal = scheduledAmount != null && scheduledAmount > 0 ? String(Math.round(scheduledAmount * 100) / 100) : '';
      setAmount(defaultVal);
      setStageTotal(defaultVal);
    }
  }, [stageId, scheduledAmount, answer, editing]);

  const formatAmount = (value: number, iso: string) =>
    `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(iso) }).format(value)} ${iso}`;

  const activeCurrency = verification?.currency ?? currencyCode;
  const parsedAmount = amount.trim() ? canonicalReceiptAmount(amount.trim()) : null;
  const parsedStageTotal = stageTotal.trim() ? canonicalReceiptAmount(stageTotal.trim()) : null;
  const numericAmount = parsedAmount ? Number(parsedAmount) : null;
  const numericStageTotal = parsedStageTotal ? Number(parsedStageTotal) : null;
  const liveRemaining =
    paymentMode === 'partial' && numericAmount != null && numericStageTotal != null
      ? Math.round((numericStageTotal - numericAmount) * 1e6) / 1e6
      : null;

  async function handleConfirmPaid(e: React.FormEvent) {
    e.preventDefault();
    if (working) return;
    const isPartial = paymentMode === 'partial';
    const trimmed = amount.trim();
    const parsed = trimmed ? canonicalReceiptAmount(trimmed) : null;
    if (trimmed && !parsed) {
      setError(t('project.stages.receiptAmountInvalid'));
      return;
    }
    if (isPartial && !parsed) {
      setError(lang === 'fr'
        ? 'Entrez le montant déjà payé pour enregistrer un paiement partiel.'
        : 'Enter the amount already paid to record a partial payment.');
      return;
    }
    const trimmedTotal = stageTotal.trim();
    const parsedTotal = trimmedTotal ? canonicalReceiptAmount(trimmedTotal) : null;
    if (isPartial) {
      if (!parsedTotal) {
        setError(lang === 'fr'
          ? 'Entrez le coût total de cette étape pour calculer le reste à payer.'
          : 'Enter the total cost of this stage so we can calculate the remaining balance.');
        return;
      }
      if (Number(parsedTotal) <= Number(parsed)) {
        setError(lang === 'fr'
          ? 'Le coût total de l’étape doit être supérieur au montant déjà payé. Si toute l’étape est réglée, sélectionnez « Paiement complet ».'
          : 'The total stage cost must be greater than the amount already paid. If the whole stage is paid, choose “Full payment”.');
        return;
      }
    }
    setWorking(true);
    setError(null);
    try {
      await recordContractorStageVerification({
        stageId,
        amount: parsed ? Number(parsed) : null,
        currency: parsed ? activeCurrency : null,
        fxRate: parsed ? fxRate : null,
        note,
        isPartial,
        stageTotal: isPartial && parsedTotal ? Number(parsedTotal) : null,
      });
      if (current.current !== stageId) return;
      setAnswer(null);
      setEditing(false);
      setConfirmUndo(false);
      setNote('');
      await load();
      await onChanged();
    } catch (err) {
      if (current.current === stageId) {
        const msg = err instanceof Error ? err.message : '';
        setError(/payment_locked_after_approval/.test(msg)
          ? (lang === 'fr'
            ? 'Le montant ne peut plus être modifié une fois que les preuves ont été approuvées par le propriétaire.'
            : 'This payment amount can no longer be edited once evidence has been approved by the Homeowner.')
          : (err instanceof Error ? err.message : t('common.somethingWrong')));
      }
    } finally {
      if (current.current === stageId) setWorking(false);
    }
  }

  async function handleUndoVerification() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await clearContractorStageVerification(stageId);
      if (current.current !== stageId) return;
      setEditing(false);
      setConfirmUndo(false);
      setAnswer(null);
      setPaymentMode('full');
      setNote('');
      await load();
      await onChanged();
    } catch (err) {
      if (current.current === stageId) {
        const msg = err instanceof Error ? err.message : '';
        setError(/payment_locked_after_approval/.test(msg)
          ? (lang === 'fr'
            ? 'Le montant ne peut plus être modifié une fois que les preuves ont été approuvées par le propriétaire.'
            : 'This payment amount can no longer be edited once evidence has been approved by the Homeowner.')
          : (err instanceof Error ? err.message : t('common.somethingWrong')));
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
        const msg = err instanceof Error ? err.message : '';
        setError(/payment_locked_after_approval/.test(msg)
          ? (lang === 'fr'
            ? 'Le montant ne peut plus être modifié une fois que les preuves ont été approuvées par le propriétaire.'
            : 'This payment amount can no longer be edited once evidence has been approved by the Homeowner.')
          : (err instanceof Error ? err.message : t('common.somethingWrong')));
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
        const msg = err instanceof Error ? err.message : '';
        setError(/payment_locked_after_approval/.test(msg)
          ? (lang === 'fr'
            ? 'Le montant ne peut plus être modifié une fois que les preuves ont été approuvées par le propriétaire.'
            : 'This payment amount can no longer be edited once evidence has been approved by the Homeowner.')
          : (err instanceof Error ? err.message : t('common.somethingWrong')));
      }
    } finally {
      if (current.current === stageId) setWorking(false);
    }
  }

  function renderPaymentModeFields(submitLabel: string, onCancel: () => void, formAttr: 'new' | 'edit') {
    const iso = activeCurrency;
    return (
      <form
        onSubmit={handleConfirmPaid}
        className="space-y-3 border-t border-brand-border-grey pt-2.5 dark:border-[#2c2c2c]"
        {...(formAttr === 'edit' ? { 'data-contractor-edit-paid-form': true } : { 'data-contractor-paid-form': true })}
      >
        <div className="space-y-1.5">
          <p className="font-semibold text-brand-near-black dark:text-white">
            {lang === 'fr' ? 'S’agit-il d’un paiement complet ou partiel ?' : 'Is this a full or partial payment?'}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={working}
              data-action="payment-mode-full"
              aria-pressed={paymentMode === 'full'}
              onClick={() => {
                setPaymentMode('full');
                setError(null);
              }}
              className={paymentMode === 'full'
                ? 'rounded-lg border-2 border-brand-green bg-brand-green/10 px-3 py-2 text-left text-brand-near-black dark:text-white'
                : 'rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-left text-brand-mid-grey hover:border-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]'}
            >
              <span className="block font-semibold text-brand-near-black dark:text-white">
                {lang === 'fr' ? 'Paiement complet' : 'Full payment'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-brand-mid-grey">
                {lang === 'fr'
                  ? 'Toute cette étape (toutes ses sous-étapes incluses) est déjà payée.'
                  : 'The entire stage (including all its substages) has been paid.'}
              </span>
            </button>
            <button
              type="button"
              disabled={working}
              data-action="payment-mode-partial"
              aria-pressed={paymentMode === 'partial'}
              onClick={() => {
                setPaymentMode('partial');
                if (!stageTotal.trim() && scheduledAmount != null && scheduledAmount > 0) {
                  setStageTotal(String(Math.round(scheduledAmount * 100) / 100));
                }
                setError(null);
              }}
              className={paymentMode === 'partial'
                ? 'rounded-lg border-2 border-state-held bg-state-held/10 px-3 py-2 text-left text-brand-near-black dark:text-white'
                : 'rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-left text-brand-mid-grey hover:border-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]'}
            >
              <span className="block font-semibold text-brand-near-black dark:text-white">
                {lang === 'fr' ? 'Paiement partiel (avance)' : 'Partial payment (advance)'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-brand-mid-grey">
                {lang === 'fr'
                  ? 'Seule une partie est payée ; les autres sous-étapes restent non payées.'
                  : 'Only part is paid; remaining substages stay unpaid.'}
              </span>
            </button>
          </div>
        </div>

        <label className="block font-medium text-brand-near-black dark:text-white">
          {paymentMode === 'partial'
            ? (lang === 'fr' ? `Montant déjà payé (${iso})` : `Amount already paid (${iso})`)
            : t('contractorView.stagePaymentAmountLabel', { currency: iso })}
          <input
            type="text"
            inputMode="decimal"
            data-input="partial-paid-amount"
            value={amount}
            disabled={working}
            placeholder={paymentMode === 'partial' ? '50000' : undefined}
            onChange={e => {
              const raw = e.target.value;
              setAmount(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw);
              setError(null);
            }}
            className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
          />
        </label>

        {paymentMode === 'partial' && (
          <div className="space-y-2">
            <label className="block font-medium text-brand-near-black dark:text-white">
              {lang === 'fr' ? `Coût total de cette étape (${iso})` : `Total cost of this stage (${iso})`}
              <input
                type="text"
                inputMode="decimal"
                data-input="partial-stage-total"
                value={stageTotal}
                disabled={working}
                placeholder="200000"
                onChange={e => {
                  const raw = e.target.value;
                  setStageTotal(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw);
                  setError(null);
                }}
                className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
              />
            </label>
            {liveRemaining != null && liveRemaining > 0 && (
              <p
                data-partial-remaining-preview
                className="rounded-lg border border-state-held/35 bg-state-held/10 px-3 py-2 text-xs font-semibold text-brand-near-black dark:text-white"
              >
                {lang === 'fr'
                  ? `Reste à payer pour cette étape : ${formatAmount(liveRemaining, iso)}`
                  : `Remaining balance for this stage: ${formatAmount(liveRemaining, iso)}`}
              </p>
            )}
            {liveRemaining != null && liveRemaining <= 0 && (
              <p className="text-[11px] font-medium text-state-alert">
                {lang === 'fr'
                  ? 'Le coût total doit être supérieur au montant payé (sinon sélectionnez « Paiement complet »).'
                  : 'Total cost must exceed the paid amount (otherwise choose “Full payment”).'}
              </p>
            )}
          </div>
        )}

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
          <button
            type="submit"
            disabled={working}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {submitLabel}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={onCancel}
            className="px-2 py-1.5 text-brand-mid-grey underline underline-offset-4"
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
    );
  }

  if (!loaded) return null;

  const isPartialSaved = verification?.is_partial === true;
  const savedCurrency = verification?.currency ?? currencyCode;
  const savedTotal = verification?.stage_total_amount != null && Number(verification.stage_total_amount) > 0
    ? Number(verification.stage_total_amount)
    : scheduledAmount != null && scheduledAmount > 0
      ? scheduledAmount
      : null;
  const savedPaid = verification?.amount != null && Number(verification.amount) > 0
    ? Number(verification.amount)
    : null;
  const savedRemaining = isPartialSaved && savedTotal != null && savedPaid != null
    ? Math.max(0, Math.round((savedTotal - savedPaid) * 1e6) / 1e6)
    : null;

  // ── Homeowner view: only shown when the contractor recorded an offline verification ──
  if (!isContractor) {
    if (!verification) return null;
    return (
      <div className="space-y-2 rounded-lg border border-brand-border-grey bg-brand-off-white p-3 text-xs dark:border-[#2c2c2c] dark:bg-[#141414]" data-contractor-recorded>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold text-brand-near-black dark:text-white">
            <CheckCircle2 className="size-4 shrink-0 text-brand-green" aria-hidden />
            {isPartialSaved
              ? (lang === 'fr' ? 'Paiement partiel enregistré par votre entrepreneur' : 'Partial payment recorded by your contractor')
              : t('project.clientUi.contractorRecorded')}
            {savedPaid != null && (
              <span className="font-mono font-normal text-brand-mid-grey">
                · {formatAmount(savedPaid, savedCurrency)}
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

        {isPartialSaved && savedTotal != null && savedRemaining != null && (
          <p className="text-[11px] text-brand-mid-grey" data-homeowner-partial-breakdown>
            {lang === 'fr'
              ? `Coût de l’étape : ${formatAmount(savedTotal, savedCurrency)} · Reste à payer : ${formatAmount(savedRemaining, savedCurrency)}`
              : `Stage cost: ${formatAmount(savedTotal, savedCurrency)} · Remaining balance: ${formatAmount(savedRemaining, savedCurrency)}`}
          </p>
        )}

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
      <div
        className={isPartialSaved
          ? 'space-y-2.5 rounded-lg border border-state-held/40 bg-state-held/[0.06] p-3 text-xs'
          : 'space-y-2.5 rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-xs'}
        data-contractor-verified
        data-contractor-partial={isPartialSaved ? 'true' : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold text-brand-near-black dark:text-white">
            <CheckCircle2 className={isPartialSaved ? 'size-4 shrink-0 text-state-held' : 'size-4 shrink-0 text-brand-green'} aria-hidden />
            {isPartialSaved
              ? (lang === 'fr' ? 'Paiement partiel enregistré par vous' : 'Partial payment recorded by you')
              : t('contractorView.stagePaymentRecordedByYou')}
            {!isPartialSaved && savedPaid != null && (
              <span className="font-mono font-normal text-brand-mid-grey">
                · {formatAmount(savedPaid, savedCurrency)}
              </span>
            )}
          </p>
          {lockedAfterApproval ? (
            <span
              data-payment-locked-after-approval
              className="inline-flex items-center gap-1 rounded-md border border-brand-border-grey bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-brand-mid-grey dark:border-[#333] dark:bg-[#141414]"
            >
              <Lock className="size-3" aria-hidden />
              {lang === 'fr' ? 'Verrouillé · Preuves approuvées' : 'Locked · Evidence approved'}
            </span>
          ) : !readOnly && !editing && !confirmUndo && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-action="edit-contractor-payment"
                onClick={() => {
                  setPaymentMode(isPartialSaved ? 'partial' : 'full');
                  setAmount(verification.amount != null ? String(verification.amount) : '');
                  setStageTotal(
                    verification.stage_total_amount != null
                      ? String(verification.stage_total_amount)
                      : scheduledAmount != null && scheduledAmount > 0
                        ? String(Math.round(scheduledAmount * 100) / 100)
                        : '',
                  );
                  setNote(verification.note ?? '');
                  setEditing(true);
                  setConfirmUndo(false);
                  setError(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-brand-green/40 bg-white px-2.5 py-1 font-semibold text-brand-green hover:bg-brand-green/5 dark:bg-[#141414] dark:text-[#b4d8bf]"
              >
                <Pencil className="size-3" aria-hidden />
                {lang === 'fr' ? 'Modifier le montant' : 'Edit amount'}
              </button>
              <button
                type="button"
                data-action="undo-contractor-payment"
                onClick={() => { setConfirmUndo(true); setEditing(false); setError(null); }}
                className="inline-flex items-center gap-1 rounded-md border border-brand-border-grey bg-white px-2.5 py-1 font-semibold text-brand-mid-grey hover:text-state-alert dark:border-[#333] dark:bg-[#141414]"
              >
                <RotateCcw className="size-3" aria-hidden />
                {lang === 'fr' ? 'Annuler' : 'Undo'}
              </button>
            </div>
          )}
        </div>

        {isPartialSaved && !editing && (
          <div className="space-y-1.5" data-contractor-partial-breakdown>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-[#141414]">
                <dt className="text-[10.5px] text-brand-mid-grey">{lang === 'fr' ? 'Déjà payé' : 'Already paid'}</dt>
                <dd className="font-mono text-xs font-semibold text-brand-near-black dark:text-white">
                  {savedPaid != null ? formatAmount(savedPaid, savedCurrency) : '—'}
                </dd>
              </div>
              <div className="rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-[#141414]">
                <dt className="text-[10.5px] text-brand-mid-grey">{lang === 'fr' ? 'Coût de l’étape' : 'Stage cost'}</dt>
                <dd className="font-mono text-xs font-semibold text-brand-near-black dark:text-white">
                  {savedTotal != null ? formatAmount(savedTotal, savedCurrency) : '—'}
                </dd>
              </div>
              <div className="rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-[#141414]">
                <dt className="text-[10.5px] text-brand-mid-grey">{lang === 'fr' ? 'Reste à payer' : 'Remaining'}</dt>
                <dd className="font-mono text-xs font-semibold text-state-held">
                  {savedRemaining != null ? formatAmount(savedRemaining, savedCurrency) : '—'}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-brand-mid-grey">
              {lang === 'fr'
                ? 'Les autres sous-étapes restent non payées ; vous pouvez demander un paiement sur chacune indépendamment.'
                : 'Other substages stay unpaid so you can request payment on each independently.'}
            </p>
          </div>
        )}

        {verification.note && !editing && (
          <p className="text-[11px] text-brand-mid-grey">{verification.note}</p>
        )}

        {editing && !lockedAfterApproval && renderPaymentModeFields(
          lang === 'fr' ? 'Enregistrer la modification' : 'Save changes',
          () => { setEditing(false); setError(null); },
          'edit',
        )}

        {confirmUndo && !lockedAfterApproval && (
          <div className="space-y-2 border-t border-brand-green/20 pt-2.5" data-contractor-undo-confirm>
            <p className="text-xs text-brand-near-black dark:text-white">
              {lang === 'fr'
                ? 'Annuler cet enregistrement ? Les sous-étapes de cette étape ne seront plus marquées comme payées et vous pourrez les tarifer ou demander un paiement normalement.'
                : 'Remove this recorded payment? Substages on this stage will return to unpaid so you can price or request payment per substage.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={working}
                data-action="confirm-undo-contractor-payment"
                onClick={() => { void handleUndoVerification(); }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-state-alert px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {lang === 'fr' ? 'Oui, annuler le paiement enregistré' : 'Yes, remove recorded payment'}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => { setConfirmUndo(false); setError(null); }}
                className="px-2 py-1.5 text-brand-mid-grey underline underline-offset-4"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-state-alert">{error}</p>}
      </div>
    );
  }

  if (readOnly || settled || hasReceipts || lockedAfterApproval) return null;

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
            ? 'rounded-lg bg-brand-green px-3 py-1.5 font-semibold text-white'
            : 'rounded-lg border border-brand-border-grey px-3 py-1.5 font-semibold text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white'}>
          {t('contractorView.stagePaymentNo')}
        </button>
      </div>

      {answer === 'yes' && renderPaymentModeFields(
        t('contractorView.stagePaymentConfirm'),
        () => { setAnswer(null); setError(null); },
        'new',
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
