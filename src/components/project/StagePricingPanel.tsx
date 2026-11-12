import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { supabase } from '@/lib/supabase/client';
import { fetchStagePriceContext, stagePricePreview, proposeStagePrices, decideStagePrices, type StagePriceContext } from '@/lib/supabase/stage-pricing';
import type { ProjectRow } from '@/types/project';

/** The same proposal, approval and saved history in both participants' project views. */
export function StagePricingPanel({ project, onChanged }: { project: ProjectRow; onChanged: () => void | Promise<void> }) {
  const t = useT(); const { lang } = useLanguage(); const { stageLabel } = useStageLabels();
  const [loaded, setLoaded] = useState<{ scope: string; context: StagePriceContext } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [draft, setDraft] = useState<{ scope: string; context: StagePriceContext; amounts: Record<string, string>; note: string } | null>(null);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false); const request = useRef(0);
  const scope = useRef<string | null>(project.id); scope.current = project.id;
  const context = loaded?.scope === project.id ? loaded.context : null;
  const editing = draft?.scope === project.id ? draft : null;
  const error = failure?.scope === project.id ? failure.message : null;
  const fail = (message: string) => setFailure({ scope: project.id, message });
  const format = (amount: string | number, currency: string) => `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 6 }).format(Number(amount))} ${currency}`;
  const load = useCallback(async () => {
    const turn = ++request.current;
    try {
      const value = await fetchStagePriceContext(project.id);
      if (scope.current === project.id && request.current === turn) { setLoaded({ scope: project.id, context: value }); setFailure(null); }
    } catch (error) {
      if (scope.current !== project.id || request.current !== turn) return;
      const message = (error as { message?: string })?.message ?? '';
      fail(t(/pricing_not_started|bill_confirmation_required/.test(message) ? 'project.priceChanges.notStarted' : 'project.priceChanges.loadFailed'));
    }
  }, [project.id, t]);
  useEffect(() => {
    scope.current = project.id; void load();
    const refresh = () => { void load(); };
    const channel = supabase.channel(`stage-prices-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_price_amendments', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stages', filter: `project_id=eq.${project.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `project_id=eq.${project.id}` }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    return () => { scope.current = null; ++request.current; window.removeEventListener('focus', refresh); void supabase.removeChannel(channel); };
  }, [load]);
  useEffect(() => { void load(); }, [project.pricing_revision]);

  async function mutate(action: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null);
    try {
      await action();
      if (scope.current === project.id) { setDraft(null); await onChanged(); await load(); }
    } catch (error) {
      if (scope.current === project.id) {
        await load();
        const message = (error as { message?: string })?.message ?? '';
        fail(t(/stale_stage_prices|stage_price_locked|proposer_assignment_changed/.test(message) ? 'project.priceChanges.stale' : /price_proposal_pending/.test(message) ? 'project.priceChanges.pendingExists' : 'project.priceChanges.saveFailed'));
      }
    } finally { inFlight.current = false; if (scope.current === project.id) setBusy(false); }
  }
  const pending = context?.history.find(item => item.status === 'pending');
  const preview = editing ? stagePricePreview(editing.context, editing.amounts) : null;
  const stale = editing && editing.context.base_hash !== context?.base_hash;
  if (!context && !error) return null;
  return <section className="space-y-4 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
    <h3 className="text-sm font-semibold">{t('project.priceChanges.title')}</h3>
    <p className="text-xs text-brand-mid-grey">{t('project.priceChanges.hint')}</p>
    {(project.pricing_revision ?? 0) > 0 && project.budget_original_amount != null && <p className="text-xs text-brand-mid-grey">{t(project.budget_source === 'boq' ? 'project.priceChanges.originalBill' : 'project.priceChanges.originalBudget', { amount: format(project.budget_original_amount, project.budget_currency ?? context?.currency ?? 'USD') })}</p>}
    {error && <p role="alert" className="text-xs text-state-alert">{error} <button type="button" onClick={() => { void load(); }} className="underline">{t('common.retry')}</button></p>}
    {context?.can_propose && !pending && !editing && <button type="button" onClick={() => { setDraft({ scope: project.id, context, amounts: {}, note: '' }); setFailure(null); }} className="rounded-xl bg-brand-green px-4 py-2.5 text-xs font-semibold text-white">{t('project.priceChanges.propose')}</button>}
    {editing && <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (preview?.rows.length && !stale) void mutate(() => proposeStagePrices(project.id, preview.rows, editing.context.base_hash, editing.note)); }}>
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-40">
        {editing.context.stages.map(stage => <div key={stage.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border-grey pb-3 text-xs dark:border-[#2c2c2c]">
          <label htmlFor={`stage-price-${stage.id}`} className="min-w-36 flex-1">{stageLabel(stage)}{!stage.editable && <span className="mt-1 block text-brand-mid-grey">{t('project.priceChanges.held')}</span>}</label>
          {stage.editable ? <input id={`stage-price-${stage.id}`} name={`stage-price-${stage.id}`} inputMode="decimal" value={editing.amounts[stage.id] ?? stage.amount}
            onChange={event => { const raw = event.target.value; setDraft({ ...editing, amounts: { ...editing.amounts, [stage.id]: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw } }); }}
            className="w-36 rounded-lg border border-brand-border-grey bg-transparent px-3 py-2 font-mono" /> : <span className="font-mono">{format(stage.amount, editing.context.currency)}</span>}
        </div>)}
        <p className="text-sm font-semibold">{t('project.priceChanges.proposedTotal', { amount: preview ? format(preview.total, editing.context.currency) : '—' })}</p>
        {!preview && <p role="alert" className="text-xs text-state-alert">{t('project.priceChanges.invalidAmount')}</p>}
        {stale && <p role="alert" className="text-xs text-state-alert">{t('project.priceChanges.stale')}</p>}
        <label className="block text-xs">{t('project.priceChanges.note')}<textarea value={editing.note} maxLength={2000} onChange={event => setDraft({ ...editing, note: event.target.value })} className="mt-2 w-full rounded-lg border border-brand-border-grey bg-transparent px-3 py-2" /></label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!preview?.rows.length || !!stale || busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('project.priceChanges.send')}</button>
          <button type="button" onClick={() => setDraft(null)} className="rounded-xl border px-4 py-2.5 text-xs">{t('common.cancel')}</button>
        </div>
      </fieldset>
    </form>}
    {context && context.history.length > 0 && <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">{context.history.map(proposal => <li key={proposal.id} className="space-y-2 py-4 text-xs">
      <p className="font-semibold">{t(`project.priceChanges.status.${proposal.status}` as TKey)}</p>
      <p className="font-mono">{format(proposal.old_total, proposal.currency)} → {format(proposal.new_total, proposal.currency)}</p>
      {proposal.changes.map(change => <p key={change.stage_id}>{stageLabel(change)}: <span className="font-mono">{format(change.before, proposal.currency)} → {format(change.after, proposal.currency)}</span></p>)}
      {proposal.note && <p className="whitespace-pre-wrap text-brand-mid-grey">{proposal.note}</p>}
      {proposal.status === 'pending' && <>
        <p className="text-brand-mid-grey">{t('project.priceChanges.pendingNote')}</p>
        {proposal.stale && <p className="text-brand-mid-grey">{t('project.priceChanges.stale')}</p>}
        <div className="flex flex-wrap gap-2">
          {context.can_approve && <>
            <button type="button" disabled={busy || proposal.stale} onClick={() => { void mutate(() => decideStagePrices(proposal.id, 'approved')); }} className="rounded-xl bg-brand-green px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{t('project.priceChanges.approve')}</button>
            <button type="button" disabled={busy} onClick={() => { void mutate(() => decideStagePrices(proposal.id, 'declined')); }} className="rounded-xl border px-4 py-2 disabled:opacity-40">{t('project.priceChanges.decline')}</button>
          </>}
          {proposal.can_withdraw && <button type="button" disabled={busy} onClick={() => { void mutate(() => decideStagePrices(proposal.id, 'withdrawn')); }} className="rounded-xl border px-4 py-2 disabled:opacity-40">{t('project.priceChanges.withdraw')}</button>}
        </div>
      </>}
    </li>)}</ol>}
  </section>;
}
