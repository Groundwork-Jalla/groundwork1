import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, Plus, Split, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { supabase } from '@/lib/supabase/client';
import { sendMessage } from '@/lib/supabase/messages';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  breakdownDraft, decideStageBreakdown, fetchStageBreakdown, proposeStageBreakdown, splitBreakdownEvenly,
  type BreakdownDraftRow, type BreakdownLine, type BreakdownProposal, type StageBreakdownContext,
} from '@/lib/supabase/stage-breakdown';

export interface StageBreakdownInlineState {
  stageId: string;
  currency: string;
  stageAmount: string;
  split: boolean;
  canPropose: boolean;
  canDecide: boolean;
  lockedForContractor: boolean;
  editing: boolean;
  working: boolean;
  rows: BreakdownDraftRow[];
  pending: BreakdownProposal | null;
  lastDeclined: BreakdownProposal | null;
  format: (amount: string | null | undefined) => string;
  startEditing: (addBlankPart?: boolean) => void;
  editRow: (index: number, patch: Partial<BreakdownDraftRow>) => void;
  addRow: () => void;
  removeRow: (index: number) => void;
  splitEvenly: () => void;
  cancelEditing: () => void;
}

interface Props {
  stageId: string; stageName: string; projectName: string;
  clientPresentation?: boolean;
  isContractor?: boolean;
  hidden?: boolean;
  /** When true, the parent renders substage rows & inline inputs inside its own substage list,
   *  so this panel only renders the compact summary/controls, approval bar, history & modal. */
  inlineRows?: boolean;
  /** Publishes live breakdown state & editing actions up to the parent's unified substage list. */
  onInlineState?: (state: StageBreakdownInlineState | null) => void;
  /** Increment to open the breakdown editor pre-seeded with a new blank substage row. */
  openAddPartSignal?: number;
  /** Optional shortcut to jump straight into Project Messages to negotiate pricing. */
  onDiscussPrice?: () => void;
  onChanged: () => void | Promise<void>;
}
type Review = { kind: 'submit' | 'approved' | 'declined' | 'withdrawn'; proposal?: BreakdownProposal; hash: string };

/**
 * A stage's price, split across its sub-stages (18 November; inline per-substage mode 23 November).
 *
 * The contractor proposes what each substage costs, and can add extra substages. The parts
 * always add up to the stage price. Nothing changes until the Homeowner approves, and every
 * proposal stays listed.
 *
 * Strictly role-separated:
 * - Contractor (`isContractor = true`): Set/Edit prices, Split evenly, Add substage, Send, Withdraw.
 * - Homeowner (`isContractor = false`): Read-only inline prices, Approve / Keep current on pending proposals.
 */
export function StageBreakdownPanel({
  stageId, stageName, projectName, clientPresentation = false, isContractor = false, hidden = false,
  inlineRows = false, onInlineState, openAddPartSignal = 0, onDiscussPrice, onChanged,
}: Props) {
  const { user } = useAuth();
  const t = useT(); const { lang } = useLanguage(); const { substageLabel } = useStageLabels();
  const [read, setRead] = useState<{ stage: string; context: StageBreakdownContext } | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<{ stage: string; rows: BreakdownDraftRow[]; note: string } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
  const current = useRef(stageId); current.current = stageId;
  const turn = useRef(0); const busy = useRef(false);
  const onInlineStateRef = useRef(onInlineState);
  onInlineStateRef.current = onInlineState;

  const load = useCallback(async () => {
    const request = ++turn.current;
    try {
      const context = await fetchStageBreakdown(stageId);
      if (current.current === stageId && turn.current === request) { setRead({ stage: stageId, context }); setFailed(false); }
    } catch { if (current.current === stageId && turn.current === request) setFailed(true); }
  }, [stageId]);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    const channel = supabase.channel(`stage-breakdown-${stageId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_breakdown_proposals', filter: `stage_id=eq.${stageId}` }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    return () => { ++turn.current; window.removeEventListener('focus', refresh); void supabase.removeChannel(channel); };
  }, [load, stageId]);

  const context = read?.stage === stageId ? read.context : null;
  const editing = isContractor && draft?.stage === stageId ? draft : null;
  const format = useCallback((amount: string | null | undefined) => amount == null ? '—'
    : `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 }).format(Number(amount))} ${context?.currency ?? ''}`, [lang, context?.currency]);
  const label = useCallback((row: { name: string; key?: string | null }) => substageLabel({ name: row.name, substage_key: row.key ?? null }), [substageLabel]);
  const pending = context?.history.find(item => item.status === 'pending') ?? null;
  const latest = context?.history.find(item => item.status !== 'pending') ?? null;
  const lastDeclined = !pending && latest?.status === 'declined' ? latest : null;
  const preview = editing && context ? breakdownDraft(context.stage_amount, editing.rows) : null;
  const lockedForContractor = !!context && isContractor && !context.editable && !context.can_propose && !pending;

  const startEditing = useCallback((addBlankPart = false) => {
    if (!context || !isContractor || !context.can_propose || pending) return;
    setDraft(prev => {
      const baseRows = prev && prev.stage === stageId
        ? prev.rows
        : context.substages.map(sub => ({ substageId: sub.id, name: label(sub), amount: sub.amount ?? '' }));
      const nextRows = addBlankPart && !baseRows.some(r => !r.substageId && !r.name.trim())
        ? [...baseRows, { name: '', amount: '' }]
        : baseRows;
      return { stage: stageId, note: prev && prev.stage === stageId ? prev.note : '', rows: nextRows };
    });
    setError(null);
  }, [context, isContractor, pending, stageId, label]);

  const editRow = useCallback((index: number, patch: Partial<BreakdownDraftRow>) => {
    setDraft(prev => {
      if (!prev || prev.stage !== stageId) return prev;
      return { ...prev, rows: prev.rows.map((row, i) => i === index ? { ...row, ...patch } : row) };
    });
  }, [stageId]);

  const addRow = useCallback(() => {
    setDraft(prev => {
      if (!prev || prev.stage !== stageId) return prev;
      return { ...prev, rows: [...prev.rows, { name: '', amount: '' }] };
    });
  }, [stageId]);

  const removeRow = useCallback((index: number) => {
    setDraft(prev => {
      if (!prev || prev.stage !== stageId) return prev;
      return { ...prev, rows: prev.rows.filter((_, i) => i !== index) };
    });
  }, [stageId]);

  const splitEvenly = useCallback(() => {
    if (!context) return;
    setDraft(prev => {
      if (!prev || prev.stage !== stageId) return prev;
      return { ...prev, rows: splitBreakdownEvenly(context.stage_amount, prev.rows) };
    });
    setError(null);
  }, [context, stageId]);

  const cancelEditing = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  const lastAddSignal = useRef(openAddPartSignal);
  useEffect(() => {
    if (openAddPartSignal <= lastAddSignal.current) return;
    lastAddSignal.current = openAddPartSignal;
    startEditing(true);
  }, [openAddPartSignal, startEditing]);

  // Publish live inline controller to the parent's unified substage list.
  const inlineState = useMemo<StageBreakdownInlineState | null>(() => {
    if (hidden || !context) return null;
    return {
      stageId,
      currency: context.currency,
      stageAmount: context.stage_amount,
      split: context.split,
      canPropose: isContractor && context.can_propose,
      canDecide: !isContractor && context.can_decide,
      lockedForContractor,
      editing: !!editing,
      working,
      rows: editing ? editing.rows : [],
      pending,
      lastDeclined,
      format,
      startEditing,
      editRow,
      addRow,
      removeRow,
      splitEvenly,
      cancelEditing,
    };
  }, [
    hidden, context, stageId, isContractor, lockedForContractor, editing, working, pending, lastDeclined,
    format, startEditing, editRow, addRow, removeRow, splitEvenly, cancelEditing,
  ]);

  useEffect(() => {
    onInlineStateRef.current?.(inlineState);
  }, [inlineState]);

  useEffect(() => () => { onInlineStateRef.current?.(null); }, []);

  if (hidden) return null;
  if (failed && !context) return null;
  if (!context) return null;
  const hasHistory = context.history.some(item => item.status !== 'pending');
  // Nothing to show: no split, nothing proposed, not locked-for-contractor, and this person cannot propose one.
  if (!context.split && !pending && !(isContractor && context.can_propose) && !lockedForContractor && !context.history.length) return null;

  // In inlineRows mode, the bottom "Split by parts" card is completely hidden at rest —
  // approved prices live directly on each substage row, and Set/Edit/Locked price controls
  // live in the stage header above the list. This footer only renders when actively editing,
  // reviewing a pending proposal, showing a decision/error, or expanding past history.
  const showLastDecision = isContractor && context.can_propose && !pending && latest && latest.status !== 'withdrawn' && !editing && !(inlineRows && latest.status === 'declined');
  if (inlineRows && !editing && !pending && !showLastDecision && !hasHistory && !error && !review) {
    return null;
  }

  async function commit() {
    if (!review || !context || busy.current) return;
    if (review.hash !== context.base_hash) { setError(t('project.breakdown.stale')); return; }
    if (review.kind === 'submit' && (!preview?.lines || !editing || !editing.note.trim())) return;
    if (review.kind === 'declined' && !declineReason.trim()) return;
    busy.current = true; setWorking(true); setError(null);
    try {
      if (review.kind === 'submit') {
        await proposeStageBreakdown(context, preview!.lines!, editing!.note);
      } else {
        await decideStageBreakdown(review.proposal!.id, review.kind);
        if (review.kind === 'declined' && user?.id) {
          const reasonText = declineReason.trim();
          const senderName = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || 'Homeowner';
          const chatMessage = `${t('project.breakdown.declineMessagePrefix', { stage: stageName })}\n${reasonText}`;
          await sendMessage(context.project_id, user.id, senderName, chatMessage).catch(() => {});
        }
      }
      if (current.current !== stageId) return;
      setReview(null); setDraft(null); setDeclineReason('');
      await load(); await onChanged();
    } catch (failure) {
      if (current.current !== stageId) return;
      const message = (failure as { message?: string })?.message ?? '';
      setError(t(/stale_stage_breakdown|stage_breakdown_locked|proposer_assignment_changed/.test(message) ? 'project.breakdown.stale'
        : /breakdown_proposal_pending/.test(message) ? 'project.breakdown.pendingExists'
        : /breakdown_total_mismatch|breakdown_incomplete/.test(message) ? 'project.breakdown.mustAddUp' : 'project.breakdown.failed'));
      await load();
    } finally { busy.current = false; if (current.current === stageId) setWorking(false); }
  }

  const lineList = (lines: BreakdownLine[]) => <ul className="space-y-1.5">{lines.map((line, index) =>
    <li key={line.substage_id ?? `new-${index}`} className="flex flex-wrap justify-between gap-2 rounded-lg border border-brand-border-grey bg-white px-3 py-2 dark:bg-[#141414]">
      <span className="min-w-0 break-words">{label(line)}{!line.substage_id && <span className="ml-2 rounded-full bg-brand-off-white px-2 py-0.5 text-[11px] font-semibold text-brand-green">{t('project.breakdown.newPart')}</span>}</span>
      <span className="font-mono">{line.before != null && line.before !== line.amount ? `${format(line.before)} → ` : ''}<b>{format(line.amount)}</b></span>
    </li>)}</ul>;

  const box = `space-y-3 rounded-xl border border-brand-border-grey p-3 text-xs ${clientPresentation ? 'mt-4 bg-brand-off-white sm:p-4' : 'mt-3'}`;
  return <section className={box} aria-label={t('project.breakdown.title')} data-stage-breakdown>
    {!inlineRows && <h4 className="font-semibold">{t('project.breakdown.title')}</h4>}

    {/* Standalone fallback list (used only when substages aren't shown inline, e.g. locked stages). */}
    {!inlineRows && context.split && !editing && <ul className="space-y-1.5">{context.substages.map(sub =>
      <li key={sub.id} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{label(sub)}</span><span className="font-mono">{format(sub.amount)}</span></li>)}
      <li className="flex flex-wrap justify-between gap-2 border-t border-brand-border-grey pt-1.5 font-semibold"><span>{t('project.breakdown.stageTotal')}</span><span className="font-mono">{format(context.stage_amount)}</span></li>
    </ul>}
    {!inlineRows && isContractor && !context.split && !pending && !editing && context.can_propose && (
      <p className="text-brand-mid-grey">{t('project.breakdown.hintContractor', { amount: format(context.stage_amount) })}</p>
    )}

    {!inlineRows && isContractor && context.can_propose && !pending && !editing && <button type="button" onClick={() => startEditing(false)} data-action="split-stage"
      className="inline-flex items-center rounded-lg border border-brand-green/40 bg-brand-green/5 px-3 py-1.5 font-semibold text-brand-green hover:bg-brand-green/10 dark:text-[#b4d8bf]">
      {t(context.split ? 'project.breakdown.revise' : 'project.breakdown.propose')}</button>}

    {!inlineRows && lockedForContractor && !editing && <div className="space-y-1" data-split-locked>
      <button type="button" disabled title={t('project.breakdown.lockedAfterWork')}
        className="inline-flex cursor-not-allowed items-center rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-1.5 font-semibold text-brand-mid-grey opacity-60 dark:border-[#2c2c2c] dark:bg-[#141414]">
        {t(context.split ? 'project.breakdown.revise' : 'project.breakdown.propose')}</button>
      <p className="text-brand-mid-grey">{t('project.breakdown.lockedAfterWork')}</p>
    </div>}

    {/* Contractor's draft controls — strictly contractor-only. */}
    {isContractor && editing && preview && (() => {
      const missingPrice = editing.rows.some(r => !r.amount.trim());
      const noteReady = editing.note.trim().length > 0;
      const canSubmit = preview.ready && noteReady;
      const flexible = preview.flexibleTotal;
      return <form className="space-y-3" data-breakdown-form onSubmit={event => { event.preventDefault(); if (canSubmit) setReview({ kind: 'submit', hash: context.base_hash }); }}>
        <fieldset disabled={working} className="space-y-2.5">
          {inlineRows ? (
            <p className="text-brand-mid-grey">
              {flexible
                ? (lang === 'fr'
                  ? 'Entrez le coût de chaque sous-étape ci-dessus. Leur somme définira le prix total de cette étape.'
                  : 'Enter the cost of each substage above. Their total will set the price for this stage.')
                : t('project.breakdown.inlineEditingHint', { total: format(context.stage_amount) })}
            </p>
          ) : (
            editing.rows.map((row, index) => <div key={row.substageId ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
              {row.substageId
                ? <span className="min-w-0 flex-1 break-words">{row.name}</span>
                : <input required aria-label={t('project.breakdown.newPartName')} placeholder={t('project.breakdown.newPartName')} value={row.name} maxLength={120}
                    onChange={event => editRow(index, { name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white p-2 dark:bg-[#141414]" />}
              <input required inputMode="decimal" placeholder={t('project.breakdown.amountPlaceholder')} aria-label={t('project.breakdown.amountFor', { part: row.name || t('project.breakdown.newPart'), currency: context.currency })} value={row.amount}
                onChange={event => { const raw = event.target.value; editRow(index, { amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); }}
                className="w-36 rounded-lg border border-brand-border-grey bg-white p-2 font-mono dark:bg-[#141414]" />
              {!row.substageId && <button type="button" aria-label={t('project.breakdown.removePart')} onClick={() => removeRow(index)} className="p-1 text-brand-mid-grey"><X className="size-4" aria-hidden /></button>}
            </div>)
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={addRow} data-action="breakdown-add-part"
                className="inline-flex items-center gap-1 font-semibold text-brand-green hover:underline dark:text-[#b4d8bf]">
                <Plus className="size-3.5" aria-hidden />{t('project.breakdown.addPart')}
              </button>
              {!flexible && (
                <button type="button" onClick={splitEvenly} data-action="breakdown-split-evenly"
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-green/40 bg-brand-green/5 px-2.5 py-1 font-semibold text-brand-green hover:bg-brand-green/10 dark:text-[#b4d8bf]">
                  <Split className="size-3.5" aria-hidden />{t('project.breakdown.splitEvenly')}
                </button>
              )}
            </div>
            <p role="status" className={preview.ready ? 'font-semibold text-brand-green' : 'font-medium text-brand-near-black dark:text-white'}>
              {flexible
                ? (lang === 'fr'
                  ? `Total proposé pour l’étape : ${format(preview.allocated)}`
                  : `Proposed stage total: ${format(preview.allocated)}`)
                : <>
                    {t('project.breakdown.allocated', { allocated: format(preview.allocated), total: format(context.stage_amount) })}{' '}
                    {Number(preview.remaining) !== 0 && t(Number(preview.remaining) > 0 ? 'project.breakdown.left' : 'project.breakdown.over', { amount: format(preview.remaining.replace('-', '')) })}
                  </>}
            </p>
          </div>
          {missingPrice && (
            <p className="text-[11.5px] text-state-held">
              {flexible
                ? (lang === 'fr'
                  ? 'Indiquez un montant (0 ou plus) pour chaque sous-étape afin que le total soit supérieur à 0.'
                  : 'Enter an amount (0 or more) for every substage so the stage total is greater than 0.')
                : t('project.breakdown.pricesRequiredHint', { total: format(context.stage_amount) })}
            </p>
          )}

          <label className="block font-medium text-brand-near-black dark:text-white">
            {t('project.breakdown.note')} <span className="text-state-alert" aria-hidden>*</span>
            <textarea
              required
              value={editing.note}
              maxLength={2000}
              rows={2}
              placeholder={t('project.breakdown.notePlaceholder')}
              onChange={event => setDraft({ ...editing, note: event.target.value })}
              className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-2 font-normal text-brand-near-black outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
            />
          </label>
          {preview.ready && !noteReady && <p className="text-[11.5px] text-brand-mid-grey">{t('project.breakdown.reasonRequired')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!canSubmit} className="rounded-lg bg-brand-green px-3.5 py-2 font-semibold text-white hover:bg-brand-green-hover disabled:opacity-40">{t('project.breakdown.send')}</button>
            <button type="button" onClick={cancelEditing} className="px-2 py-2 text-brand-mid-grey underline underline-offset-4">{t('common.cancel')}</button>
          </div>
        </fieldset>
      </form>;
    })()}

    {/* A proposal waiting for the Homeowner — role-separated actions. */}
    {pending && !editing && <div className="space-y-2 rounded-lg border border-brand-green/40 bg-brand-green/[0.03] p-3" data-breakdown-pending>
      <p role="status" className="font-semibold text-brand-near-black dark:text-white">
        {t(!isContractor && context.can_decide ? 'project.breakdown.awaitingYou' : 'project.breakdown.awaitingClient')}
      </p>
      {inlineRows
        ? <p className="text-brand-mid-grey">{t('project.breakdown.inlinePendingHint')}</p>
        : lineList(pending.lines)}
      {pending.note && <p className="whitespace-pre-wrap text-brand-mid-grey">{pending.note}</p>}
      {pending.stale && <p className="text-brand-mid-grey">{t('project.breakdown.stale')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!isContractor && context.can_decide && <>
          <button type="button" disabled={working || pending.stale} onClick={() => setReview({ kind: 'approved', proposal: pending, hash: context.base_hash })}
            className="rounded-lg bg-brand-green px-3.5 py-2 font-semibold text-white hover:bg-brand-green-hover disabled:opacity-40">{t('project.breakdown.approve')}</button>
          <button type="button" disabled={working} onClick={() => { setDeclineReason(''); setReview({ kind: 'declined', proposal: pending, hash: context.base_hash }); }}
            className="rounded-lg border border-brand-border-grey bg-white px-3.5 py-2 font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">{t('project.breakdown.keep')}</button>
          {onDiscussPrice && (
            <button
              type="button"
              data-action="discuss-breakdown-price"
              onClick={onDiscussPrice}
              title={t('project.breakdown.discussPrice')}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-green/40 bg-white px-3 py-2 font-semibold text-brand-green transition-colors hover:bg-brand-green/5 dark:bg-[#1e1e1e] dark:text-[#5eead4]"
            >
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              {t('project.breakdown.discussPrice')}
            </button>
          )}
        </>}
        {isContractor && pending.can_withdraw && <button type="button" disabled={working} onClick={() => setReview({ kind: 'withdrawn', proposal: pending, hash: context.base_hash })}
          className="rounded-lg border border-brand-border-grey bg-white px-3.5 py-2 font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">{t('project.breakdown.withdraw')}</button>}
      </div>
    </div>}

    {showLastDecision && latest && <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-brand-mid-grey">
      <span>{t(latest.status === 'approved' ? 'project.breakdown.lastApproved' : 'project.breakdown.lastDeclined')}</span>
      {latest.status === 'declined' && onDiscussPrice && (
        <button
          type="button"
          data-action="see-decline-reason"
          onClick={onDiscussPrice}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 font-semibold text-white hover:bg-brand-green-hover"
        >
          <MessageSquare className="size-3.5 shrink-0" aria-hidden />
          {t('project.breakdown.seeReason')}
        </button>
      )}
    </div>}

    {/* Every earlier proposal, for the record. */}
    {hasHistory && <details>
      <summary className="cursor-pointer text-brand-mid-grey">{t('project.breakdown.history')}</summary>
      <ol className="mt-2 space-y-3">{context.history.filter(item => item.status !== 'pending').map(item => <li key={item.id} className="space-y-1.5">
        <p className="font-semibold">{t(`project.breakdown.status.${item.status}` as TKey)} · <span className="font-normal text-brand-mid-grey">{new Date(item.decided_at ?? item.proposed_at).toLocaleString(lang)}</span></p>
        {lineList(item.lines)}
      </li>)}</ol>
    </details>}

    {error && <p role="alert" className="text-state-alert">{error}</p>}

    <ConfirmModal open={!!review} variant={review?.kind === 'approved' || review?.kind === 'declined' ? 'client' : 'default'}
      eyebrow={`${projectName} · ${stageName}`}
      title={t(review?.kind === 'submit' ? 'project.breakdown.confirmSendTitle' : review?.kind === 'approved' ? 'project.breakdown.confirmApproveTitle'
        : review?.kind === 'declined' ? 'project.breakdown.confirmKeepTitle' : 'project.breakdown.confirmWithdrawTitle')}
      description={t(review?.kind === 'submit' ? 'project.breakdown.confirmSendBody' : review?.kind === 'approved' ? 'project.breakdown.confirmApproveBody'
        : review?.kind === 'declined' ? 'project.breakdown.confirmKeepBody' : 'project.breakdown.confirmWithdrawBody', {
          total: format(
            review?.kind === 'submit' && preview?.flexibleTotal
              ? preview.allocated
              : review?.proposal?.stage_amount ?? context.stage_amount,
          ),
        })}
      confirmLabel={t(review?.kind === 'approved' ? 'project.clientUi.confirmApproval' : 'project.breakdown.confirm')} cancelLabel={t('common.cancel')}
      loading={working} confirmDisabled={review?.kind === 'declined' && !declineReason.trim()} error={error} onConfirm={commit} onCancel={() => { if (!busy.current) { setReview(null); setDeclineReason(''); } }}>
      {review?.kind === 'submit' && preview?.lines && editing && lineList(editing.rows.map(row => ({
        substage_id: row.substageId, name: row.name, before: context.substages.find(sub => sub.id === row.substageId)?.amount ?? null, amount: row.amount.trim(),
      })))}
      {review?.proposal && review.kind !== 'withdrawn' && lineList(review.proposal.lines)}
      {review?.kind === 'declined' && (
        <div className="space-y-1.5 pt-1" data-decline-reason-box>
          <label className="block text-sm font-semibold text-brand-near-black">
            {t('project.breakdown.declineReasonLabel')} <span className="text-state-alert" aria-hidden>*</span>
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={declineReason}
              disabled={working}
              placeholder={t('project.breakdown.declineReasonPlaceholder')}
              onChange={event => setDeclineReason(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-brand-border-grey bg-white p-3 text-sm font-normal text-brand-near-black outline-none focus:border-brand-green"
            />
          </label>
          <p className="text-xs text-brand-mid-grey">{t('project.breakdown.declineReasonRequired')}</p>
        </div>
      )}
    </ConfirmModal>
  </section>;
}
