import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useRef, useState, type FormEvent } from 'react';
import { Camera, FileUp, Loader2, Receipt } from 'lucide-react';
import { useT, useLanguage } from '@/lib/i18n';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount, MAX_RECEIPT_BYTES, RECEIPT_ACCEPT } from '@/lib/payments/receipt-reading';
import { receiptCurrencyChoices } from '@/lib/payments/receipt-currencies';
import { stageReceiptBalance } from '@/lib/payments/stage-receipt-balance';
import { receiptErrorText } from '@/lib/payments/receipt-error-text';
import { uploadStagePaymentReceipt, confirmStagePayment, decideStagePaymentReceipt, signReceiptUrl,
  type StagePayment, type StagePaymentReceipt } from '@/lib/supabase/verifications';
import { DocumentViewer } from './DocumentViewer';
import { ProjectExchangeRateNote, ReceiptExchangeRateNote } from './ExchangeRateNote';
import { StagePaymentPlanPanel } from './StagePaymentPlanPanel';
import type { SubstagePaymentContext, SubstagePaymentPart } from '@/lib/supabase/substage-payments';
import { substageLabelWith } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';

interface Props {
  projectId: string; stageId: string; stageNumber: number; payment: StagePayment | undefined;
  isContractor: boolean; readOnly?: boolean; canUpload?: boolean; blockedReason?: string; scheduledAmount?: number | null; workReviewed?: boolean;
  /** Where each part stands, on a stage paid part by part (18 Nov). Replaces the installment plan there. */
  parts?: SubstagePaymentContext | null;
  onChanged: () => void | Promise<void>;
  clientPresentation?: boolean;
  /** The contractor's project screen reviews a receipt in its own dialog (18 Nov redesign). */
  onReviewReceipt?: (receiptId: string) => void;
  /** The parts are already listed beside the stage's work, so the panel does not repeat them. */
  hideParts?: boolean;
}

/** Recorded money, a contractor's decision to proceed, and work approval stay distinct. */
export function StagePaymentGate({ projectId, stageId, stageNumber, payment, isContractor,
  canUpload = true, readOnly = false, blockedReason, scheduledAmount, workReviewed = false, onChanged, clientPresentation = false, parts = null, onReviewReceipt, hideParts = false }: Props) {
  const t = useT(); const { lang } = useLanguage(); const currency = useProjectMoneyContext();
  const scope = `${projectId}:${stageId}`; const current = useRef(scope); current.current = scope;
  const pendingWork = useRef<string | null>(null); const viewRequest = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const installment = useRef<{ scope: string; value: 1 | 2 | undefined }>({ scope, value: undefined });
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [planEditing, setPlanEditing] = useState<string | null>(null);
  // What the reader found printed on the receipt, when it is not what was typed. Offered
  // back as one tap, because the usual cause is typing the project-currency equivalent of
  // a receipt issued in another currency: 138,453 XAF for a receipt that says 315,000 NGN.
  const [suggestion, setSuggestion] = useState<{ scope: string; amount: string; currency: string } | null>(null);
  const [draft, setDraft] = useState<{ scope: string; amount: string; currency: string; file: File | null }>({ scope, amount: '', currency: '', file: null });
  const [decisionForm, setDecisionForm] = useState<{ scope: string; receipt: string; decision: 'accept' | 'record' | 'needs_top_up' | 'flag'; amount: string; note: string; step?:'receipt'|'progress' } | null>(null);
  const [viewer, setViewer] = useState<{ scope: string; name: string; url: string | null } | null>(null);
  const [confirmation,setConfirmation]=useState<{scope:string;receipt?:StagePaymentReceipt;stageAmount:number;legacy?:{path:string;uploadedAt:string};action:'accept'|'record'|'needs_top_up'|'flag';note?:string;topUp?:string;description:string}|null>(null);
  const [replacement,setReplacement]=useState<{scope:string;receiptId:string}|null>(null);
  const [fileQueue,setFileQueue]=useState<{scope:string;files:File[]}>({scope,files:[]});
  const activeDraft = draft.scope === scope ? draft : { scope, amount: '', currency: '', file: null };
  const form = decisionForm?.scope === scope ? decisionForm : null;
  const busy = working === scope; const error = failure?.scope === scope ? failure.message : null;
  const code = currency?.code ?? 'USD'; const fxRate = currency?.budgetRate ?? currency?.rate ?? 1;
  const scheduledUsd = scheduledAmount != null ? scheduledAmount / fxRate : payment?.amount ?? 0;
  const scheduledPair = currency?.pair?.(scheduledUsd, scheduledAmount);
  const selectedCurrency = activeDraft.currency || code;
  const settled = payment?.state === 'funded' || payment?.state === 'reconciled';
  const receipts = payment?.receipts ?? [];
  const balance = payment ? stageReceiptBalance(payment, code, fxRate, scheduledAmount) : null;
  const liveReceipts=receipts.filter(receipt=>!receipt.replacedBy);
  const pending = liveReceipts.find(receipt => receipt.decision === 'pending');
  const requested = [...liveReceipts].reverse().find(receipt => receipt.decision === 'received' && receipt.requestedTopUp != null);
  const receivedWithoutWork = [...liveReceipts].reverse().find(receipt => receipt.decision === 'received' && !receipt.allowsWork);
  const legacyPending = !receipts.length && payment?.state === 'receipt_submitted'
    && payment.receiptPath && payment.receiptUploadedAt && payment.receiptAmount != null;
  // A stage paid by part takes a receipt for one part at a time: the first part not yet
  // covered whose earlier parts are approved. A replacement keeps its receipt's part.
  const split = !!parts?.split;
  const partOf = (id: string | null | undefined) => parts?.parts?.find(part => part.id === id) ?? null;
  const partName = (part: Pick<SubstagePaymentPart, 'name' | 'key'>) => substageLabelWith(t, { name: part.name, substage_key: part.key });
  const replacedPart = replacement?.scope === scope ? receipts.find(receipt => receipt.id === replacement.receiptId)?.substageId ?? null : null;
  const payingPart = split ? partOf(replacedPart ?? parts?.next_payable) : null;
  const allowed = canUpload && !!payment && !readOnly && !isContractor
    && (scheduledAmount == null || scheduledAmount > 0 || replacement?.scope === scope)
    && (!settled || balance?.remaining !== 0 || replacement?.scope === scope)
    && (!split || !!payingPart);
  const fail = (message: string) => setFailure({ scope, message });
  const format = (value: number | null, iso: string | null) => value == null ? t('project.receiptFlow.amountUnknown')
    : new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 }).format(value) + ` ${iso ?? ''}`;

  const errorText = (error: unknown) => receiptErrorText(t, error);

  async function upload(file: File | null = activeDraft.file) {
    if (!allowed || pendingWork.current === scope) return;
    if (!file) { fileRef.current?.click(); return; }
    if (!file.size || file.size > MAX_RECEIPT_BYTES) { fail(t('project.receiptFlow.fileSize')); return; }
    if (!RECEIPT_ACCEPT.split(',').includes(file.type)) { fail(t('project.receiptFlow.fileType')); return; }
    if (!canonicalReceiptAmount(activeDraft.amount)) { fail(t('project.stages.receiptAmountInvalid')); return; }
    pendingWork.current = scope; setWorking(scope); setFailure(null);
    try {
      await uploadStagePaymentReceipt(projectId, stageId, file, { amount: activeDraft.amount, currency: selectedCurrency,
        fxRate: selectedCurrency === code ? fxRate : selectedCurrency === 'USD' ? 1 : undefined,
        ...(split && payingPart ? { substageId: payingPart.id }
          : installment.current.scope === scope && installment.current.value ? { installment: installment.current.value } : {}),
        ...(replacement?.scope===scope?{replacesReceiptId:replacement.receiptId}:{}) });
      if (current.current === scope) {
        await onChanged();
        if (current.current === scope) {const rest=fileQueue.scope===scope?fileQueue.files:[];setDraft({ scope, amount: '', currency: activeDraft.currency, file: rest[0]??null });setFileQueue({scope,files:rest.slice(1)});setReplacement(null);}
      }
    } catch (error) {
      if (current.current === scope) {
        fail(errorText(error));
        const read = error as { code?: string; message?: string; amount?: string; currency?: string } | null;
        const mismatch = /amount_mismatch|currency_mismatch/.test(`${read?.code ?? ''} ${read?.message ?? ''}`);
        setSuggestion(mismatch && canonicalReceiptAmount(read?.amount) && /^[A-Z]{3}$/.test(read?.currency ?? '')
          ? { scope, amount: read!.amount!, currency: read!.currency! } : null);
      }
    }
    finally { if (pendingWork.current === scope) pendingWork.current = null; if (current.current === scope) setWorking(null); }
  }
  async function selectFile(file: File | null,queue:File[]=[]) {
    if (!file || !allowed || busy) return;
    setFileQueue({scope,files:queue});setDraft({ scope, amount: activeDraft.amount, currency: activeDraft.currency, file }); setFailure(null);
    if (!queue.length&&canonicalReceiptAmount(activeDraft.amount)) await upload(file);
  }
  function submit(event: FormEvent) { event.preventDefault(); return upload(); }

  async function decide(receipt: StagePaymentReceipt | undefined, action: 'accept' | 'record' | 'needs_top_up' | 'flag', note?: string, topUp?: string, expectedAmount?: number, legacy?: {path:string;uploadedAt:string}) {
    if (!isContractor || readOnly || !canUpload || pendingWork.current === scope) return;
    if (action === 'needs_top_up' && !canonicalReceiptAmount(topUp)) { fail(t('project.stages.receiptAmountInvalid')); return; }
    if (action === 'flag' && !note?.trim()) { fail(t('project.receiptFlow.reasonRequired')); return; }
    pendingWork.current = scope; setWorking(scope); setFailure(null);
    try {
      if (receipt) await decideStagePaymentReceipt(receipt.id, action, note, topUp,{stageAmount:expectedAmount??scheduledAmount??payment!.amount*fxRate,decision:receipt.decision});
      else if (action === 'accept' && legacy) {
        await confirmStagePayment(stageId, note, legacy);
      } else return;
      if (current.current === scope) { setDecisionForm(null); await onChanged(); }return true;
    } catch (error) {
      if (current.current === scope) { fail(errorText(error)); try { await onChanged(); } catch { /* Keep the requested action retryable. */ } }return false;
    } finally { if (pendingWork.current === scope) pendingWork.current = null; if (current.current === scope) setWorking(null); }
  }

  const confirm=confirmation?.scope===scope?confirmation:null;
  const reviewedReceipt=form?liveReceipts.find(receipt=>receipt.id===form.receipt):undefined;
  function review(receipt:StagePaymentReceipt|undefined,action:'accept'|'record'|'needs_top_up'|'flag',note?:string,topUp?:string){
    if(action==='needs_top_up'&&!canonicalReceiptAmount(topUp)){fail(t('project.stages.receiptAmountInvalid'));return;}
    if(action==='flag'&&!note?.trim()){fail(t('project.receiptFlow.reasonRequired'));return;}
    const money=format(receipt?.amount??payment?.receiptAmount??null,receipt?.currency??payment?.receiptCurrency??code);
    const projected=payment?stageReceiptBalance({...payment,receipts:payment.receipts?.map(item=>item.id===receipt?.id&&action!=='flag'?{...item,decision:'received' as const}:item)},code,fxRate,scheduledAmount):balance;
    const coverage=t('project.receiptFlow.coverageAfter',{received:format(projected?.received??null,code),remaining:format(projected?.remaining??null,code)});
    setConfirmation({scope,receipt,stageAmount:scheduledAmount??payment!.amount*fxRate,legacy:!receipt&&payment?.receiptPath&&payment.receiptUploadedAt?{path:payment.receiptPath,uploadedAt:payment.receiptUploadedAt}:undefined,action,note,topUp,description:t('project.receiptFlow.confirmMoney',{amount:money})+'\n'+t('project.receiptFlow.schedule',{amount:format(scheduledAmount??payment!.amount*fxRate,code)})+'\n'+coverage+'\n'+t(action==='flag'?'project.receiptFlow.confirmMissing':action==='needs_top_up'?'project.receiptFlow.confirmAdditional':action==='record'?'project.receiptFlow.confirmRecorded':'project.receiptFlow.confirmContinue',{amount:format(topUp==null?null:Number(topUp),receipt?.currency??code)})+'\n'+t('project.receiptFlow.balanceStaysRecorded')});
  }
  async function confirmDecision(){if(!confirm)return;const saved=await decide(confirm.receipt,confirm.action,confirm.note,confirm.topUp,confirm.stageAmount,confirm.legacy);if(saved&&current.current===scope)setConfirmation(null);}
  function correctReceipt(receipt:StagePaymentReceipt){setFileQueue({scope,files:[]});setReplacement({scope,receiptId:receipt.id});setDraft({scope,amount:'',currency:receipt.currency??code,file:null});setFailure(null);}

  async function openReceipt(path: string) {
    const request = ++viewRequest.current;
    setViewer({ scope, name: path.split('/').pop() ?? 'receipt.pdf', url: null });
    try {
      const url = await signReceiptUrl(path);
      if (request !== viewRequest.current || current.current !== scope) return;
      if (!url) throw new Error('unavailable');
      setViewer({ scope, name: path.split('/').pop() ?? 'receipt.pdf', url });
    } catch { if (request === viewRequest.current && current.current === scope) { setViewer(null); fail(t('project.receiptFlow.openReceipt')); } }
  }
  function closeViewer() { ++viewRequest.current; setViewer(null); }

  if (!payment) return null;
  return <section id={`stage-payment-${stageId}`} className={cn('mt-5 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]', clientPresentation ? 'space-y-4 bg-white p-4 sm:p-5' : 'space-y-3 bg-brand-off-white p-4')} aria-label={t('project.receiptFlow.title', { n: stageNumber })}>
    <h3 className={cn('flex items-center gap-2 font-semibold text-brand-near-black dark:text-white', clientPresentation ? 'text-base' : 'text-sm')}><Receipt className={clientPresentation ? 'size-5 text-brand-green' : 'size-4'} aria-hidden />{t('project.receiptFlow.title', { n: stageNumber })}</h3>
    {workReviewed && <p className="text-xs text-brand-mid-grey">{t(isContractor ? 'project.receiptFlow.reviewedStagePaymentContractor' : readOnly ? 'project.receiptFlow.reviewedStagePaymentObserver' : 'project.receiptFlow.reviewedStagePayment')}</p>}
    {!clientPresentation && <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.schedule', { amount: format(scheduledAmount ?? payment.amount * fxRate, code) })}</p>}
    {scheduledPair?.usd && <p className="font-mono text-xs text-brand-mid-grey">≈ {scheduledPair.usd}</p>}
    <ProjectExchangeRateNote/>
    {balance&&<p role="status" className={clientPresentation ? 'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium leading-relaxed text-brand-mid-grey' : 'rounded-lg border border-brand-border-grey p-3 text-sm font-semibold'}>{clientPresentation && <span className={cn('size-1.5 shrink-0 rounded-full', balance.remaining === 0 ? 'bg-brand-green' : 'bg-state-held')} aria-hidden />}{t(balance.received===null?'project.receiptFlow.amountUnknown':balance.remaining===0?'project.receiptFlow.fullyPaid':balance.received>0?'project.receiptFlow.partiallyPaid':'project.receiptFlow.awaitingFunds')}{settled&&balance.remaining!==null&&balance.remaining>0&&<span className="mt-1 block w-full text-xs font-normal">{t('project.receiptFlow.partialAuthorized')}</span>}</p>}
    {balance && <dl className={cn('grid gap-3 text-xs', clientPresentation ? 'grid-cols-1 sm:grid-cols-3 [&>div]:min-w-0 [&>div]:rounded-lg [&>div]:border [&>div]:border-brand-border-grey [&>div]:p-3 [&_dd]:break-words [&_dd]:font-semibold [&_dd]:leading-relaxed' : 'grid-cols-2')}>
      {clientPresentation && <div><dt className="text-brand-mid-grey">{t('project.clientUi.stageBudget')}</dt><dd className="mt-1 font-mono">{format(scheduledAmount ?? payment.amount * fxRate, code)}</dd></div>}
      <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.receivedTotal')}</dt><dd className="mt-1 font-mono">{format(balance.received, code)}</dd></div>
      <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.remainingStageBudget')}</dt><dd className="mt-1 font-mono">{format(balance.remaining, code)}</dd></div>
      {(balance.pending == null || balance.pending > 0) && <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.pendingTotal')}</dt><dd className="mt-1 font-mono">{format(balance.pending, code)}</dd></div>}
    </dl>}
    {/* Why a receipt cannot be added here yet. On a contractor-created project this is the
        agreed order (work updates, the client's approval, then payment), and on 16 November
        one small grey line was all that said so: the upload looked broken. */}
    {!canUpload && !settled && <p role="status" data-payment-blocked className={clientPresentation && !isContractor
      ? 'rounded-lg border border-brand-border-grey bg-white p-3 text-sm leading-relaxed text-brand-near-black dark:bg-[#141414]'
      : 'text-xs text-brand-mid-grey'}>{blockedReason ?? t('project.receiptFlow.waitForUpdates')}</p>}
    {split && parts?.parts ? hideParts ? null : <section className={cn('space-y-2 rounded-xl border border-brand-border-grey p-3 text-xs', clientPresentation && 'bg-brand-off-white sm:p-4')} data-stage-parts>
      <h4 className="font-semibold">{t('project.parts.title')}</h4>
      <p className="text-brand-mid-grey">{t('project.parts.rule')}</p>
      <ol className="space-y-1.5">{parts.parts.map(part => <li key={part.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]">
        <span className="min-w-0 break-words font-semibold">{partName(part)}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{format(Number(part.price), parts.currency ?? code)}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', part.status === 'complete' || part.paid ? 'bg-state-complete/10 text-state-complete' : part.payable ? 'bg-brand-green text-white' : 'bg-brand-off-white text-brand-mid-grey')}>
            {t(part.status === 'complete' ? 'project.parts.done' : part.paid ? 'project.parts.paid' : Number(part.pending) > 0 ? 'project.parts.waiting' : part.payable ? 'project.parts.payNext' : 'project.parts.later')}
          </span>
        </span>
        {!part.paid && Number(part.covered) > 0 && <p className="w-full text-brand-mid-grey">{t('project.parts.partlyCovered', { covered: format(Number(part.covered), parts.currency ?? code), remaining: format(Number(part.remaining), parts.currency ?? code) })}</p>}
      </li>)}</ol>
      {!isContractor && !readOnly && !payingPart && parts.parts.some(part => part.status !== 'complete') && <p role="status">{t('project.parts.waitForApproval')}</p>}
    </section>
    : <StagePaymentPlanPanel key={stageId} stageId={stageId} isContractor={isContractor} readOnly={readOnly} canUpload={canUpload} refreshKey={payment} clientPresentation={clientPresentation}
      onEditingChange={editing => setPlanEditing(editing ? scope : null)}
      onChanged={onChanged} onInstallmentChange={value => { installment.current = { scope, value }; }}/>}
    {receipts.length > 0 && clientPresentation && <h4 className="text-sm font-semibold text-brand-near-black">{t('project.clientUi.paymentHistory')}</h4>}
    {receipts.length > 0 && <ol className={cn('divide-y divide-brand-border-grey dark:divide-[#333]', clientPresentation && 'rounded-lg border border-brand-border-grey px-3')}>{receipts.map(receipt => <li key={receipt.id} id={`receipt-${receipt.id}`} className="py-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-mono font-semibold text-brand-near-black dark:text-white">{format(receipt.amount, receipt.currency)}</p>
        <span className={receipt.decision === 'received' ? 'text-state-complete' : 'text-brand-mid-grey'}>{t(receipt.replacedBy?'project.receiptFlow.replaced':receipt.decision === 'received' ? 'project.receiptFlow.received' : receipt.decision === 'flagged' ? 'project.receiptFlow.flagged' : 'project.receiptFlow.pending')}</span>
      </div>
      {receipt.installmentNumber && receipt.paymentPlanId && !receipt.substageId && <p className="mt-1 text-brand-mid-grey">{t('project.paymentPlan.installment', { n: receipt.installmentNumber })}</p>}
      {receipt.substageId && partOf(receipt.substageId) && <p className="mt-1 text-brand-mid-grey">{t('project.parts.receiptFor', { part: partName(partOf(receipt.substageId)!) })}</p>}
      {receipt.amountUsd != null && receipt.currency !== 'USD' && <p className="mt-1 font-mono text-brand-mid-grey">≈ ${receipt.amountUsd.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })}</p>}
      {receipt.projectAmount != null && receipt.projectCurrency !== receipt.currency && <p className="mt-1 font-mono text-brand-mid-grey">{t('project.receiptFlow.projectEquivalent', { amount: format(receipt.projectAmount, receipt.projectCurrency ?? code) })}</p>}
      <ReceiptExchangeRateNote receipt={receipt}/>
      {receipt.decision==='pending'&&!receipt.replacedBy&&isContractor&&!readOnly&&canUpload&&<button type="button" disabled={busy} onClick={()=>onReviewReceipt?onReviewReceipt(receipt.id):setDecisionForm({scope,receipt:receipt.id,decision:'accept',amount:'',note:'',step:'receipt'})} className="mt-2 ml-3 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white">{t('project.receiptFlow.reviewPayment')}</button>}
      {!isContractor&&!readOnly&&canUpload&&!receipt.replacedBy&&receipt.decision!=='received'&&<button type="button" disabled={busy} onClick={()=>correctReceipt(receipt)} className="mt-2 ml-3 rounded-lg border px-3 py-2 font-semibold">{t('project.receiptFlow.replaceReceipt')}</button>}
      {receipt.decisionNote && <p className="mt-1 whitespace-pre-wrap text-brand-mid-grey">{receipt.decisionNote}</p>}
      <button type="button" className="mt-2 font-semibold text-brand-green underline" onClick={() => { void openReceipt(receipt.path); }}>{t('project.stages.confirmView')}</button>
    </li>)}</ol>}
    {legacyPending && <div className="space-y-2 text-xs"><p className="font-mono">{format(payment.receiptAmount ?? null, payment.receiptCurrency ?? null)}</p>
      {payment.receiptAmountUsd != null && payment.receiptCurrency !== 'USD' && <p className="font-mono text-brand-mid-grey">≈ ${payment.receiptAmountUsd.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })}</p>}
      <button type="button" className="font-semibold text-brand-green underline" onClick={() => { void openReceipt(payment.receiptPath!); }}>{t('project.stages.confirmView')}</button></div>}
    {requested && requested.requestedTopUp != null && !settled && <p className="text-xs text-brand-near-black dark:text-white">{t('project.receiptFlow.topUpRequested', { amount: format(requested.requestedTopUp, requested.currency) })}</p>}
    {isContractor && !readOnly ? <>
      {legacyPending&&<button type="button" disabled={!canUpload||busy} onClick={()=>review(undefined,'accept')} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.reviewPayment')}</button>}
      {/* One payment action at a time. While a receipt is waiting to be reviewed, that
          review is the action: it ends on the same continue / record / top-up choice
          this button opens, so showing both read as two buttons for one thing
          (16 November). Once nothing is waiting, this is how work is allowed on money
          already confirmed. */}
      {receivedWithoutWork && !settled && !pending && !form && <button type="button" disabled={!canUpload || busy} onClick={() => setDecisionForm({scope,receipt:receivedWithoutWork.id,decision:'accept',amount:'',note:'',step:'progress'})} className="rounded-lg bg-brand-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{t('project.receiptFlow.continueWithReceived')}</button>}
      {form&&<div className="space-y-3 rounded-xl border border-brand-green/40 p-4">
        <p className="font-mono text-sm font-semibold">{format(reviewedReceipt?.amount??null,reviewedReceipt?.currency??code)}</p>
        {form.step==='receipt'?<>
          <p className="text-sm font-semibold">{t('project.receiptFlow.receivedQuestion')}</p>
          <button type="button" disabled={busy} onClick={()=>setDecisionForm({...form,step:'progress'})} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.receivedYes')}</button>
          <button type="button" disabled={busy} onClick={()=>setDecisionForm({...form,decision:'flag',step:'progress'})} className="ml-2 rounded-lg border px-3 py-2 text-sm">{t('project.receiptFlow.receivedNo')}</button>
        </>:<>
          {form.decision!=='flag'&&<><p className="text-sm font-semibold">{t('project.receiptFlow.progressQuestion')}</p>
            <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.partialChoiceHelp')}</p>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>review(reviewedReceipt,'accept')} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.continueChoice')}</button>
            <button type="button" disabled={busy} onClick={()=>review(reviewedReceipt,'record')} className="rounded-lg border px-3 py-2 text-sm">{t('project.receiptFlow.recordOnly')}</button>
            <button type="button" disabled={busy} onClick={()=>setDecisionForm({...form,decision:'needs_top_up'})} className="rounded-lg border px-3 py-2 text-sm">{t('project.receiptFlow.requestTopUp')}</button></div></>}
          {(form.decision==='needs_top_up'||form.decision==='flag')&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();review(reviewedReceipt,form.decision as 'needs_top_up'|'flag',form.note,form.amount);}}>
            {form.decision==='needs_top_up'&&<label className="block text-xs">{t('project.receiptFlow.topUpAmount',{currency:reviewedReceipt?.currency??code})}<input inputMode="decimal" value={form.amount} disabled={busy} onChange={event=>{const raw=event.target.value;setDecisionForm({...form,amount:/^[\d.,\s]*$/.test(raw)?normaliseBudgetInput(raw,lang):raw});}} className="mt-1 w-full rounded-lg border bg-transparent p-3"/></label>}
            <label className="block text-xs">{t(form.decision==='flag'?'project.receiptFlow.reason':'project.receiptFlow.note')}<textarea value={form.note} maxLength={2000} disabled={busy} onChange={event=>setDecisionForm({...form,note:event.target.value})} className="mt-1 w-full rounded-lg border bg-transparent p-3"/></label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.reviewDecision')}</button>
          </form>}
        </>}
        <button type="button" disabled={busy} onClick={()=>setDecisionForm(null)} className="text-xs underline">{t('common.cancel')}</button>
      </div>}
      {canUpload && !pending && !legacyPending && !requested && !settled && <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.waitForReceipt')}</p>}
    </> : readOnly ? null : allowed && planEditing !== scope && <form onSubmit={submit} className={cn('space-y-3', clientPresentation && 'border-t border-brand-border-grey pt-4')}>
      {clientPresentation && <h4 className="text-sm font-semibold text-brand-near-black">{t('project.clientUi.addReceipt')}</h4>}
      {payingPart && <p role="status" className="text-sm font-semibold">{t('project.parts.receiptFor', { part: partName(payingPart) })} <span className="font-mono font-normal text-brand-mid-grey">{t('project.parts.due', { amount: format(Number(payingPart.remaining), parts?.currency ?? code) })}</span></p>}
      <fieldset disabled={!allowed || busy} className="space-y-3 disabled:opacity-40">
        {replacement?.scope===scope&&<p className="text-sm font-semibold">{t('project.receiptFlow.replacementHelp')}</p>}
        {pending&&<p role="status" className="text-sm">{t('project.receiptFlow.pendingMore')}</p>}
        <div className={clientPresentation ? 'grid gap-2 sm:grid-cols-2' : 'flex flex-wrap gap-2'} role="group" aria-label={t('project.stages.receiptChoose')}>
          <button type="button" disabled={busy} onClick={()=>fileRef.current?.click()} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold', clientPresentation ? 'border border-brand-green text-brand-green hover:bg-brand-off-white dark:text-[#b4d8bf]' : 'bg-brand-green text-white')}><FileUp className="size-4" aria-hidden/>{t('project.receiptFlow.pickFile')}</button>
          <button type="button" disabled={busy} onClick={()=>cameraRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-green px-4 py-3 text-sm font-semibold"><Camera className="size-4" aria-hidden/>{t('project.receiptFlow.takePhoto')}</button>
        </div>
        <label htmlFor={`receipt-currency-${stageId}`} className="block text-xs font-medium">{t('project.receiptFlow.currencyLabel')}</label>
        <select id={`receipt-currency-${stageId}`} name="receipt-currency" value={selectedCurrency}
          onChange={event => { setDraft({ ...activeDraft, currency: event.target.value }); setFailure(null); }}
          className={cn('min-h-11 w-full min-w-0 rounded-lg border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]', clientPresentation ? 'text-base sm:text-sm' : 'text-sm')}>
          {receiptCurrencyChoices(code).map(value => <option key={value} value={value}>{value}{value === code ? ` · ${t('project.receiptFlow.projectCurrency')}` : ''}</option>)}
        </select>
        <label htmlFor={`receipt-amount-${stageId}`} className="block text-xs font-medium">{t('project.stages.receiptAmountLabel', { currency: selectedCurrency })}</label>
        <input id={`receipt-amount-${stageId}`} name="receipt-amount" type="text" inputMode="decimal" autoComplete="off" value={activeDraft.amount}
          onChange={event => { const raw = event.target.value; setDraft({ ...activeDraft, amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); setFailure(null); }}
          className={cn('min-h-11 w-full min-w-0 rounded-lg border border-brand-border-grey bg-white px-3 py-2 font-mono dark:bg-[#141414]', clientPresentation ? 'text-base sm:text-sm' : 'text-sm')} />
        <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.amountHint')}</p>
        {fileQueue.scope===scope&&fileQueue.files.length>0&&<p className="text-xs">{t('project.receiptFlow.additionalFiles',{count:fileQueue.files.length+1})}</p>}
        {activeDraft.file && <p className="break-all text-xs text-brand-mid-grey">{activeDraft.file.name}</p>}
        <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={!allowed || busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t(busy ? 'project.receiptFlow.checking' : 'project.stages.receiptChoose')}
        </button>
        {activeDraft.file && <button type="button" className="text-xs text-brand-green underline" onClick={() => fileRef.current?.click()}>{t('project.receiptFlow.changeFile')}</button>}
        <input ref={fileRef} type="file" multiple={replacement?.scope!==scope} accept={RECEIPT_ACCEPT} className="hidden" aria-label={t('project.receiptFlow.pickFile')} onChange={event => { const files=Array.from(event.target.files??[]);event.target.value='';return selectFile(files[0]??null,files.slice(1)); }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label={t('project.receiptFlow.takePhoto')} onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ''; return selectFile(file); }} />
      </fieldset>
    </form>}
    <ConfirmModal open={!!confirm} title={t('project.receiptFlow.confirmDecision')} description={confirm?.description??''} confirmLabel={t('project.receiptFlow.confirmFinal')} cancelLabel={t('common.cancel')} loading={busy} error={error} onConfirm={confirmDecision} onCancel={()=>setConfirmation(null)}/>
    {error && <p role="alert" className={clientPresentation ? 'rounded-lg border border-state-alert/30 p-3 text-sm leading-relaxed text-state-alert' : 'text-xs text-state-alert'}>{error}</p>}
    {/* Fills the two fields with what the receipt itself says. Nothing is submitted: the
        person still reads the figures and presses upload. */}
    {error && suggestion?.scope === scope && !busy && (
      <button type="button" data-receipt-suggestion
        onClick={() => { setDraft({ ...activeDraft, amount: suggestion.amount, currency: suggestion.currency }); setFailure(null); setSuggestion(null); }}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-brand-green px-3 py-2.5 text-sm font-semibold text-brand-green">
        {t('project.receiptFlow.useReceiptFigures', { amount: `${Number(suggestion.amount).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 })} ${suggestion.currency}` })}
      </button>
    )}
    {viewer?.scope === scope && <DocumentViewer name={viewer.name} url={viewer.url} loading={!viewer.url} onClose={closeViewer} />}
  </section>;
}
