import { useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { currencyFractionDigits } from '@/lib/format';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { installmentSplit } from '@/lib/payments/installment-split';
import { authorizeStageProgression, confirmStageCredit, decideStagePaymentPlan, fetchStagePaymentPlan, saveStagePaymentPlan, type StagePaymentPlanContext } from '@/lib/supabase/stage-payment-plans';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

type Mode = 'full' | 'two_installments';
type Decision = { context: StagePaymentPlanContext; action: 'save' | 'accept' | 'decline' | 'progress' | 'credit'; mode: Mode; first: string | null };
interface Props {
  clientPresentation?: boolean;
  stageId: string; isContractor: boolean; readOnly: boolean; canUpload: boolean; refreshKey: unknown;
  onChanged: () => void | Promise<void>; onInstallmentChange: (value: 1 | 2 | undefined) => void;
  /** True while the client has the plan form open, so the receipt form can step aside. */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * Which installment the next receipt most likely belongs to: the first, until the
 * receipts filed against it (confirmed or still waiting) reach its agreed amount.
 * Flagged and replaced receipts are already left out of `receipts` by the database.
 */
export function nextInstallment(context: Pick<StagePaymentPlanContext, 'stage_amount' | 'plan' | 'receipts'>): 1 | 2 {
  const first = Math.min(Number(context.plan?.first_amount ?? 0), Number(context.stage_amount));
  const filed = context.receipts.filter(row => row.installment === 1 && (row.decision === 'received' || row.decision === 'pending'))
    .reduce((sum, row) => sum + (row.amount == null ? 0 : Number(row.amount)), 0);
  return first > 0 && filed >= first ? 2 : 1;
}

/**
 * How a stage is paid, one step at a time (17 November).
 *
 * On 16 November the plan form and the receipt form were on screen together, and between
 * them asked for a currency twice and an amount twice; nine decisions before one receipt.
 * The two amounts are different facts (what was agreed, and what one receipt proves), so
 * both stay, but never on screen together:
 *
 *   · no plan: full payment is assumed and the receipt form is the whole screen. Two
 *     installments can no longer be started (18 Nov, 20261118000200); paying in parts is
 *     the sub-stage price breakdown, so the client is pointed there instead;
 *   · while the client sets a split: only the plan, in the stage currency, with one amount
 *     field (an amount, never a percentage: 17 Nov stand-up) and the remainder worked out;
 *     the receipt form steps aside;
 *   · once a plan exists: one summary line per installment, and the receipt is filed under
 *     the installment it most likely belongs to, with a way to change it.
 *
 * The plan is still confirmed in a second step before it is saved (Philip's rule).
 */
export function StagePaymentPlanPanel({ stageId, isContractor, readOnly, canUpload, refreshKey, onChanged, onInstallmentChange, onEditingChange, clientPresentation = false }: Props) {
  const t = useT(); const { lang } = useLanguage();
  const current = useRef<string | null>(stageId); current.current = stageId;
  const callbacks = useRef({ onChanged, onInstallmentChange, onEditingChange }); callbacks.current = { onChanged, onInstallmentChange, onEditingChange };
  const sequence = useRef(0); const mutation = useRef(false);
  /** A choice the client made by hand. Cleared when the plan changes. */
  const manual = useRef<{ stage: string; plan?: string; value: 1 | 2 } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ stage: string; data: StagePaymentPlanContext | null; failed?: boolean }>({ stage: stageId, data: null });
  const [editing, setEditing] = useState<{ stage: string; first: string } | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [installment, setInstallment] = useState<{ stage: string; value: 1 | 2 } | null>(null);
  const [confirmation, setConfirmation] = useState<Decision | null>(null);
  const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);

  /** The installment to file the next receipt under, told to the receipt form. */
  function announce(data: StagePaymentPlanContext | null) {
    if (!data || data.plan?.mode !== 'two_installments' || data.plan.status === 'declined') {
      setInstallment(null); callbacks.current.onInstallmentChange(undefined); return;
    }
    const chosen = manual.current?.stage === data.stage_id && manual.current.plan === data.plan.id ? manual.current.value : null;
    const value = chosen ?? nextInstallment(data);
    setInstallment({ stage: data.stage_id, value }); callbacks.current.onInstallmentChange(value);
  }
  function edit(next: { stage: string; first: string } | null) {
    setEditing(next); callbacks.current.onEditingChange?.(!!next);
  }

  useEffect(() => {
    let alive = true;
    current.current = stageId;
    const refresh = async () => {
      const request = ++sequence.current;
      try {
        const data = await fetchStagePaymentPlan(stageId);
        if (!alive || request !== sequence.current) return;
        setRead({ stage: stageId, data });
        if (manual.current && (manual.current.stage !== stageId || manual.current.plan !== data.plan?.id)) manual.current = null;
        announce(data);
      } catch { if (alive && request === sequence.current) setRead({ stage: stageId, data: null, failed: true }); }
    };
    void refresh(); window.addEventListener('focus', refresh);
    return () => { alive = false; current.current = null; window.removeEventListener('focus', refresh); };
  }, [stageId, refreshKey, attempt]);
  // Leaving a stage with the form open must not leave the receipt form hidden.
  useEffect(() => () => { callbacks.current.onEditingChange?.(false); }, [stageId]);

  const context = read.stage === stageId ? read.data : null;
  const form = editing?.stage === stageId ? editing : null;
  const confirm = confirmation?.context.stage_id === stageId ? confirmation : null;
  const editable = !!context?.can_edit && !isContractor && !readOnly && canUpload;
  const canDecide = !!context?.can_decide && isContractor && !readOnly && canUpload;
  const canProgress = !!context?.can_authorize_progression && isContractor && !readOnly && canUpload;
  // Money carried from another stage lowers this stage's balance by itself. Beginning work
  // on it is still the contractor's decision, the same as accepting a receipt.
  const canCredit = !!context?.can_confirm_credit && isContractor && !readOnly && canUpload;
  const permitted = (action: Decision['action']) => action === 'save' ? editable : action === 'progress' ? canProgress : action === 'credit' ? canCredit : canDecide;
  const amount = (value: string | number | null | undefined) => value == null ? '—'
    : `${Number(value).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(context?.currency) })} ${context?.currency ?? ''}`;
  const split = context?.plan?.mode === 'two_installments' ? context.plan : null;

  function request(action: Decision['action'], mode: Mode = 'two_installments') {
    if (!context || !permitted(action)) return;
    const first = action !== 'save' ? context.plan?.first_amount ?? null : mode === 'full' ? null : canonicalReceiptAmount(form?.first ?? '');
    if (action === 'save' && mode === 'two_installments' && (!first || Number(first) >= Number(context.stage_amount))) {
      setError(t('project.paymentPlan.invalidFirst')); return;
    }
    setError(null); setConfirmation({ context, action, mode: action === 'save' ? mode : context.plan?.mode ?? 'full', first });
  }
  async function commit() {
    if (!confirm || mutation.current || readOnly || !canUpload || !permitted(confirm.action)) return;
    mutation.current = true; setWorking(true); setError(null);
    try {
      const data = confirm.action === 'save' ? await saveStagePaymentPlan(confirm.context, confirm.mode, confirm.first)
        : confirm.action === 'progress' ? await authorizeStageProgression(confirm.context)
        : confirm.action === 'credit' ? await confirmStageCredit(confirm.context)
        : await decideStagePaymentPlan(confirm.context, confirm.action === 'accept');
      if (current.current !== stageId) return;
      setRead({ stage: stageId, data }); setConfirmation(null); edit(null);
      manual.current = null; announce(data);
      await callbacks.current.onChanged();
    } catch (failure) {
      if (current.current !== stageId) return;
      const message = (failure as Error)?.message ?? '';
      setError(t(/installments_retired/.test(message) ? 'project.paymentPlan.installmentsRetired' : /stale/.test(message) ? 'project.paymentPlan.stale' : 'project.paymentPlan.failed'));
    } finally { mutation.current = false; if (current.current === stageId) setWorking(false); }
  }
  function choose(value: 1 | 2) {
    if (!context?.plan) return;
    manual.current = { stage: stageId, plan: context.plan.id, value };
    setInstallment({ stage: stageId, value }); setChoosing(null); callbacks.current.onInstallmentChange(value);
  }

  const first = Number(split?.first_amount ?? 0), due = Number(context?.stage_amount ?? 0);
  const planned = (n: 1 | 2) => n === 1 ? Math.min(first, due) : Math.max(due - first, 0);
  const received = (n: 1 | 2) => context?.receipts.filter(row => row.installment === n && row.decision === 'received')
    .reduce((sum, row) => row.amount == null ? NaN : sum + Number(row.amount), 0);
  const description = confirm ? t(confirm.action === 'credit' ? 'project.paymentPlan.confirmCredit' : confirm.action === 'progress' ? 'project.paymentPlan.confirmProgress' : confirm.action === 'decline' ? 'project.paymentPlan.confirmDecline' : confirm.mode === 'full' ? 'project.paymentPlan.confirmFull' : 'project.paymentPlan.confirmPlan', {
    total: amount(confirm.context.stage_amount), first: amount(confirm.mode === 'full' ? confirm.context.stage_amount : Math.min(Number(confirm.first), Number(confirm.context.stage_amount))),
    second: amount(confirm.mode === 'full' ? 0 : Math.max(Number(confirm.context.stage_amount) - Number(confirm.first), 0)), remaining: amount(confirm.context.remaining), carried: amount(confirm.context.carried_in ?? null),
  }) : '';
  if (context && due <= 0) return null;

  const typed = form ? canonicalReceiptAmount(form.first) : null;
  const typedSplit = context && typed ? installmentSplit(context.stage_amount, typed) : null;
  const button = `rounded-lg px-3 py-2 font-semibold ${clientPresentation ? 'min-h-11' : ''}`;
  const link = 'font-semibold text-brand-green underline underline-offset-4 dark:text-[#b4d8bf]';

  return <div className={`space-y-3 rounded-xl border border-brand-border-grey p-3 text-xs ${clientPresentation ? 'bg-brand-off-white sm:p-4' : ''}`}>
    <h4 className="font-semibold">{t('project.paymentPlan.title')}</h4>
    {!context ? <p role={read.failed ? 'alert' : 'status'}>{t(read.failed ? 'project.paymentPlan.loadFailed' : 'common.loading')}
      {read.failed && <button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>{t('project.costing.retryPayouts')}</button>}</p>
    : form ? <fieldset disabled={working} className="space-y-3" data-plan-form>
      {/* Step 1 of 2, on its own: the split, in the stage currency. */}
      <label className="block font-medium">{t('project.paymentPlan.firstAmount', { currency: context.currency })}
        <input inputMode="decimal" aria-label={t('project.paymentPlan.firstAmount', { currency: context.currency })} value={form.first}
          onChange={event => { const raw = event.target.value; edit({ stage: stageId, first: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); setError(null); }}
          className={`mt-1 block w-full rounded-lg border bg-white p-2 font-mono dark:bg-[#141414] ${clientPresentation ? 'min-h-11 text-base sm:text-sm' : ''}`}/>
      </label>
      <p>{t('project.paymentPlan.secondAmount', { amount: amount(typedSplit?.second ?? (Number(typed) >= due ? '0' : context.stage_amount)) })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => request('save')} className={`${button} bg-brand-green text-white`}>{t('project.paymentPlan.save')}</button>
        {split && <button type="button" onClick={() => request('save', 'full')} className={`${button} border border-brand-border-grey`}>{t('project.paymentPlan.payInFull')}</button>}
        <button type="button" onClick={() => { edit(null); setError(null); }} className="px-2 py-2 text-brand-mid-grey underline underline-offset-4">{t('common.cancel')}</button>
      </div>
    </fieldset>
    : <>
      {split ? <>
        <p role="status">{t(split.status === 'proposed'
          ? isContractor ? 'project.paymentPlan.awaitingApprovalContractor' : 'project.paymentPlan.awaitingApproval'
          : split.status === 'declined' ? 'project.paymentPlan.declined'
          : isContractor ? 'project.paymentPlan.acceptedContractor' : 'project.paymentPlan.accepted')}</p>
        <ul className="space-y-1.5">{([1, 2] as const).map(n => <li key={n} className="flex flex-wrap justify-between gap-2 rounded-lg border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]">
          <span className="font-semibold">{`${t('project.paymentPlan.installmentOf', { n })}: ${amount(planned(n))}`}</span>
          <span className="text-brand-mid-grey">{t('project.paymentPlan.confirmed', { amount: amount(Number.isFinite(received(n)) ? received(n) : null) })}</span></li>)}</ul>
        {split.stage_amount !== context.stage_amount && Number(split.stage_amount) !== due && <p>{t('project.paymentPlan.priceChanged')}</p>}
        {editable && <button type="button" className={link} onClick={() => edit({ stage: stageId, first: split.first_amount })}>
          {t(split.status === 'declined' ? 'project.paymentPlan.revisePlan' : 'project.paymentPlan.changePlan')}</button>}
      </> : <>
        {/* Two installments are retired (20261118000200). Paying in parts now means a price
            for each part of the work, which the contractor proposes and the homeowner
            approves; a stage already on two installments keeps them, above. */}
        <p>{t('project.paymentPlan.fullSummary')}</p>
        {editable && <p data-parts-hint className="text-brand-mid-grey">{t('project.paymentPlan.partsHint')}</p>}
      </>}
      {Number(context.carried_in ?? 0) > 0 && <p role="status" className="font-semibold text-brand-green dark:text-[#b4d8bf]">{t('project.paymentPlan.carriedIn', { amount: amount(context.carried_in), remaining: amount(context.remaining) })}</p>}
      {Number(context.carried_out ?? 0) > 0 && <p role="status">{t('project.paymentPlan.carriedOut', { amount: amount(context.carried_out) })}</p>}
      {Number(context.unused_credit ?? 0) > 0 && <p role="status">{t('project.paymentPlan.unusedCredit', { amount: amount(context.unused_credit) })}</p>}
      {canDecide && <div className="flex flex-wrap gap-2"><button type="button" disabled={working} onClick={() => request('accept')} className="rounded-lg bg-brand-green px-3 py-2 font-semibold text-white">{t('project.paymentPlan.accept')}</button>
        <button type="button" disabled={working} onClick={() => request('decline')} className="rounded-lg border px-3 py-2 font-semibold">{t('project.paymentPlan.reviewPlan')}</button></div>}
      {/* Which installment the next receipt is for: worked out, shown, and changeable. */}
      {!isContractor && !readOnly && canUpload && split && split.status !== 'declined' && installment?.stage === stageId && (choosing === stageId
        ? <label className="block font-semibold">{t('project.paymentPlan.receiptFor')}
          <select value={installment.value} autoFocus onChange={event => choose(Number(event.target.value) as 1 | 2)}
            className={`mt-1 block w-full rounded-lg border bg-white p-2 dark:bg-[#141414] ${clientPresentation ? 'min-h-11 text-base sm:text-sm' : ''}`}>
            <option value="1">{t('project.paymentPlan.installment', { n: 1 })}</option><option value="2">{t('project.paymentPlan.installment', { n: 2 })}</option>
          </select></label>
        : <p data-receipt-installment={installment.value}>{t('project.paymentPlan.receiptForInstallment', { n: installment.value })}{' '}
          <button type="button" className={link} onClick={() => setChoosing(stageId)}>{t('project.paymentPlan.changeInstallment')}</button></p>)}
      <p className={context.progression_authorized && Number(context.remaining) > 0 ? 'font-semibold text-brand-green dark:text-[#b4d8bf]' : 'text-brand-mid-grey'}>{t(context.progression_authorized && Number(context.remaining) > 0 ? 'project.paymentPlan.balanceAuthorized' : 'project.paymentPlan.nextStageRule')}</p>
    </>}
    <ConfirmModal open={!!confirm} variant={clientPresentation && !isContractor ? 'client' : 'default'} title={t('project.paymentPlan.confirmTitle')} description={description} confirmLabel={t('project.receiptFlow.confirmFinal')} cancelLabel={t('common.cancel')} loading={working} error={error} onConfirm={commit} onCancel={() => { if (!working) setConfirmation(null); }}/>
    {error && <p role="alert" className="text-state-alert">{error}</p>}
  </div>;
}
