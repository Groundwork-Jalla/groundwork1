import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Check, FileText, Loader2, Lock, Upload, UserRound } from 'lucide-react';
import {
  fetchAssignedProject, fetchSubstages, fetchProjectDocuments, fetchRework, fetchMyPayments,
  submitSiteUpdate,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import type { ProjectRow, ProjectSubstageRow, ProjectDocumentRow } from '@/types/project';
import { fetchProjectViewers, type ProjectViewer } from '@/lib/supabase/project-viewers';
import { StagePipeline } from '@/components/contractor/StagePipeline';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { moneyPair, type MoneyPair } from '@/lib/budget/money-pair';
import { formatDate } from '@/lib/format';
import { useStageLabels } from '@/lib/stage-labels';
import { fileProblem, FILE_ACCEPT_ATTR, MAX_FILE_MB } from '@/lib/documents/accepted-files';
import { uploadDocument } from '@/lib/supabase/documents';
import { useT, type TKey } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { ShareProject } from '@/components/project/ShareProject';
import { cn } from '@/lib/utils';
import { ProjectConversations } from '@/components/project/ProjectConversations';

// =========================================================
// One assigned project, from the contractor's side.
//
// This is NOT the admin Project Workspace with controls removed. It answers one question —
// "what do I need to build or submit next?" — so the active stage and its checklist lead,
// and everything the contractor cannot act on is reference material behind a tab.
//
// Authority, enforced by the database and mirrored here so the UI never offers a dead
// control: no assign, no request verification, no record verification, no approve stage,
// no confirm funding, no authorise release. The contractor reports work; Groundwork
// governs what happens next.
// =========================================================

type Tab = 'work' | 'money' | 'documents' | 'messages' | 'people';

/** Validated: a stale or arbitrary `?tab=` opens the work tab, never a blank one. */
const ALL_TABS: Tab[] = ['work', 'money', 'documents', 'messages', 'people'];
function tabFromUrl(value: string | null): Tab {
  // `payments` was this tab's name until the 29 Oct 2026 redesign. Notification
  // emails and bookmarks still carry it, so it keeps working rather than silently
  // dropping somebody on the work tab.
  if (value === 'payments') return 'money';
  return ALL_TABS.includes(value as Tab) ? (value as Tab) : 'work';
}

const TABS: { id: Tab; key: TKey }[] = [
  { id: 'work',      key: 'contractorProject.tabWork' },
  { id: 'money',     key: 'contractorProject.tabMoney' },
  { id: 'documents', key: 'contractorProject.tabDocuments' },
  { id: 'messages',  key: 'contractorProject.tabMessages' },
  { id: 'people',    key: 'contractorProject.tabPeople' },
];

export default function ContractorProjectDetail() {
  const t = useT();
  const { user } = useAuth();
  const { projectId } = useParams<{ projectId: string }>();
  const { stageLabel, substageLabel } = useStageLabels();

  const [assigned, setAssigned] = useState<AssignedProject | null | 'denied'>(null);
  const [substages, setSubstages] = useState<ProjectSubstageRow[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentRow[]>([]);
  const [docBusy, setDocBusy]   = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [rework, setRework] = useState<ReworkItem[]>([]);
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * The open tab, taken from `?tab=` when there is one.
   *
   * It used to start on 'work' and ignore the URL entirely, so a contractor clicking
   * "Read it in Groundwork" in a message email, or the bell, landed on the work tab
   * and had to find Messages themselves. The link named the tab; nothing read it.
   *
   * Written back as it changes, so the address matches the screen.
   */
  const [tab, setTabState] = useState<Tab>(() => tabFromUrl(searchParams.get('tab')));
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'work') p.delete('tab'); else p.set('tab', next);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    if (!projectId) return;
    // A project that is not yours returns no row under RLS — the same answer as one that
    // does not exist, which is the answer it should get.
    const a = await fetchAssignedProject(projectId).catch(() => null);
    if (!a) { setAssigned('denied'); return; }
    setAssigned(a);
    const [subs, docs, rw, pay] = await Promise.all([
      fetchSubstages(projectId).catch(() => []),
      fetchProjectDocuments(projectId).catch(() => []),
      fetchRework([a]).catch(() => []),
      fetchMyPayments().catch(() => ({ rows: [], available: false })),
    ]);
    setSubstages(subs);
    setDocuments(docs);
    setRework(rw);
    setPayments({ ...pay, rows: pay.rows.filter(r => r.projectId === projectId) });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const activeSubstages = useMemo(
    () => (assigned && assigned !== 'denied' && assigned.activeStage
      ? substages.filter(s => s.stage_id === assigned.activeStage!.id)
      : []),
    [assigned, substages],
  );

  if (assigned === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  if (assigned === 'denied') {
    return (
      <div className="py-10">
        <Back />
        <p className="mt-4 rounded-xl border border-brand-border-grey bg-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          {t('contractorProject.notYours')}
        </p>
      </div>
    );
  }

  const { project, stages, activeStage, completedStages, totalStages } = assigned;

  return (
    <div className="flex flex-col gap-5">
      <Back />

      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{project.name}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          {[project.city, project.country].filter(Boolean).join(', ')}
          {totalStages > 0 && ` · ${t('contractor.projects.stageOf', { n: completedStages, total: totalStages })}`}
        </p>
      </header>

      {/* The spine, named. Same shape the client sees, so a phone call about progress
          starts from one picture rather than two. Labels only where there is room —
          on a phone the dots carry it and the stage name is spelled out below. */}
      {stages.length > 0 && (
        <>
          <StagePipeline stages={stages} size="md" labels className="hidden sm:flex" />
          <StagePipeline stages={stages} className="sm:hidden" />
        </>
      )}

      {/* What a reviewer sent back used to be repeated here, above the tabs, as
          well as on the stage it is about — two copies of one truth, free to
          disagree. It now lives only on its stage, inside the Work tab, and the tab
          carries a dot so it is still findable from Money or Documents. */}
      {/* Five tabs do not fit across 390px, and a clipped row would put People out
          of reach on the phone the work is actually done on. The row scrolls; the
          page does not. */}
      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-brand-border-grey px-1 [scrollbar-width:none] dark:border-[#2c2c2c] [&::-webkit-scrollbar]:hidden">
        {TABS.map(x => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)}
                  className={cn('-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    tab === x.id
                      ? 'border-brand-near-black text-brand-near-black dark:border-white dark:text-white'
                      : 'border-transparent text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
            {t(x.key)}
            {/* Not a count and not a second list: just "there is something on Work". */}
            {x.id === 'work' && rework.length > 0 && (
              <span aria-label={t('contractor.needsAction.title')}
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-state-alert align-middle" />
            )}
          </button>
        ))}
      </nav>

      {tab === 'work' && (
        <WorkTab
          assigned={assigned} substages={substages} rework={rework}
          onSubmitted={load}
        />
      )}

      {tab === 'documents' && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="mb-3 text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractorProject.tabDocuments')}
          </h2>

          {/* The tab listed documents and offered no way to add one, while the sidebar
              had a Documents link that went nowhere — so "upload a document" had no
              door at all. 131 is the other half: the contractor was refused by RLS at
              both the row and the bucket, so a button here would have failed silently. */}
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-brand-mid-grey">
              {t('contractorProject.uploadDocument', { mb: MAX_FILE_MB })}
            </span>
            <input
              type="file" multiple accept={FILE_ACCEPT_ATTR} disabled={docBusy || !user}
              onChange={e => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (picked.length === 0 || !user) return;
                const bad = picked.find(f => fileProblem(f));
                if (bad) {
                  setDocError(t(fileProblem(bad) === 'size'
                    ? 'project.documents.tooLarge' : 'project.documents.badType', { mb: MAX_FILE_MB }));
                  return;
                }
                setDocError(null); setDocBusy(true);
                // Sequential, not Promise.all: each upload inserts a row, and a partial
                // failure should leave the ones that worked rather than racing them.
                void (async () => {
                  const added: ProjectDocumentRow[] = [];
                  try {
                    for (const f of picked) added.push(await uploadDocument(project.id, user.id, f));
                    setDocuments(prev => [...added, ...prev]);
                  } catch (err) {
                    if (added.length) setDocuments(prev => [...added, ...prev]);
                    setDocError(errorMessage(err, t('chat.attachment.uploadFailed')));
                  } finally { setDocBusy(false); }
                })();
              }}
              className="block w-full text-sm text-brand-mid-grey file:mr-3 file:rounded-lg file:border file:border-brand-border-grey file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-brand-near-black dark:file:bg-[#141414] dark:file:text-white"
            />
          </label>
          {docBusy && <p role="status" className="mb-3 flex items-center gap-2 text-xs text-brand-mid-grey">
            <Loader2 className="size-3.5 animate-spin" />{t('common.uploading')}
          </p>}
          {docError && <p role="alert" className="mb-3 text-xs text-state-alert">{docError}</p>}

          {documents.length === 0 ? (
            <p className="text-sm text-brand-mid-grey">{t('contractorProject.noDocuments')}</p>
          ) : (
            /* Filed by what a document IS, not by when it arrived. "Show me the
               foundation photos" is the question people actually ask on a call, and
               a reverse-chronological list never answers it. */
            <DocumentGroups documents={documents} />
          )}

        </section>
      )}

      {tab === 'money' && (
        <MoneyTab assigned={assigned} payments={payments} />
      )}

      {tab === 'people' && (
        <PeopleTab project={project} isOwner={user?.id === project.user_id} />
      )}

      {tab === 'messages' && (
        <ProjectConversations projectId={project.id} projectName={project.name} />
      )}
    </div>
  );
}

function Back() {
  const t = useT();
  return (
    <Link to="/work/projects"
          className="inline-flex items-center gap-1.5 text-sm text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
      <ArrowLeft className="size-3.5" /> {t('contractorProject.back')}
    </Link>
  );
}

/**
 * Report work on the active stage.
 *
 * The upload goes to the private `evidence` bucket and `submit_site_update` records it —
 * see contractor-work.ts for why that order matters. The file is checked here first, so a
 * refusal arrives before anything is uploaded rather than after.
 */
function SubmitWork({ projectId, stage, substages, substageLabel, onSubmitted }: {
  projectId: string;
  stage: { id: string; status: string };
  substages: ProjectSubstageRow[];
  substageLabel: (s: Pick<ProjectSubstageRow, 'substage_key' | 'name'>) => string;
  onSubmitted: () => Promise<void> | void;
}) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [substageId, setSubstageId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // submit_site_update refuses a stage that is not active or under review; offering the
  // form anyway would be offering a control the database will reject.
  const open = stage.status === 'active' || stage.status === 'pending_review';

  async function submit() {
    setError(null); setBusy(true);
    try {
      await submitSiteUpdate({
        projectId, stageId: stage.id,
        substageId: substageId || null,
        description: description.trim() || null,
        files,
        // Idempotency: a retry on a bad site connection returns the same row rather than
        // appending the same photos twice.
        clientRef: crypto.randomUUID(),
      });
      setFiles([]); setDescription(''); setSubstageId(''); setDone(true);
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err, t('contractorSubmit.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('contractorSubmit.title')}</h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorSubmit.subtitle')}</p>

      {/* The item list itself is rendered by WorkTab, above this form: repeating it
          here would be two copies of the same checklist on one screen. */}

      {!open ? (
        <p className="mt-4 text-sm text-brand-mid-grey">{t('contractorSubmit.closed')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {substages.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-brand-mid-grey">{t('contractorSubmit.whichItem')}</span>
              <select value={substageId} onChange={e => setSubstageId(e.target.value)}
                      className="h-9 w-full rounded-lg border border-brand-border-grey bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white">
                <option value="">{t('contractorSubmit.wholeStage')}</option>
                {substages.map(s => <option key={s.id} value={s.id}>{substageLabel(s)}</option>)}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-brand-mid-grey">{t('contractorSubmit.notes')}</span>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                      className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-brand-mid-grey">
              {t('contractorSubmit.files', { mb: MAX_FILE_MB })}
            </span>
            <input type="file" multiple accept={FILE_ACCEPT_ATTR}
                   onChange={e => {
                     const picked = Array.from(e.target.files ?? []);
                     e.target.value = '';
                     const bad = picked.find(f => fileProblem(f));
                     if (bad) {
                       setError(t(fileProblem(bad) === 'size'
                         ? 'project.documents.tooLarge' : 'project.documents.badType', { mb: MAX_FILE_MB }));
                       return;
                     }
                     setError(null); setDone(false);
                     setFiles(prev => [...prev, ...picked]);
                   }}
                   className="block w-full text-sm text-brand-mid-grey file:mr-3 file:rounded-lg file:border file:border-brand-border-grey file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-brand-near-black dark:file:bg-[#141414] dark:file:text-white" />
          </label>

          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-brand-mid-grey">
                  <span className="truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 underline underline-offset-2">{t('common.remove')}</button>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
          {done && !error && <p role="status" className="text-xs text-state-complete">{t('contractorSubmit.sent')}</p>}

          <button type="button" disabled={busy || (files.length === 0 && !description.trim())}
                  onClick={submit}
                  className="inline-flex w-fit items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? t('contractorSubmit.sending') : t('contractorSubmit.cta')}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Money, stage by stage.
 *
 * Every figure in the project's own currency with the dollar beside it, at one rate
 * fetched today — see use-project-money.ts. The ledger rows underneath are what has
 * actually moved; the stage schedule above is what is due when.
 *
 * Observation only. Groundwork records and governs the schedule; a licensed payment
 * provider holds and moves the money. There is no confirm, authorise or reconcile
 * here, and nothing on this tab says Groundwork is holding anything.
 */
function MoneyTab({ assigned, payments }: {
  assigned: AssignedProject;
  payments: { rows: ContractorPayment[]; available: boolean } | null;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project.country);
  const { stages } = assigned;

  const released = stages.filter(s => s.status === 'complete');
  const sum = (list: typeof stages) =>
    list.reduce((total, s) => total + (s.payment_milestone_usd ?? 0), 0);

  const contract = money.pair(sum(stages));
  const paid     = money.pair(sum(released));
  const toCome   = money.pair(sum(stages) - sum(released));
  const pct = sum(stages) > 0 ? Math.round((sum(released) / sum(stages)) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t('contractorMoney.contractValue')} pair={contract} />
        <Figure label={t('contractorMoney.releasedToYou')} pair={paid} tone="complete"
                hint={t('contractorMoney.stagesReleased', { n: released.length })} />
        <Figure label={t('contractorMoney.stillToCome')} pair={toCome}
                hint={t('contractorMoney.stagesToCome', { n: stages.length - released.length })} />
      </div>

      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
            {t('contractorMoney.stageByStage')}
          </h2>
          <p className="text-xs text-brand-mid-grey">
            {t('contractorMoney.rateToday', { rate: money.rate.toLocaleString('en-US', { maximumFractionDigits: 2 }), code: money.code })}
          </p>
        </div>

        {stages.length === 0 ? (
          <p className="text-sm text-brand-mid-grey">{t('contractor.projects.noStages')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stages.map(s => {
              const due = money.pair(s.payment_milestone_usd);
              const state = s.status === 'complete'
                ? { label: t('contractorMoney.stateReleased'), tone: 'complete' as const }
                : s.status === 'active' || s.status === 'pending_review'
                  ? { label: t('contractorMoney.stateDue'), tone: 'held' as const }
                  : { label: t('contractorMoney.stateNotDue'), tone: 'locked' as const };
              return (
                <li key={s.id} className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-white px-4 py-2.5 dark:bg-[#1e1e1e]',
                  state.tone === 'held'
                    ? 'border-brand-near-black dark:border-white'
                    : 'border-brand-border-grey dark:border-[#2c2c2c]',
                )}>
                  <span className={cn(
                    'flex size-[21px] shrink-0 items-center justify-center rounded-full font-mono text-[9.5px] font-semibold',
                    state.tone === 'complete' && 'bg-state-complete text-white',
                    state.tone === 'held'     && 'border-2 border-state-complete text-state-complete',
                    state.tone === 'locked'   && 'border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]',
                  )}>
                    {s.status === 'complete' ? <Check className="size-2.5 stroke-[3]" /> : s.stage_number}
                  </span>
                  <span className="min-w-32 flex-1 truncate text-xs font-semibold text-brand-near-black dark:text-white">
                    {stageLabel(s)}
                  </span>
                  <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px]',
                    state.tone === 'complete' && 'text-state-complete',
                    state.tone === 'held'     && 'text-state-held',
                    state.tone === 'locked'   && 'text-brand-mid-grey',
                  )}>
                    <span aria-hidden className={cn('size-1.5 rounded-full',
                      state.tone === 'complete' && 'bg-state-complete',
                      state.tone === 'held'     && 'bg-state-held',
                      state.tone === 'locked'   && 'bg-brand-border-grey',
                    )} />
                    {state.label}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn('block font-mono text-xs font-semibold tabular-nums',
                      state.tone === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                      {due?.local ?? '—'}
                    </span>
                    {due?.usd && <span className="block font-mono text-[10px] text-brand-mid-grey">≈ {due.usd}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorMoney.progressOfContract')}
          </h2>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-brand-near-black dark:text-white">{pct}%</p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-brand-border-grey dark:bg-[#2c2c2c]">
            <div className="h-full rounded-full bg-state-complete" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-brand-mid-grey">
            {t('contractorMoney.ofContract', { paid: paid?.local ?? '—', total: contract?.local ?? '—' })}
          </p>
        </section>

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorMoney.recordedPayments')}
          </h2>
          {/* Three states apart: unreadable ledger, readable and empty, and rows. */}
          {payments === null ? (
            <p className="mt-3 text-sm text-brand-mid-grey">{t('common.loading')}</p>
          ) : !payments.available ? (
            <p className="mt-3 text-sm text-brand-mid-grey">{t('contractorPayments.unavailable')}</p>
          ) : payments.rows.length === 0 ? (
            <p className="mt-3 text-sm text-brand-mid-grey">{t('contractorPayments.none')}</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {payments.rows.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-brand-near-black dark:text-white">
                      {p.note ?? t('contractorPayments.milestone')}
                    </span>
                    <span className="block text-[11px] text-brand-mid-grey">{formatDate(p.createdAt)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
                    {moneyPair(p.amount, p.currency, null).local}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-brand-mid-grey">{t('contractorPayments.note')}</p>
        </section>
      </div>
    </div>
  );
}

function Figure({ label, pair, hint, tone }: {
  label: string; pair: MoneyPair | null; hint?: string; tone?: 'complete';
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{label}</p>
      <p className={cn('mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight',
        tone === 'complete' ? 'text-state-complete' : 'text-brand-near-black dark:text-white')}>
        {pair?.local ?? '—'}
      </p>
      <p className="mt-1 font-mono text-[11px] text-brand-mid-grey">
        {pair?.usd ? `≈ ${pair.usd}` : ' '}
      </p>
      {hint && <p className="mt-1 text-xs text-brand-mid-grey">{hint}</p>}
    </div>
  );
}

/**
 * Who is on this build, and what each of them may do.
 *
 * The matrix is deliberately explicit about what nobody here can do: release a
 * payment. That follows a verifier's approval, and it is not a button anyone on this
 * page holds — stating it once stops the question being asked on every call.
 */
function PeopleTab({ project, isOwner }: { project: ProjectRow; isOwner: boolean }) {
  const t = useT();
  const [viewers, setViewers] = useState<ProjectViewer[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProjectViewers(project.id)
      .then(rows => { if (alive) setViewers(rows); })
      .catch(() => { if (alive) setViewers([]); });
    return () => { alive = false; };
  }, [project.id]);

  const CAN: { label: string; you: boolean; client: boolean; verifier: boolean }[] = [
    { label: t('contractorPeople.canSee'),     you: true,  client: true,  verifier: true },
    { label: t('contractorPeople.canChat'),    you: true,  client: true,  verifier: true },
    { label: t('contractorPeople.canDoc'),     you: true,  client: true,  verifier: false },
    { label: t('contractorPeople.canEvidence'),you: true,  client: false, verifier: false },
    { label: t('contractorPeople.canApprove'), you: false, client: false, verifier: true },
    { label: t('contractorPeople.canRelease'), you: false, client: false, verifier: false },
    { label: t('contractorPeople.canInvite'),  you: isOwner, client: false, verifier: false },
  ];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorPeople.onThisProject')}
          </h2>

          <div className="mt-3 flex items-center gap-3 border-t border-brand-border-grey pt-3 dark:border-[#2c2c2c]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-xs font-bold text-white dark:bg-white dark:text-brand-near-black">
              <UserRound className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-brand-near-black dark:text-white">
                {t('contractorPeople.you')}
              </span>
              <span className="block text-xs text-brand-mid-grey">
                {isOwner ? t('contractorPeople.youOwner') : t('contractorPeople.youAssigned')}
              </span>
            </span>
          </div>

          {viewers === null ? (
            <p className="py-4 text-xs text-brand-mid-grey">{t('common.loading')}</p>
          ) : viewers.length === 0 ? (
            <p className="border-t border-brand-border-grey py-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c]">
              {t('contractorPeople.nobodyInvited')}
            </p>
          ) : (
            <ul>
              {viewers.map(v => (
                <li key={v.id} className="flex items-center gap-3 border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-brand-border-grey text-[11px] font-bold text-brand-mid-grey dark:border-[#2c2c2c]">
                    {v.email.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-brand-near-black dark:text-white">{v.email}</span>
                    <span className="block text-xs text-brand-mid-grey">
                      {v.acceptedAt
                        ? t('contractorPeople.accepted', { date: formatDate(v.acceptedAt) })
                        : t('contractorPeople.invitedNotOpened', { date: formatDate(v.invitedAt) })}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-[11px] font-semibold',
                    v.acceptedAt ? 'text-state-complete' : 'text-state-held')}>
                    {v.acceptedAt ? t('contractorPeople.watching') : t('contractorPeople.pending')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorPeople.whoCanDoWhat')}
          </h2>
          <table className="mt-3 w-full border-collapse text-xs">
            <thead>
              <tr className="text-[9.5px] font-bold uppercase tracking-wider text-brand-mid-grey">
                <th className="pb-2 text-left" />
                <th className="w-16 pb-2">{t('contractorPeople.colYou')}</th>
                <th className="w-16 pb-2">{t('contractorPeople.colClient')}</th>
                <th className="w-16 pb-2">{t('contractorPeople.colVerifier')}</th>
              </tr>
            </thead>
            <tbody>
              {CAN.map(row => (
                <tr key={row.label} className="border-t border-brand-border-grey dark:border-[#2c2c2c]">
                  <td className="py-2 text-brand-mid-grey">{row.label}</td>
                  {[row.you, row.client, row.verifier].map((yes, i) => (
                    <td key={i} className="py-2 text-center">
                      {yes
                        ? <Check className="mx-auto size-3.5 stroke-[3] text-state-complete" aria-label="yes" />
                        : <span className="text-brand-border-grey" aria-label="no">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-brand-mid-grey">{t('contractorPeople.nobodyReleases')}</p>
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* Invite the client to watch their own build.
            
            Only when the CONTRACTOR owns the project — which happens when they set it
            up themselves rather than for a client who already has an account. In that
            case the build is managed end to end by the contractor, and the client is
            the person it is for: they should be able to follow it.
            
            `invite_project_viewer` (112) already allows exactly this and nothing more.
            Its guard is "only the owner may share", and here the owner IS the
            contractor, so no new permission is involved. */}
        {isOwner ? (
          <ShareProject projectId={project.id} />
        ) : (
          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorPeople.inviteTitle')}
            </h2>
            <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPeople.notYoursToShare')}</p>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The Work tab: the stages, with the one being worked opened up.
 *
 * The approved shape (29 Oct 2026). Finished and locked stages collapse to a line
 * carrying their name, their state and their money; the open one expands into its
 * work items and the form that submits evidence against them.
 *
 * A work item's tick is an OUTPUT, never an input. It fills when a file lands
 * against the item — `submit_site_update` does that server side. Nothing here
 * completes a stage or approves anything: that is not the contractor's to do.
 */
function WorkTab({ assigned, substages, rework, onSubmitted }: {
  assigned: AssignedProject;
  substages: ProjectSubstageRow[];
  rework: ReworkItem[];
  onSubmitted: () => Promise<void> | void;
}) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project.country);
  const { project, stages, activeStage } = assigned;

  if (stages.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">
          {t('contractor.projects.noStages')}
        </p>
      </section>
    );
  }

  const openItems = activeStage ? substages.filter(s => s.stage_id === activeStage.id) : [];
  const doneItems = openItems.filter(s => s.status === 'complete').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
          {t('contractorProject.pipeline')}
        </h2>
        <p className="text-xs text-brand-mid-grey">
          {t('contractorWork.stageSummary', {
            done: assigned.completedStages,
            open: activeStage ? 1 : 0,
            left: stages.length - assigned.completedStages - (activeStage ? 1 : 0),
          })}
        </p>
      </div>

      {stages.map(stage => {
        const isOpen = stage.id === activeStage?.id;
        const due = money.pair(stage.payment_milestone_usd);
        const sent = rework.filter(r => r.stageId === stage.id);

        if (!isOpen) {
          return (
            <section key={stage.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-brand-border-grey bg-white px-4 py-2.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <span className={cn(
                'flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold',
                stage.status === 'complete'
                  ? 'bg-state-complete text-white'
                  : 'border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]',
              )}>
                {stage.status === 'complete' ? <Check className="size-2.5 stroke-[3]" />
                  : stage.status === 'locked' ? <Lock className="size-2.5" />
                  : stage.stage_number}
              </span>
              <span className={cn('min-w-32 flex-1 truncate text-[13px] font-semibold',
                stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                {stageLabel(stage)}
              </span>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-brand-mid-grey">
                {t(`contractorStageStatus.${stage.status}` as TKey)}
              </span>
              <span className="shrink-0 text-right">
                <span className={cn('block font-mono text-xs tabular-nums',
                  stage.status === 'complete' ? 'text-brand-near-black dark:text-white' : 'text-brand-mid-grey')}>
                  {due?.local ?? '—'}
                </span>
                {due?.usd && <span className="block font-mono text-[10px] text-brand-mid-grey">≈ {due.usd}</span>}
              </span>
            </section>
          );
        }

        return (
          <section key={stage.id}
            className="rounded-2xl border-[1.5px] border-brand-near-black bg-white p-5 dark:border-white dark:bg-[#1e1e1e]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 border-state-complete font-mono text-[10px] font-semibold text-state-complete">
                {stage.stage_number}
              </span>
              <h3 className="flex-1 text-base font-bold tracking-tight text-brand-near-black dark:text-white">
                {stageLabel(stage)}
              </h3>
              {openItems.length > 0 && (
                <span className="font-mono text-xs text-brand-mid-grey">
                  {doneItems} / {openItems.length} {t('contractorWork.items')}
                </span>
              )}
            </div>
            <p className="ml-[34px] mt-1 text-xs text-brand-mid-grey">{t('contractorWork.ticksItself')}</p>

            {/* What a verifier sent back belongs to the stage it is about, not to a
                separate list somewhere else in the app. */}
            {sent.length > 0 && (
              <div className="mt-4 rounded-xl border border-state-held/40 bg-state-held/10 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-state-held">
                  {t('contractor.needsAction.title')}
                </p>
                {sent.map(r => (
                  <div key={`${r.stageId}:${r.decidedAt}`} className="mt-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-state-held">
                      {t(r.decision === 'rejected'
                        ? 'contractor.decision.rejected'
                        : 'contractor.decision.needsMoreEvidence')}
                    </p>
                    {r.findings && (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">
                        {r.findings}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {openItems.length > 0 && (
              <ul className="mt-3">
                {openItems.map(item => {
                  const complete = item.status === 'complete';
                  const count = item.evidence_urls?.length ?? 0;
                  return (
                    <li key={item.id}
                        className="flex items-center gap-3 border-t border-brand-border-grey py-2.5 dark:border-[#2c2c2c]">
                      <span aria-hidden className={cn(
                        'flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]',
                        complete
                          ? 'border-state-complete bg-state-complete text-white'
                          : 'border-brand-border-grey dark:border-[#444]',
                      )}>
                        {complete && <Check className="size-2.5 stroke-[3]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[13px]',
                          complete ? 'text-brand-mid-grey' : 'font-semibold text-brand-near-black dark:text-white')}>
                          {substageLabel(item)}
                        </span>
                        <span className="block text-[11px] text-brand-mid-grey">
                          {count > 0
                            ? t('contractorProject.evidenceCount', { count })
                            : t('contractorProject.noEvidence')}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 border-t border-brand-border-grey pt-4 dark:border-[#2c2c2c]">
              <SubmitWork projectId={project.id} stage={stage} substages={openItems}
                          substageLabel={substageLabel} onSubmitted={onSubmitted} />
            </div>

            {due && (
              <div className="mt-4 rounded-xl bg-brand-off-white px-4 py-3 dark:bg-[#141414]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">
                  {t('contractorDashboard.dueOnApproval')}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-brand-near-black dark:text-white">
                  {due.local}
                </p>
                {due.usd && <p className="font-mono text-[11px] text-brand-mid-grey">≈ {due.usd}</p>}
                <p className="mt-1.5 text-xs text-brand-mid-grey">{t('contractorWork.sendsItself')}</p>
              </div>
            )}
          </section>
        );
      })}

      {!activeStage && (
        <section className="mt-2 rounded-2xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">
            {t('contractorProject.noActiveStage')}
          </p>
          <p className="mt-1 text-xs text-brand-mid-grey">{t('contractorProject.noActiveStageBody')}</p>
        </section>
      )}
    </div>
  );
}

/**
 * Project documents, grouped by what they are.
 *
 * Three groups, in the order a contractor needs them: what the build was costed
 * from, what has been photographed on site, and the paperwork around it. Anything
 * whose category is unknown lands in the last group rather than disappearing.
 */
function DocumentGroups({ documents }: { documents: ProjectDocumentRow[] }) {
  const t = useT();

  const GROUPS: { key: TKey; of: (d: ProjectDocumentRow) => boolean }[] = [
    { key: 'contractorDocs.theBuild', of: d => d.category === 'boq' },
    { key: 'contractorDocs.siteEvidence', of: d => d.category === 'site_photo' },
    { key: 'contractorDocs.paperwork', of: d => d.category !== 'boq' && d.category !== 'site_photo' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map(group => {
        const rows = documents.filter(group.of);
        if (rows.length === 0) return null;
        return (
          <section key={group.key}>
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t(group.key)}
            </h3>
            <ul className="flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {rows.map(d => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-brand-mid-grey" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-brand-near-black dark:text-white">
                      {d.file_name}
                    </span>
                    <span className="block text-[11px] text-brand-mid-grey">
                      {formatDate(d.created_at)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-brand-mid-grey">
                    {d.file_size ? `${Math.round(d.file_size / 1024)} KB` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
