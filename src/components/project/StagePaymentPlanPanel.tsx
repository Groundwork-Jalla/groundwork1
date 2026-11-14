import { useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { authorizeStageProgression, decideStagePaymentPlan, fetchStagePaymentPlan, saveStagePaymentPlan, type StagePaymentPlanContext } from '@/lib/supabase/stage-payment-plans';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

type Mode = 'full' | 'two_installments';
type Decision = { context: StagePaymentPlanContext; action: 'save' | 'accept' | 'decline' | 'progress'; mode: Mode; first: string | null };
interface Props {
  stageId: string; isContractor: boolean; readOnly: boolean; canUpload: boolean; refreshKey: unknown;
  onChanged: () => void | Promise<void>; onInstallmentChange: (value: 1 | 2 | undefined) => void;
}

/** An installment is an agreed part of the price, not a limit on receipt files. */
export function StagePaymentPlanPanel({ stageId, isContractor, readOnly, canUpload, refreshKey, onChanged, onInstallmentChange }: Props) {
  const t = useT(); const { lang } = useLanguage();
  const current = useRef<string | null>(stageId); current.current = stageId;
  const callbacks = useRef({ onChanged, onInstallmentChange }); callbacks.current = { onChanged, onInstallmentChange };
  const sequence = useRef(0); const mutation = useRef(false);
  const selection = useRef<{ stage: string; plan?: string; value: 1 | 2 }>({ stage: stageId, value: 1 });
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ stage: string; data: StagePaymentPlanContext | null; failed?: boolean }>({ stage: stageId, data: null });
  const [draft, setDraft] = useState<{ stage: string; mode: Mode; first: string; installment: 1 | 2 } | null>(null);
  const [confirmation, setConfirmation] = useState<Decision | null>(null);
  const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    current.current = stageId;
    const refresh = async () => {
      const request = ++sequence.current;
      try {
        const data = await fetchStagePaymentPlan(stageId);
        if (!alive || request !== sequence.current) return;
        setRead({ stage: stageId, data });
        if (selection.current.stage !== stageId || selection.current.plan !== data.plan?.id) {
          selection.current = { stage: stageId, plan: data.plan?.id, value: 1 };
          setDraft(null);
        }
        callbacks.current.onInstallmentChange(data.plan?.mode === 'two_installments' ? selection.current.value : undefined);
      } catch { if (alive && request === sequence.current) setRead({ stage: stageId, data: null, failed: true }); }
    };
    void refresh(); window.addEventListener('focus', refresh);
    return () => { alive = false; current.current = null; window.removeEventListener('focus', refresh); };
  }, [stageId, refreshKey, attempt]);
  const context = read.stage === stageId ? read.data : null;
  const form = draft?.stage === stageId ? draft : { stage: stageId, mode: context?.plan?.mode ?? 'full', first: context?.plan?.first_amount ?? '', installment: 1 as const };
  const confirm = confirmation?.context.stage_id === stageId ? confirmation : null;
  const editable = !!context?.can_edit && !isContractor && !readOnly && canUpload;
  const canDecide = !!context?.can_decide && isContractor && !readOnly && canUpload;
  const canProgress = !!context?.can_authorize_progression && isContractor && !readOnly && canUpload;
  const amount = (value: string | number | null | undefined) => value == null ? '—'
    : `${Number(value).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 })} ${context?.currency ?? ''}`;
  function request(action: Decision['action']) {
    if (!context || (action === 'save' ? !editable : action === 'progress' ? !canProgress : !canDecide)) return;
    const first = action === 'save' ? canonicalReceiptAmount(form.first) : context.plan?.first_amount ?? null;
    if (action === 'save' && form.mode === 'two_installments' && (!first || Number(first) >= Number(context.stage_amount))) {
      setError(t('project.paymentPlan.invalidFirst')); return;
    }
    setError(null); setConfirmation({ context, action, mode: action === 'save' ? form.mode : context.plan?.mode ?? 'full', first });
  }
  async function commit() {
    if (!confirm || mutation.current || readOnly || !canUpload
      || (confirm.action === 'save' ? !editable : confirm.action === 'progress' ? !canProgress : !canDecide)) return;
    mutation.current = true; setWorking(true); setError(null);
    try {
      const data = confirm.action === 'save' ? await saveStagePaymentPlan(confirm.context, confirm.mode, confirm.first)
        : confirm.action === 'progress' ? await authorizeStageProgression(confirm.context)
        : await decideStagePaymentPlan(confirm.context, confirm.action === 'accept');
      if (current.current !== stageId) return;
      setRead({ stage: stageId, data }); setConfirmation(null); setDraft(null);
      selection.current = { stage: stageId, plan: data.plan?.id, value: 1 };
      callbacks.current.onInstallmentChange(data.plan?.mode === 'two_installments' ? 1 : undefined);
      await callbacks.current.onChanged();
    } catch (failure) {
      if (current.current !== stageId) return;
      setError(t(/stale/.test((failure as Error)?.message ?? '') ? 'project.paymentPlan.stale' : 'project.paymentPlan.failed'));
    } finally { mutation.current = false; if (current.current === stageId) setWorking(false); }
  }
  const first = Number(context?.plan?.first_amount ?? 0), due = Number(context?.stage_amount ?? 0);
  const planned = (installment: 1 | 2) => installment === 1 ? Math.min(first, due) : Math.max(due - first, 0);
  const received = (installment: 1 | 2) => context?.receipts.filter(row => row.installment === installment && row.decision === 'received')
    .reduce((sum, row) => row.amount == null ? NaN : sum + Number(row.amount), 0);
  const description = confirm ? t(confirm.action === 'progress' ? 'project.paymentPlan.confirmProgress' : confirm.action === 'decline' ? 'project.paymentPlan.confirmDecline' : 'project.paymentPlan.confirmPlan', {
    total: amount(confirm.context.stage_amount), first: amount(confirm.mode === 'full' ? confirm.context.stage_amount : Math.min(Number(confirm.first), Number(confirm.context.stage_amount))),
    second: amount(confirm.mode === 'full' ? 0 : Math.max(Number(confirm.context.stage_amount) - Number(confirm.first), 0)), remaining: amount(confirm.context.remaining),
  }) : '';
  if (context && due <= 0) return null;
  return <div className="space-y-3 rounded-xl border border-brand-border-grey p-3 text-xs">
    <h4 className="font-semibold">{t('project.paymentPlan.title')}</h4>
    {!context ? <p role={read.failed ? 'alert' : 'status'}>{t(read.failed ? 'project.paymentPlan.loadFailed' : 'common.loading')}
      {read.failed && <button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>{t('project.costing.retryPayouts')}</button>}</p> : <>
      <p>{t(context.plan?.mode === 'two_installments' ? 'project.paymentPlan.splitSummary' : 'project.paymentPlan.fullSummary')}</p>
      {context.plan?.mode === 'two_installments' && <>
        <p role="status">{t(context.plan.status === 'proposed'
          ? isContractor ? 'project.paymentPlan.awaitingApprovalContractor' : 'project.paymentPlan.awaitingApproval'
          : context.plan.status === 'declined' ? 'project.paymentPlan.declined'
          : isContractor ? 'project.paymentPlan.acceptedContractor' : 'project.paymentPlan.accepted')}</p>
        {[1, 2].map(n => <div key={n} className="flex flex-wrap justify-between gap-2"><span>{t('project.paymentPlan.installment', { n })}: {amount(planned(n as 1 | 2))}</span>
          <span>{t('project.paymentPlan.confirmed', { amount: amount(Number.isFinite(received(n as 1 | 2)) ? received(n as 1 | 2) : null) })}</span></div>)}
        {context.plan.stage_amount !== context.stage_amount && Number(context.plan.stage_amount) !== due && <p>{t('project.paymentPlan.priceChanged')}</p>}
      </>}
      <p className="text-brand-mid-grey">{t('project.paymentPlan.receiptHelp')}</p>
      {editable && <fieldset disabled={working} className="space-y-3">
        <label className="block">{t('project.paymentPlan.method')}<select value={form.mode} onChange={event => { setDraft({ ...form, mode: event.target.value as Mode }); setError(null); }} className="mt-1 block w-full rounded-lg border bg-transparent p-2">
          <option value="full">{t('project.paymentPlan.full')}</option><option value="two_installments">{t('project.paymentPlan.split')}</option>
        </select></label>
        {form.mode === 'two_installments' && <label className="block">{t('project.paymentPlan.firstAmount', { currency: context.currency })}
          <input inputMode="decimal" value={form.first} onChange={event => { const raw = event.target.value; setDraft({ ...form, first: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); }} className="mt-1 block w-full rounded-lg border bg-transparent p-2"/>
          <span className="mt-1 block">{t('project.paymentPlan.secondAmount', { amount: amount(Math.max(due - (Number(form.first) || 0), 0)) })}</span>
        </label>}
        <button type="button" onClick={() => request('save')} className="rounded-lg border border-brand-green px-3 py-2 font-semibold">{t('project.paymentPlan.save')}</button>
      </fieldset>}
      {canDecide && <div className="flex flex-wrap gap-2"><button type="button" disabled={working} onClick={() => request('accept')} className="rounded-lg bg-brand-green px-3 py-2 font-semibold text-white">{t('project.paymentPlan.accept')}</button>
        <button type="button" disabled={working} onClick={() => request('decline')} className="rounded-lg border px-3 py-2 font-semibold">{t('project.paymentPlan.reviewPlan')}</button></div>}
      {!isContractor && !readOnly && canUpload && context.plan?.mode === 'two_installments' && context.plan.status !== 'declined' && <label className="block font-semibold">{t('project.paymentPlan.receiptFor')}
        <select value={form.installment} onChange={event => { const installment = Number(event.target.value) as 1 | 2; selection.current = { stage: stageId, plan: context.plan?.id, value: installment }; setDraft({ ...form, installment }); callbacks.current.onInstallmentChange(installment); }} className="mt-1 block w-full rounded-lg border bg-transparent p-2">
          <option value="1">{t('project.paymentPlan.installment', { n: 1 })}</option><option value="2">{t('project.paymentPlan.installment', { n: 2 })}</option>
        </select>
      </label>}
      <p className="text-brand-mid-grey">{t(context.progression_authorized && Number(context.remaining) > 0 ? 'project.paymentPlan.balanceAuthorized' : 'project.paymentPlan.nextStageRule')}</p>
      {canProgress && <button type="button" disabled={working} onClick={() => request('progress')} className="rounded-lg border border-brand-green px-3 py-2 font-semibold">{t('project.paymentPlan.allowNext')}</button>}
    </>}
    <ConfirmModal open={!!confirm} title={t('project.paymentPlan.confirmTitle')} description={description} confirmLabel={t('project.receiptFlow.confirmFinal')} cancelLabel={t('common.cancel')} loading={working} error={error} onConfirm={commit} onCancel={() => { if (!working) setConfirmation(null); }}/>
    {error && <p role="alert" className="text-state-alert">{error}</p>}
  </div>;
}
