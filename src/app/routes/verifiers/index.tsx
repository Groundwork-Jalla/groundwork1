import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, FilePenLine, Loader2, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyVerifications, type VerifierWorkItem } from '@/lib/supabase/verifier-work';
import { matchesWorkFilter, searchWork, verifierSummary, type WorkFilter } from '@/lib/verifier/dashboard';
import { VerificationWorkspace, Panel } from '@/components/verifier/VerificationWorkspace';
import { EmptyState } from '@/components/ui/EmptyState';
import { errorMessage } from '@/lib/errors';
import { useFormat, useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { cn } from '@/lib/utils';

const METRICS: { filter: Exclude<WorkFilter, 'all'>; label: TKey; icon: LucideIcon }[] = [
  { filter: 'pending', label: 'verifier.dashboard.pending', icon: ClipboardList },
  { filter: 'visited', label: 'verifier.dashboard.visitedToday', icon: CalendarDays },
  { filter: 'findings', label: 'verifier.dashboard.needsFindings', icon: FilePenLine },
  { filter: 'recorded', label: 'verifier.dashboard.week', icon: CheckCircle2 },
];

export default function VerifierWork() {
  const t = useT();
  const f = useFormat();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { stageLabel } = useStageLabels();
  const [rows, setRows] = useState<VerifierWorkItem[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(0);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!user) return;
    const version = ++request.current;
    try {
      const r = await listMyVerifications(user.id);
      if (version !== request.current) return;
      setRows(r.rows); setAvailable(r.available); setError(null);
    } catch (err) {
      if (version !== request.current) return;
      setRows([]); setError(err);
    }
  }, [user?.id]);
  useEffect(() => {
    setRows(null);
    void load();
    return () => { request.current++; };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!rows || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [rows, location.hash]);

  const query = params.get('q') ?? '';
  const filterParam = params.get('filter');
  const filter: WorkFilter = METRICS.some(m => m.filter === filterParam) ? filterParam as WorkFilter : 'all';
  const summary = verifierSummary(rows ?? [], now);
  const visible = (rows ?? []).filter(r => searchWork(r, query) && matchesWorkFilter(r, filter, now));
  const visits = (rows ?? []).filter(r => r.decision === 'pending' && !r.visitedAt)
    .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  const done = (rows ?? []).filter(r => r.decision !== 'pending')
    .sort((a, b) => Date.parse(b.decidedAt ?? b.requestedAt) - Date.parse(a.decidedAt ?? a.requestedAt));
  const selectedId = params.get('verification') ?? visible.find(r => r.decision === 'pending')?.id ?? visible[0]?.id;
  const select = (id: string) => { const next = new URLSearchParams(params); next.set('verification', id); setParams(next, { preventScrollReset: true }); };
  const setFilter = (value: WorkFilter) => { const next = new URLSearchParams(params); next.set('filter', value); setParams(next, { preventScrollReset: true }); };
  const rowStage = (r: VerifierWorkItem) => stageLabel({ name: r.stageName, stage_key: r.stageKey });
  const history = <RecentDecisions rows={done} />;

  return <div className="space-y-5 text-brand-near-black dark:text-white">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">{t('verifier.dashboard.title')}</h1><p className="mt-1 text-sm text-brand-mid-grey">{t('verifier.work.subtitle')}</p></div>
      <p className="max-w-xs text-xs text-brand-mid-grey xl:text-right">{f.date(now.toISOString())}<span className="mt-1 block">{t('verifier.dashboard.scope')}</span></p>
    </header>
    <div className="relative lg:hidden">
      <Search className="absolute left-3 top-3 size-4 text-brand-mid-grey" />
      <input type="search" aria-label={t('verifier.dashboard.search')} placeholder={t('verifier.dashboard.search')} value={query} onChange={e => { const next = new URLSearchParams(params); next.set('q', e.target.value); setParams(next, { replace: true, preventScrollReset: true }); }} className="w-full rounded-xl border border-brand-border-grey bg-[#ffffff] py-2.5 pl-10 pr-3 text-sm dark:border-[#444] dark:bg-[#1e1e1e]" />
    </div>
    {rows === null ? <p role="status" className="flex items-center gap-2 py-12 text-xs text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p> : error ? <p role="alert" className="rounded-2xl border border-brand-border-grey p-5 text-sm text-state-alert dark:border-[#444]">{t('verifier.work.error', { reason: errorMessage(error, t('common.somethingWrong')) })}<button type="button" onClick={() => void load()} className="ml-3 underline">{t('verifier.dashboard.retry')}</button></p> : !available ? <p className="rounded-2xl border border-brand-border-grey p-5 text-sm text-brand-mid-grey dark:border-[#444]">{t('verifier.work.unavailable')}</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map(({ filter: key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn('rounded-2xl border bg-[#ffffff] p-5 text-left transition-colors dark:bg-[#1e1e1e]', filter === key ? 'border-brand-near-black dark:border-white' : 'border-brand-border-grey hover:border-brand-mid-grey dark:border-[#2c2c2c]')}>
          <span className="flex items-center gap-3 text-brand-mid-grey"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-border-grey dark:border-[#444]"><Icon className="size-4" /></span><span className="text-xs font-medium">{t(label)}</span></span>
          <span className="mt-2 flex items-center justify-between text-3xl font-semibold tabular-nums">{summary[key]}<ArrowRight className="size-4 text-brand-mid-grey" /></span>
        </button>)}
      </div>
      {rows.length === 0 ? <section id="assignments" className="scroll-mt-24 rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"><EmptyState icon={<ShieldCheck className="size-8" />} title={t('verifier.work.empty')} description={t('verifier.work.emptyBody')} /></section> : <section id="assignments" className="scroll-mt-24">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[3fr_2fr]">
          <Panel title={t('verifier.dashboard.assignments')} icon={<ClipboardList className="size-4" />}>
            <div className="flex flex-wrap items-center gap-3 px-5 py-3">
              <label htmlFor="assignment-filter" className="text-xs text-brand-mid-grey">{t('verifier.dashboard.status')}</label>
              <select id="assignment-filter" value={filter} onChange={e => setFilter(e.target.value as WorkFilter)} className="min-w-0 rounded-lg border border-brand-border-grey bg-[#ffffff] px-2 py-1.5 text-xs dark:border-[#444] dark:bg-[#1e1e1e]">
                <option value="all">{t('verifier.dashboard.all')}</option>{METRICS.map(m => <option key={m.filter} value={m.filter}>{t(m.label)}</option>)}
              </select>
            </div>
            {visible.length === 0 ? <p className="px-5 py-8 text-xs text-brand-mid-grey">{t('verifier.dashboard.noResults')}</p> : <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]"><tr>{['verifier.detail.project', 'verifier.detail.stage', 'verifier.dashboard.requested', 'verifier.dashboard.location', 'verifier.dashboard.status'].map(key => <th key={key} className="px-4 py-3 font-medium">{t(key as TKey)}</th>)}</tr></thead>
                <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">{visible.map(r => <tr key={r.id} className={cn(r.id === selectedId && 'bg-brand-off-white dark:bg-[#252525]')}>
                  <td className="min-w-36 px-4 py-3"><button type="button" onClick={() => select(r.id)} aria-pressed={r.id === selectedId} className="text-left font-semibold hover:underline">{r.projectName}<span className="mt-1 block text-[10px] font-normal text-brand-mid-grey">{t(r.id === selectedId ? 'verifier.dashboard.selected' : 'verifier.dashboard.select')} →</span></button></td>
                  <td className="px-4 py-3">{rowStage(r)}</td><td className="whitespace-nowrap px-4 py-3 text-brand-mid-grey">{f.date(r.requestedAt, 'short')}</td><td className="px-4 py-3 text-brand-mid-grey">{r.projectCity ?? r.projectCountry ?? '—'}</td><td className="px-4 py-3"><DecisionBadge decision={r.decision} /></td>
                </tr>)}</tbody>
              </table>
            </div>}
          </Panel>
          <div id="visits" className="scroll-mt-24"><Panel title={t('verifier.dashboard.visits')} icon={<CalendarDays className="size-4" />}>
            <p className="px-5 pt-4 text-[11px] leading-relaxed text-brand-mid-grey">{t('verifier.dashboard.visitsHint')}</p>
            {visits.length === 0 ? <p className="p-5 text-xs text-brand-mid-grey">{t('verifier.work.nonePending')}</p> : <ol className="max-h-72 divide-y divide-brand-border-grey overflow-y-auto px-5 dark:divide-[#2c2c2c]">{visits.map((r, i) => <li key={r.id}><button type="button" onClick={() => select(r.id)} className="flex w-full items-center gap-3 py-4 text-left"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-off-white text-xs dark:bg-[#292929]">{i + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.projectName}</span><span className="mt-1 block text-xs text-brand-mid-grey">{rowStage(r)} · {r.projectCity}</span><span className="mt-1 block text-[10px] text-brand-mid-grey">{t('verifier.detail.requested', { when: f.relative(r.requestedAt) })}</span></span><ArrowRight className="size-4 shrink-0 text-brand-mid-grey" /></button></li>)}</ol>}
          </Panel></div>
        </div>
      </section>}
      {rows.length === 0 && <div id="visits" className="scroll-mt-24"><Panel title={t('verifier.dashboard.visits')}><p className="p-5 text-xs text-brand-mid-grey">{t('verifier.work.nonePending')}</p></Panel></div>}
      <section id="review" className="scroll-mt-24">
        {selectedId ? <VerificationWorkspace key={`${user?.id}:${selectedId}`} verificationId={selectedId} history={history} onRecorded={async () => { select(selectedId); await load(); }} /> : <><Panel title={t('verifier.dashboard.workspace')}><p className="p-5 text-xs text-brand-mid-grey">{t('verifier.dashboard.reviewHint')}</p></Panel><div className="mt-5">{history}</div></>}
      </section>
    </>}
  </div>;
}

function DecisionBadge({ decision }: { decision: VerifierWorkItem['decision'] }) {
  const t = useT();
  const dot = { pending: 'bg-state-held', verified: 'bg-state-complete', rejected: 'bg-state-alert', needs_more_evidence: 'bg-state-active' };
  return <span className="inline-flex items-center gap-1.5 text-[10px]"><span className={cn('size-1.5 shrink-0 rounded-full', dot[decision])} />{t(`verifier.decision.${decision}` as TKey)}</span>;
}

function RecentDecisions({ rows }: { rows: VerifierWorkItem[] }) {
  const t = useT();
  const f = useFormat();
  return <div id="decisions" className="min-w-0 scroll-mt-24"><Panel title={t('verifier.dashboard.recent')} icon={<CheckCircle2 className="size-4" />}>
    {rows.length === 0 ? <p className="p-5 text-xs text-brand-mid-grey">{t('verifier.dashboard.noHistory')}</p> : <ul className="max-h-96 divide-y divide-brand-border-grey overflow-y-auto px-5 dark:divide-[#2c2c2c]">{rows.map(r => <li key={r.id} className="py-4"><Link to={`/verifiers/${r.id}`} className="text-xs font-semibold hover:underline">{r.projectName} <ArrowRight className="inline size-3" /></Link><p className="mb-2 mt-1 text-[10px] text-brand-mid-grey">{r.stageName} · {r.decidedAt ? f.date(r.decidedAt) : '—'}</p><DecisionBadge decision={r.decision} />{r.findings && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-brand-mid-grey">{r.findings}</p>}</li>)}</ul>}
  </Panel></div>;
}
