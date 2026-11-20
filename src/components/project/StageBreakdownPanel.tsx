import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  breakdownDraft, decideStageBreakdown, fetchStageBreakdown, proposeStageBreakdown,
  type BreakdownDraftRow, type BreakdownLine, type BreakdownProposal, type StageBreakdownContext,
} from '@/lib/supabase/stage-breakdown';

interface Props {
  stageId: string; stageName: string; projectName: string;
  clientPresentation?: boolean;
  isContractor?: boolean;
  hidden?: boolean;
  onChanged: () => void | Promise<void>;
}
type Review = { kind: 'submit' | 'approved' | 'declined' | 'withdrawn'; proposal?: BreakdownProposal; hash: string };

/**
 * A stage's price, split across its sub-stages (18 November).
 *
 * Structure & Walls was one payment for the whole wall. The contractor can now propose
 * what each part of the stage costs, and add parts the plan did not have (a fence while
 * the permit is pending, another floor's slab). The parts always add up to the stage
 * price. Nothing changes until the client approves, and every proposal stays listed.
 *
 * Quiet by default: a stage nobody has split shows only the contractor's button.
 */
export function StageBreakdownPanel({ stageId, stageName, projectName, clientPresentation = false, isContractor = false, hidden = false, onChanged }: Props) {
  const t = useT(); const { lang } = useLanguage(); const { substageLabel } = useStageLabels();
  const [read, setRead] = useState<{ stage: string; context: StageBreakdownContext } | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<{ stage: string; rows: BreakdownDraftRow[]; note: string } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
  const current = useRef(stageId); current.current = stageId;
  const turn = useRef(0); const busy = useRef(false);

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
  const editing = draft?.stage === stageId ? draft : null;
  const format = (amount: string | null | undefined) => amount == null ? '—'
    : `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 }).format(Number(amount))} ${context?.currency ?? ''}`;
  const label = (row: { name: string; key?: string | null }) => substageLabel({ name: row.name, substage_key: row.key ?? null });
  const pending = context?.history.find(item => item.status === 'pending');
  const latest = context?.history.find(item => item.status !== 'pending');
  const preview = editing && context ? breakdownDraft(context.stage_amount, editing.rows) : null;

  if (hidden) return null;
  if (failed && !context) return null;
  if (!context) return null;
  const lockedForContractor = isContractor && !context.editable && !context.can_propose && !pending;
  // Nothing to show: no split, nothing proposed, not locked-for-contractor, and this person cannot propose one.
  if (!context.split && !pending && !context.can_propose && !lockedForContractor && !context.history.length) return null;

  function start() {
    if (!context) return;
    setDraft({ stage: stageId, note: '', rows: context.substages.map(sub => ({ substageId: sub.id, name: label(sub), amount: sub.amount ?? '' })) });
    setError(null);
  }
  function edit(index: number, patch: Partial<BreakdownDraftRow>) {
    if (!editing) return;
    setDraft({ ...editing, rows: editing.rows.map((row, i) => i === index ? { ...row, ...patch } : row) });
  }
  async function commit() {
    if (!review || !context || busy.current) return;
    if (review.hash !== context.base_hash) { setError(t('project.breakdown.stale')); return; }
    busy.current = true; setWorking(true); setError(null);
    try {
      if (review.kind === 'submit') {
        if (!preview?.lines || !editing) return;
        await proposeStageBreakdown(context, preview.lines, editing.note);
      } else await decideStageBreakdown(review.proposal!.id, review.kind);
      if (current.current !== stageId) return;
      setReview(null); setDraft(null);
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
    <h4 className="font-semibold">{t('project.breakdown.title')}</h4>

    {/* The approved split. */}
    {context.split && !editing && <ul className="space-y-1.5">{context.substages.map(sub =>
      <li key={sub.id} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{label(sub)}</span><span className="font-mono">{format(sub.amount)}</span></li>)}
      <li className="flex flex-wrap justify-between gap-2 border-t border-brand-border-grey pt-1.5 font-semibold"><span>{t('project.breakdown.stageTotal')}</span><span className="font-mono">{format(context.stage_amount)}</span></li>
    </ul>}
    {!context.split && !pending && !editing && context.can_propose && <p className="text-brand-mid-grey">{t('project.breakdown.hintContractor', { amount: format(context.stage_amount) })}</p>}

    {context.can_propose && !pending && !editing && <button type="button" onClick={start} data-action="split-stage"
      className="inline-flex items-center rounded-lg border border-brand-green/40 bg-brand-green/5 px-3 py-1.5 font-semibold text-brand-green hover:bg-brand-green/10 dark:text-[#b4d8bf]">
      {t(context.split ? 'project.breakdown.revise' : 'project.breakdown.propose')}</button>}
    {lockedForContractor && !editing && <div className="space-y-1" data-split-locked>
      <button type="button" disabled title={t('project.breakdown.lockedAfterWork')}
        className="inline-flex cursor-not-allowed items-center rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-1.5 font-semibold text-brand-mid-grey opacity-60 dark:border-[#2c2c2c] dark:bg-[#141414]">
        {t(context.split ? 'project.breakdown.revise' : 'project.breakdown.propose')}</button>
      <p className="text-brand-mid-grey">{t('project.breakdown.lockedAfterWork')}</p>
    </div>}

    {/* The contractor's draft. */}
    {editing && preview && <form className="space-y-3" data-breakdown-form onSubmit={event => { event.preventDefault(); if (preview.ready) setReview({ kind: 'submit', hash: context.base_hash }); }}>
      <fieldset disabled={working} className="space-y-2">
        {editing.rows.map((row, index) => <div key={row.substageId ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
          {row.substageId
            ? <span className="min-w-0 flex-1 break-words">{row.name}</span>
            : <input aria-label={t('project.breakdown.newPartName')} placeholder={t('project.breakdown.newPartName')} value={row.name} maxLength={120}
                onChange={event => edit(index, { name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white p-2 dark:bg-[#141414]" />}
          <input inputMode="decimal" aria-label={t('project.breakdown.amountFor', { part: row.name || t('project.breakdown.newPart'), currency: context.currency })} value={row.amount}
            onChange={event => { const raw = event.target.value; edit(index, { amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw }); }}
            className="w-36 rounded-lg border border-brand-border-grey bg-white p-2 font-mono dark:bg-[#141414]" />
          {!row.substageId && <button type="button" aria-label={t('project.breakdown.removePart')} onClick={() => setDraft({ ...editing, rows: editing.rows.filter((_, i) => i !== index) })} className="p-1 text-brand-mid-grey"><X className="size-4" aria-hidden /></button>}
        </div>)}
        <button type="button" onClick={() => setDraft({ ...editing, rows: [...editing.rows, { name: '', amount: '' }] })} className="inline-flex items-center gap-1 font-semibold text-brand-green dark:text-[#b4d8bf]">
          <Plus className="size-3.5" aria-hidden />{t('project.breakdown.addPart')}</button>
        <p role="status" className={Number(preview.remaining) === 0 ? 'text-brand-green' : 'text-brand-near-black dark:text-white'}>
          {t('project.breakdown.allocated', { allocated: format(preview.allocated), total: format(context.stage_amount) })}{' '}
          {Number(preview.remaining) !== 0 && t(Number(preview.remaining) > 0 ? 'project.breakdown.left' : 'project.breakdown.over', { amount: format(preview.remaining.replace('-', '')) })}
        </p>
        <label className="block">{t('project.breakdown.note')}
          <textarea value={editing.note} maxLength={2000} onChange={event => setDraft({ ...editing, note: event.target.value })} className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-2 dark:bg-[#141414]" /></label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!preview.ready} className="rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-40">{t('project.breakdown.send')}</button>
          <button type="button" onClick={() => { setDraft(null); setError(null); }} className="px-2 py-2 text-brand-mid-grey underline underline-offset-4">{t('common.cancel')}</button>
        </div>
      </fieldset>
    </form>}

    {/* A proposal waiting for the client. */}
    {pending && !editing && <div className="space-y-2 rounded-lg border border-brand-green/40 p-3" data-breakdown-pending>
      <p role="status" className="font-semibold">{t(context.can_decide ? 'project.breakdown.awaitingYou' : 'project.breakdown.awaitingClient')}</p>
      {lineList(pending.lines)}
      {pending.note && <p className="whitespace-pre-wrap text-brand-mid-grey">{pending.note}</p>}
      {pending.stale && <p className="text-brand-mid-grey">{t('project.breakdown.stale')}</p>}
      <div className="flex flex-wrap gap-2">
        {context.can_decide && <>
          <button type="button" disabled={working || pending.stale} onClick={() => setReview({ kind: 'approved', proposal: pending, hash: context.base_hash })}
            className="rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-40">{t('project.breakdown.approve')}</button>
          <button type="button" disabled={working} onClick={() => setReview({ kind: 'declined', proposal: pending, hash: context.base_hash })}
            className="rounded-lg border border-brand-border-grey px-3 py-2">{t('project.breakdown.keep')}</button>
        </>}
        {pending.can_withdraw && <button type="button" disabled={working} onClick={() => setReview({ kind: 'withdrawn', proposal: pending, hash: context.base_hash })}
          className="rounded-lg border border-brand-border-grey px-3 py-2">{t('project.breakdown.withdraw')}</button>}
      </div>
    </div>}
    {context.can_propose && !pending && latest && latest.status !== 'withdrawn' && !editing && <p role="status" className="text-brand-mid-grey">
      {t(latest.status === 'approved' ? 'project.breakdown.lastApproved' : 'project.breakdown.lastDeclined')}</p>}

    {/* Every earlier proposal, for the record. */}
    {context.history.some(item => item.status !== 'pending') && <details>
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
        : review?.kind === 'declined' ? 'project.breakdown.confirmKeepBody' : 'project.breakdown.confirmWithdrawBody', { total: format(context.stage_amount) })}
      confirmLabel={t(review?.kind === 'approved' ? 'project.clientUi.confirmApproval' : 'project.breakdown.confirm')} cancelLabel={t('common.cancel')}
      loading={working} error={error} onConfirm={commit} onCancel={() => { if (!busy.current) setReview(null); }}>
      {review?.kind === 'submit' && preview?.lines && editing && lineList(editing.rows.map(row => ({
        substage_id: row.substageId, name: row.name, before: context.substages.find(sub => sub.id === row.substageId)?.amount ?? null, amount: row.amount.trim(),
      })))}
      {review?.proposal && review.kind !== 'withdrawn' && lineList(review.proposal.lines)}
    </ConfirmModal>
  </section>;
}
