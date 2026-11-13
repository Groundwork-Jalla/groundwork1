import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useRef, useState, type FormEvent } from 'react';
import { Camera, FileUp, Loader2, Receipt } from 'lucide-react';
import { useT, useLanguage } from '@/lib/i18n';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount, MAX_RECEIPT_BYTES, RECEIPT_ACCEPT } from '@/lib/payments/receipt-reading';
import { receiptCurrencyChoices } from '@/lib/payments/receipt-currencies';
import { stageReceiptBalance } from '@/lib/payments/stage-receipt-balance';
import { uploadStagePaymentReceipt, confirmStagePayment, decideStagePaymentReceipt, signReceiptUrl,
  type StagePayment, type StagePaymentReceipt } from '@/lib/supabase/verifications';
import { DocumentViewer } from './DocumentViewer';

interface Props {
  projectId: string; stageId: string; stageNumber: number; payment: StagePayment | undefined;
  isContractor: boolean; readOnly?: boolean; canUpload?: boolean; blockedReason?: string; scheduledAmount?: number | null; workReviewed?: boolean;
  onChanged: () => void | Promise<void>;
}

/** Recorded money, a contractor's decision to proceed, and work approval stay distinct. */
export function StagePaymentGate({ projectId, stageId, stageNumber, payment, isContractor,
  canUpload = true, readOnly = false, blockedReason, scheduledAmount, workReviewed = false, onChanged }: Props) {
  const t = useT(); const { lang } = useLanguage(); const currency = useProjectMoneyContext();
  const scope = `${projectId}:${stageId}`; const current = useRef(scope); current.current = scope;
  const pendingWork = useRef<string | null>(null); const viewRequest = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [draft, setDraft] = useState<{ scope: string; amount: string; currency: string; file: File | null }>({ scope, amount: '', currency: '', file: null });
  const [picker, setPicker] = useState<string | null>(null);
  const [decisionForm, setDecisionForm] = useState<{ scope: string; receipt: string; decision: 'accept' | 'needs_top_up' | 'flag'; amount: string; note: string; step?:'receipt'|'progress' } | null>(null);
  const [viewer, setViewer] = useState<{ scope: string; name: string; url: string | null } | null>(null);
  const [confirmation,setConfirmation]=useState<{scope:string;receiptId?:string;action:'accept'|'needs_top_up'|'flag';note?:string;topUp?:string;description:string}|null>(null);
  const [replacement,setReplacement]=useState<{scope:string;receiptId:string}|null>(null);
  const [fileQueue,setFileQueue]=useState<{scope:string;files:File[]}>({scope,files:[]});
  const activeDraft = draft.scope === scope ? draft : { scope, amount: '', currency: '', file: null };
  const form = decisionForm?.scope === scope ? decisionForm : null;
  const busy = working === scope; const error = failure?.scope === scope ? failure.message : null;
  const code = currency?.code ?? 'USD'; const fxRate = currency?.budgetRate ?? currency?.rate ?? 1;
  const selectedCurrency = activeDraft.currency || code;
  const settled = payment?.state === 'funded' || payment?.state === 'reconciled';
  const receipts = payment?.receipts ?? [];
  const balance = payment ? stageReceiptBalance(payment, code, fxRate, scheduledAmount) : null;
  const liveReceipts=receipts.filter(receipt=>!receipt.replacedBy);
  const pending = liveReceipts.find(receipt => receipt.decision === 'pending');
  const requested = [...liveReceipts].reverse().find(receipt => receipt.decision === 'received' && receipt.requestedTopUp != null);
  const legacyPending = !receipts.length && payment?.state === 'receipt_submitted'
    && payment.receiptPath && payment.receiptUploadedAt && payment.receiptAmount != null;
  const allowed = canUpload && !!payment && !readOnly && !isContractor;
  const fail = (message: string) => setFailure({ scope, message });
  const format = (value: number | null, iso: string | null) => value == null ? t('project.receiptFlow.amountUnknown')
    : new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 }).format(value) + ` ${iso ?? ''}`;

  function errorText(error: unknown) {
    const value = error as { code?: string; message?: string; amount?: string; currency?: string; reference?: string } | null;
    const reason = `${value?.code ?? ''} ${value?.message ?? ''}`;
    const support = (message: string) => value?.reference ? `${message} ${t('project.receiptFlow.checkReference', { reference: value.reference })}` : message;
    if (/amount_mismatch/.test(reason)) return t('project.receiptFlow.amountMismatch', { amount: `${value?.amount ?? ''} ${value?.currency ?? ''}` });
    if (/currency_mismatch/.test(reason)) return t('project.receiptFlow.currencyMismatch', { currency: value?.currency ?? '' });
    if (/receipt_file_size/.test(reason)) return t('project.receiptFlow.fileSize');
    if (/receipt_file_type/.test(reason)) return t('project.receiptFlow.fileType');
    if (/receipt_page_limit/.test(reason)) return t('project.receiptFlow.pageLimit');
    if (/receipt_not_receipt/.test(reason)) return t('project.receiptFlow.notReceipt');
    if (/receipt_payment_not_completed/.test(reason)) return t('project.receiptFlow.notCompleted');
    if (/unreadable/.test(reason)) return t('project.receiptFlow.unreadable');
    if (/receipt_reader_not_configured/.test(reason)) return support(t('project.receiptFlow.readerNeedsAttention'));
    if (/receipt_reader_timeout/.test(reason)) return support(t('project.receiptFlow.readerTimeout'));
    if (/receipt_reader_busy/.test(reason)) return support(t('project.receiptFlow.readerBusy'));
    if (/receipt_reader_response_invalid|receipt_verification_unavailable/.test(reason)) return support(t('project.receiptFlow.processingFailed'));
    if (/receipt_network_error/.test(reason)) return t('project.receiptFlow.connectionLost');
    if (/sign_in_required/.test(reason)) return t('project.receiptFlow.signInRequired');
    if (/receipt_access_denied/.test(reason)) return t('project.receiptFlow.receiptAccess');
    if (/rate_limit/.test(reason)) return t('project.receiptFlow.rateLimit');
    if (/reader_unavailable/.test(reason)) return support(t('project.receiptFlow.readerUnavailable'));
    if (/receipt_rate_unavailable|receipt_conversion_required|receipt_rate_mismatch/.test(reason)) return support(t('project.receiptFlow.exchangeUnavailable'));
    if (/receipt_currency_unsupported/.test(reason)) return t('project.receiptFlow.currencyUnsupported');
    if (/receipt_already_used/.test(reason)) return t('project.receiptFlow.alreadyUsed');
    if (/stale_receipt|receipt_file_changed|receipt_reading_expired|receipt_decided|receipt_accepted|receipt_pending_review/.test(reason)) return t('project.receiptFlow.refreshReceipt');
    return t('project.receiptFlow.tryAgain');
  }

  async function upload(file: File | null = activeDraft.file) {
    if (!allowed || pendingWork.current === scope) return;
    if (!file) { setPicker(scope); return; }
    if (!file.size || file.size > MAX_RECEIPT_BYTES) { fail(t('project.receiptFlow.fileSize')); return; }
    if (!RECEIPT_ACCEPT.split(',').includes(file.type)) { fail(t('project.receiptFlow.fileType')); return; }
    if (!canonicalReceiptAmount(activeDraft.amount)) { fail(t('project.stages.receiptAmountInvalid')); return; }
    pendingWork.current = scope; setWorking(scope); setFailure(null); setPicker(null);
    try {
      await uploadStagePaymentReceipt(projectId, stageId, file, { amount: activeDraft.amount, currency: selectedCurrency,
        fxRate: selectedCurrency === code ? fxRate : selectedCurrency === 'USD' ? 1 : undefined,...(replacement?.scope===scope?{replacesReceiptId:replacement.receiptId}:{}) });
      if (current.current === scope) {
        await onChanged();
        if (current.current === scope) {const rest=fileQueue.scope===scope?fileQueue.files:[];setDraft({ scope, amount: '', currency: activeDraft.currency, file: rest[0]??null });setFileQueue({scope,files:rest.slice(1)});setReplacement(null);}
      }
    } catch (error) { if (current.current === scope) fail(errorText(error)); }
    finally { if (pendingWork.current === scope) pendingWork.current = null; if (current.current === scope) setWorking(null); }
  }
  async function selectFile(file: File | null,queue:File[]=[]) {
    if (!file || !allowed || busy) return;
    setFileQueue({scope,files:queue});setDraft({ scope, amount: activeDraft.amount, currency: activeDraft.currency, file }); setFailure(null); setPicker(null);
    if (!queue.length&&canonicalReceiptAmount(activeDraft.amount)) await upload(file);
  }
  function submit(event: FormEvent) { event.preventDefault(); return upload(); }

  async function decide(receipt: StagePaymentReceipt | undefined, action: 'accept' | 'needs_top_up' | 'flag', note?: string, topUp?: string) {
    if (!isContractor || !canUpload || pendingWork.current === scope) return;
    if (action === 'needs_top_up' && !canonicalReceiptAmount(topUp)) { fail(t('project.stages.receiptAmountInvalid')); return; }
    if (action === 'flag' && !note?.trim()) { fail(t('project.receiptFlow.reasonRequired')); return; }
    pendingWork.current = scope; setWorking(scope); setFailure(null);
    try {
      if (receipt) await decideStagePaymentReceipt(receipt.id, action, note, topUp,{stageAmount:scheduledAmount??payment!.amount*fxRate,decision:receipt.decision});
      else if (action === 'accept' && payment?.receiptPath && payment.receiptUploadedAt) {
        await confirmStagePayment(stageId, note, { path: payment.receiptPath, uploadedAt: payment.receiptUploadedAt });
      } else return;
      if (current.current === scope) { setDecisionForm(null); await onChanged(); }return true;
    } catch (error) {
      if (current.current === scope) { fail(errorText(error)); try { await onChanged(); } catch { /* Keep the requested action retryable. */ } }return false;
    } finally { if (pendingWork.current === scope) pendingWork.current = null; if (current.current === scope) setWorking(null); }
  }

  const confirm=confirmation?.scope===scope?confirmation:null;
  const reviewedReceipt=form?liveReceipts.find(receipt=>receipt.id===form.receipt):undefined;
  function review(receipt:StagePaymentReceipt|undefined,action:'accept'|'needs_top_up'|'flag',note?:string,topUp?:string){
    if(action==='needs_top_up'&&!canonicalReceiptAmount(topUp)){fail(t('project.stages.receiptAmountInvalid'));return;}
    if(action==='flag'&&!note?.trim()){fail(t('project.receiptFlow.reasonRequired'));return;}
    const money=format(receipt?.amount??payment?.receiptAmount??null,receipt?.currency??payment?.receiptCurrency??code);
    const projected=payment?stageReceiptBalance({...payment,receipts:payment.receipts?.map(item=>item.id===receipt?.id&&action!=='flag'?{...item,decision:'received' as const}:item)},code,fxRate,scheduledAmount):balance;
    const coverage=t('project.receiptFlow.coverageAfter',{received:format(projected?.received??null,code),remaining:format(projected?.remaining??null,code)});
    setConfirmation({scope,receiptId:receipt?.id,action,note,topUp,description:t('project.receiptFlow.confirmMoney',{amount:money})+'\n'+t('project.receiptFlow.schedule',{amount:format(scheduledAmount??payment!.amount*fxRate,code)})+'\n'+coverage+'\n'+t(action==='flag'?'project.receiptFlow.confirmMissing':action==='needs_top_up'?'project.receiptFlow.confirmAdditional':'project.receiptFlow.confirmContinue',{amount:format(topUp==null?null:Number(topUp),receipt?.currency??code)})+'\n'+t('project.receiptFlow.balanceStaysRecorded')});
  }
  async function confirmDecision(){if(!confirm)return;const saved=await decide(liveReceipts.find(receipt=>receipt.id===confirm.receiptId),confirm.action,confirm.note,confirm.topUp);if(saved&&current.current===scope)setConfirmation(null);}
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
  return <section className="mt-5 space-y-3 rounded-xl border border-brand-border-grey bg-brand-off-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]" aria-label={t('project.receiptFlow.title', { n: stageNumber })}>
    <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white"><Receipt className="size-4" aria-hidden />{t('project.receiptFlow.title', { n: stageNumber })}</h3>
    {workReviewed && <p className="text-xs text-brand-mid-grey">{t(isContractor ? 'project.receiptFlow.reviewedStagePaymentContractor' : readOnly ? 'project.receiptFlow.reviewedStagePaymentObserver' : 'project.receiptFlow.reviewedStagePayment')}</p>}
    <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.schedule', { amount: format(scheduledAmount ?? payment.amount * fxRate, code) })}</p>
    {currency?.pair?.(payment.amount, scheduledAmount)?.usd && <p className="font-mono text-xs text-brand-mid-grey">≈ {currency.pair(payment.amount, scheduledAmount)?.usd}</p>}
    {balance&&<p role="status" className="rounded-lg border border-brand-border-grey p-3 text-sm font-semibold">{t(balance.received===null?'project.receiptFlow.amountUnknown':balance.remaining===0?'project.receiptFlow.fullyPaid':balance.received>0?'project.receiptFlow.partiallyPaid':'project.receiptFlow.awaitingFunds')}{settled&&balance.remaining!==null&&balance.remaining>0&&<span className="mt-1 block text-xs font-normal">{t('project.receiptFlow.partialAuthorized')}</span>}</p>}
    {balance && <dl className="grid grid-cols-2 gap-3 text-xs">
      <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.receivedTotal')}</dt><dd className="mt-1 font-mono">{format(balance.received, code)}</dd></div>
      <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.remainingStageBudget')}</dt><dd className="mt-1 font-mono">{format(balance.remaining, code)}</dd></div>
      {(balance.pending == null || balance.pending > 0) && <div><dt className="text-brand-mid-grey">{t('project.receiptFlow.pendingTotal')}</dt><dd className="mt-1 font-mono">{format(balance.pending, code)}</dd></div>}
    </dl>}
    {!canUpload && !settled && <p className="text-xs text-brand-mid-grey">{blockedReason ?? t('project.receiptFlow.waitForUpdates')}</p>}
    {receipts.length > 0 && <ol className="divide-y divide-brand-border-grey dark:divide-[#333]">{receipts.map(receipt => <li key={receipt.id} className="py-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-mono font-semibold text-brand-near-black dark:text-white">{format(receipt.amount, receipt.currency)}</p>
        <span className={receipt.decision === 'received' ? 'text-state-complete' : 'text-brand-mid-grey'}>{t(receipt.replacedBy?'project.receiptFlow.replaced':receipt.decision === 'received' ? 'project.receiptFlow.received' : receipt.decision === 'flagged' ? 'project.receiptFlow.flagged' : 'project.receiptFlow.pending')}</span>
      </div>
      {receipt.amountUsd != null && receipt.currency !== 'USD' && <p className="mt-1 font-mono text-brand-mid-grey">≈ ${receipt.amountUsd.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })}</p>}
      {receipt.projectAmount != null && receipt.projectCurrency !== receipt.currency && <p className="mt-1 font-mono text-brand-mid-grey">{t('project.receiptFlow.projectEquivalent', { amount: format(receipt.projectAmount, receipt.projectCurrency ?? code) })}</p>}
      {receipt.fxSource === 'ExchangeRate-API' && <p className="mt-1 text-brand-mid-grey">{t('project.receiptFlow.savedRate', { rate: String(receipt.fxRate), currency: receipt.currency ?? '' })}{' · '}
        <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="underline">ExchangeRate-API</a>
        {receipt.fxAsOf && ` · ${new Date(receipt.fxAsOf).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}`}</p>}
      {receipt.decision==='pending'&&!receipt.replacedBy&&isContractor&&canUpload&&<button type="button" disabled={busy} onClick={()=>setDecisionForm({scope,receipt:receipt.id,decision:'accept',amount:'',note:'',step:'receipt'})} className="mt-2 ml-3 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white">{t('project.receiptFlow.reviewPayment')}</button>}
      {!isContractor&&!readOnly&&canUpload&&!receipt.replacedBy&&receipt.decision!=='received'&&<button type="button" disabled={busy} onClick={()=>correctReceipt(receipt)} className="mt-2 ml-3 rounded-lg border px-3 py-2 font-semibold">{t('project.receiptFlow.replaceReceipt')}</button>}
      {receipt.decisionNote && <p className="mt-1 whitespace-pre-wrap text-brand-mid-grey">{receipt.decisionNote}</p>}
      <button type="button" className="mt-2 font-semibold text-brand-green underline" onClick={() => { void openReceipt(receipt.path); }}>{t('project.stages.confirmView')}</button>
    </li>)}</ol>}
    {legacyPending && <div className="space-y-2 text-xs"><p className="font-mono">{format(payment.receiptAmount ?? null, payment.receiptCurrency ?? null)}</p>
      {payment.receiptAmountUsd != null && payment.receiptCurrency !== 'USD' && <p className="font-mono text-brand-mid-grey">≈ ${payment.receiptAmountUsd.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })}</p>}
      <button type="button" className="font-semibold text-brand-green underline" onClick={() => { void openReceipt(payment.receiptPath!); }}>{t('project.stages.confirmView')}</button></div>}
    {requested && !settled && <p className="text-xs text-brand-near-black dark:text-white">{t('project.receiptFlow.topUpRequested', { amount: format(requested.requestedTopUp, requested.currency) })}</p>}
    {isContractor ? <>
      {legacyPending&&<button type="button" disabled={!canUpload||busy} onClick={()=>review(undefined,'accept')} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.reviewPayment')}</button>}
      {!pending && requested && !settled && <button type="button" disabled={!canUpload || busy} onClick={() => setDecisionForm({scope,receipt:requested.id,decision:'accept',amount:'',note:'',step:'progress'})} className="rounded-lg bg-brand-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{t('project.receiptFlow.continueWithReceived')}</button>}
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
            <button type="button" disabled={busy} onClick={()=>setDecisionForm({...form,decision:'needs_top_up'})} className="rounded-lg border px-3 py-2 text-sm">{t('project.receiptFlow.requestTopUp')}</button></div></>}
          {(form.decision==='needs_top_up'||form.decision==='flag')&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();review(reviewedReceipt,form.decision as 'needs_top_up'|'flag',form.note,form.amount);}}>
            {form.decision==='needs_top_up'&&<label className="block text-xs">{t('project.receiptFlow.topUpAmount',{currency:reviewedReceipt?.currency??code})}<input inputMode="decimal" value={form.amount} disabled={busy} onChange={event=>setDecisionForm({...form,amount:normaliseBudgetInput(event.target.value,lang)})} className="mt-1 w-full rounded-lg border bg-transparent p-3"/></label>}
            <label className="block text-xs">{t(form.decision==='flag'?'project.receiptFlow.reason':'project.receiptFlow.note')}<textarea value={form.note} maxLength={2000} disabled={busy} onChange={event=>setDecisionForm({...form,note:event.target.value})} className="mt-1 w-full rounded-lg border bg-transparent p-3"/></label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white">{t('project.receiptFlow.reviewDecision')}</button>
          </form>}
        </>}
        <button type="button" disabled={busy} onClick={()=>setDecisionForm(null)} className="text-xs underline">{t('common.cancel')}</button>
      </div>}
      {canUpload && !pending && !legacyPending && !requested && !settled && <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.waitForReceipt')}</p>}
    </> : readOnly ? null : allowed && <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={!allowed || busy} className="space-y-3 disabled:opacity-40">
        {replacement?.scope===scope&&<p className="text-sm font-semibold">{t('project.receiptFlow.replacementHelp')}</p>}
        {pending&&<p role="status" className="text-sm">{t('project.receiptFlow.pendingMore')}</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('project.stages.receiptChoose')}>
          <button type="button" disabled={busy} onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white"><FileUp className="size-4" aria-hidden/>{t('project.receiptFlow.pickFile')}</button>
          <button type="button" disabled={busy} onClick={()=>cameraRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-brand-green px-4 py-3 text-sm font-semibold"><Camera className="size-4" aria-hidden/>{t('project.receiptFlow.takePhoto')}</button>
        </div>
        <label htmlFor={`receipt-currency-${stageId}`} className="block text-xs font-medium">{t('project.receiptFlow.currencyLabel')}</label>
        <select id={`receipt-currency-${stageId}`} name="receipt-currency" value={selectedCurrency}
          onChange={event => { setDraft({ ...activeDraft, currency: event.target.value }); setFailure(null); }}
          className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm dark:bg-[#141414]">
          {receiptCurrencyChoices(code).map(value => <option key={value} value={value}>{value}{value === code ? ` · ${t('project.receiptFlow.projectCurrency')}` : ''}</option>)}
        </select>
        <label htmlFor={`receipt-amount-${stageId}`} className="block text-xs font-medium">{t('project.stages.receiptAmountLabel', { currency: selectedCurrency })}</label>
        <input id={`receipt-amount-${stageId}`} name="receipt-amount" type="text" inputMode="decimal" autoComplete="off" value={activeDraft.amount}
          onChange={event => { const raw = event.target.value; setDraft({ ...activeDraft, amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); setFailure(null); }}
          className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 font-mono text-sm dark:bg-[#141414]" />
        <p className="text-xs text-brand-mid-grey">{t('project.receiptFlow.amountHint')}</p>
        {fileQueue.scope===scope&&fileQueue.files.length>0&&<p className="text-xs">{t('project.receiptFlow.additionalFiles',{count:fileQueue.files.length+1})}</p>}
        {activeDraft.file && <p className="break-all text-xs text-brand-mid-grey">{activeDraft.file.name}</p>}
        <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={!allowed || busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t(busy ? 'project.receiptFlow.checking' : 'project.stages.receiptChoose')}
        </button>
        {activeDraft.file && <button type="button" className="text-xs text-brand-green underline" onClick={() => setPicker(scope)}>{t('project.receiptFlow.changeFile')}</button>}
        <input ref={fileRef} type="file" multiple={replacement?.scope!==scope} accept={RECEIPT_ACCEPT} className="hidden" aria-label={t('project.receiptFlow.pickFile')} onChange={event => { const files=Array.from(event.target.files??[]);event.target.value='';return selectFile(files[0]??null,files.slice(1)); }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label={t('project.receiptFlow.takePhoto')} onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ''; return selectFile(file); }} />
      </fieldset>
    </form>}
    <ConfirmModal open={!!confirm} title={t('project.receiptFlow.confirmDecision')} description={confirm?.description??''} confirmLabel={t('project.receiptFlow.confirmFinal')} cancelLabel={t('common.cancel')} loading={busy} error={error} onConfirm={()=>void confirmDecision()} onCancel={()=>setConfirmation(null)}/>
    {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
    {viewer?.scope === scope && <DocumentViewer name={viewer.name} url={viewer.url} loading={!viewer.url} onClose={closeViewer} />}
  </section>;
}
