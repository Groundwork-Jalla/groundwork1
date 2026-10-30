import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Camera, Check, FileText, Loader2, Lock, Upload, UserRound } from 'lucide-react';
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
    // The way back renders immediately. A bare spinner on a slow site connection
    // leaves somebody on a page with no heading and no way off it.
    return (
      <div className="flex flex-col gap-5">
        <Back />
        <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      </div>
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
        <DocumentsTab assigned={assigned} documents={documents} isOwner={user?.id === project.user_id} />
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
function SubmitWork({ projectId, stage, substages, fixedSubstageId, substageLabel, onSubmitted, onCancel }: {
  projectId: string;
  stage: { id: string; status: string };
  substages: ProjectSubstageRow[];
  /** The item the Upload button named. The picker is not shown when this is set. */
  fixedSubstageId?: string;
  substageLabel: (s: Pick<ProjectSubstageRow, 'substage_key' | 'name'>) => string;
  onSubmitted: () => Promise<void> | void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [substageId, setSubstageId] = useState<string>(fixedSubstageId ?? '');
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

  /** One check for both doors: nothing is queued that the upload would refuse. */
  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
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
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
        {fixedSubstageId
          ? t('contractorSubmit.forItem', {
              name: substages.find(x => x.id === fixedSubstageId)
                ? substageLabel(substages.find(x => x.id === fixedSubstageId)!)
                : '',
            })
          : t('contractorSubmit.title')}
      </h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorSubmit.subtitle')}</p>

      {/* The item list itself is rendered by WorkTab, above this form: repeating it
          here would be two copies of the same checklist on one screen. */}

      {!open ? (
        <p className="mt-4 text-sm text-brand-mid-grey">{t('contractorSubmit.closed')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {substages.length > 0 && !fixedSubstageId && (
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

          {/* Two ways in, because this is used on a slab in daylight (30 Oct 2026).
              `capture="environment"` opens the rear camera straight away on a phone;
              the second input is the ordinary picker for a file already taken, or
              for a laptop, where `capture` is simply ignored. Both run the same
              check before anything is uploaded. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-brand-mid-grey">
              {t('contractorSubmit.files', { mb: MAX_FILE_MB })}
            </span>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black">
                <Camera className="size-3.5" aria-hidden />
                {t('contractorSubmit.takePhoto')}
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                       onChange={e => addFiles(e)} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-border-grey px-3.5 py-2 text-xs font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
                <Upload className="size-3.5" aria-hidden />
                {t('contractorSubmit.chooseFile')}
                <input type="file" multiple accept={FILE_ACCEPT_ATTR} className="sr-only"
                       onChange={e => addFiles(e)} />
              </label>
            </div>
          </div>

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
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="w-fit text-xs font-semibold text-brand-mid-grey underline underline-offset-2">
              {t('common.cancel')}
            </button>
          )}
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

  /**
   * Three facts, kept apart (30 Oct 2026).
   *
   * This card used to call the SCHEDULE "released to you": it summed the
   * milestones of every stage marked complete and printed the total under
   * "Released to you". Two things were wrong with that.
   *
   * First, approved is not paid. A stage approved this morning and not yet paid
   * was counted as money the contractor had received.
   *
   * Second, `pre_existing` stages are complete but were "never approved, verified
   * or funded by us" (103) — they are work finished before the build joined
   * Groundwork, and they carry a zeroed milestone. Counting them made the tile
   * read "0 XAF · 4 stages approved", which is two true numbers that together say
   * something false.
   *
   * So: the contract and what is still to come come from the SCHEDULE, which is
   * what Groundwork governs. What was released comes from the LEDGER, which is
   * the only record of money that actually moved — and shows a dash, never a
   * zero, when the ledger cannot be read.
   */
  const sum = (list: typeof stages) =>
    list.reduce((total, s) => total + (s.payment_milestone_usd ?? 0), 0);

  /** Finished THROUGH Groundwork — what was there before we arrived is not ours. */
  const approved = stages.filter(s => s.status === 'complete' && s.pre_existing !== true);
  const outstanding = stages.filter(s => s.status !== 'complete');

  const contract = money.pair(sum(stages));
  const toCome   = money.pair(sum(outstanding));

  /** What the ledger says reached this contractor on this project. */
  const ledger = payments?.available ? payments.rows : null;
  const ledgerCodes = new Set((ledger ?? []).map(r => r.currency.toUpperCase()));
  const releasedLabel = ledger === null ? null
    : ledger.length === 0 ? money.pair(0)?.local ?? null
    : ledgerCodes.size === 1
      ? moneyPair(ledger.reduce((n, r) => n + r.amount, 0), [...ledgerCodes][0], null).local
      // More than one currency: a sum would be a number that means nothing.
      : null;

  // Progress is against the SCHEDULE and is labelled as such — it is how much of
  // the contracted work has been signed off, not how much has been paid.
  const pct = sum(stages) > 0 ? Math.round((sum(approved) / sum(stages)) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t('contractorMoney.contractValue')} pair={contract} />
        <FigureText label={t('contractorMoney.releasedToYou')} value={releasedLabel} tone="complete"
                    hint={ledger === null
                      ? t('contractorPayments.unavailable')
                      : t('contractorMoney.paymentsRecorded', { n: ledger.length })} />
        <Figure label={t('contractorMoney.stillToCome')} pair={toCome}
                hint={t('contractorMoney.stagesToCome', { n: outstanding.length })} />
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
            {t('contractorMoney.ofContract', {
              paid: money.pair(sum(approved))?.local ?? '—',
              total: contract?.local ?? '—',
            })}
          </p>
          <p className="mt-1 text-[11px] text-brand-mid-grey">
            {t('contractorMoney.approvedNotPaid', { n: approved.length })}
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
      {/* The blank line keeps the three cards' baselines level when they sit in a
          row. Stacked on a phone there is no row to level, so it goes. */}
      {pair?.usd
        ? <p className="mt-1 font-mono text-[11px] text-brand-mid-grey">≈ {pair.usd}</p>
        : <p className="mt-1 hidden font-mono text-[11px] sm:block">&nbsp;</p>}
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

  /**
   * Who can do what. The VERIFIER column is hidden with the rest of verification
   * (30 Oct 2026) — a column for a role the contractor cannot see or contact only
   * raises a question the product is not yet ready to answer. The rows are
   * unchanged, so restoring the column is one field each.
   */
  const CAN: { label: string; you: boolean; client: boolean }[] = [
    { label: t('contractorPeople.canSee'),     you: true,  client: true },
    { label: t('contractorPeople.canChat'),    you: true,  client: true },
    { label: t('contractorPeople.canDoc'),     you: true,  client: true },
    { label: t('contractorPeople.canEvidence'),you: true,  client: false },
    { label: t('contractorPeople.canRelease'), you: false, client: false },
    { label: t('contractorPeople.canInvite'),  you: isOwner, client: false },
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
              </tr>
            </thead>
            <tbody>
              {CAN.map(row => (
                <tr key={row.label} className="border-t border-brand-border-grey dark:border-[#2c2c2c]">
                  <td className="py-2 text-brand-mid-grey">{row.label}</td>
                  {[row.you, row.client].map((yes, i) => (
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
          {/* "Nobody on this list can release a payment" was here. Removed 30 Oct
              2026 at Favour's request: it named the verifier, which is hidden on this
              surface, and answered a question nobody on the People tab was asking. */}
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
  /** The item whose Upload was pressed; null means no form is open. */
  const [uploadFor, setUploadFor] = useState<string | null>(null);

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
    <div className="grid items-start gap-5 xl:grid-cols-[1fr_326px]">
    <div className="flex min-w-0 flex-col gap-2">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight text-brand-near-black dark:text-white">
          {t('contractorWork.stages')}
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
                        className="border-t border-brand-border-grey py-2.5 dark:border-[#2c2c2c]">
                      <div className="flex items-center gap-3">
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
                      {complete ? (
                        <span className="shrink-0 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-[11px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c]">
                          {t('contractorDocs.view')}
                        </span>
                      ) : (
                        <button type="button" onClick={() => setUploadFor(item.id)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-2.5 py-1.5 text-[11px] font-semibold text-white dark:bg-white dark:text-brand-near-black">
                          <Camera className="size-3" aria-hidden />{t('contractorProject.upload')}
                        </button>
                      )}
                      </div>

                      {/* Opened against the item it belongs to, so the camera and
                          the file picker are under the thumb that pressed Upload —
                          not at the bottom of a ten-item list. */}
                      {uploadFor === item.id && (
                        <div className="mt-3 rounded-xl bg-brand-off-white px-4 py-3.5 dark:bg-[#141414]">
                          <SubmitWork projectId={project.id} stage={stage} substages={openItems}
                                      fixedSubstageId={item.id}
                                      substageLabel={substageLabel}
                                      onCancel={() => setUploadFor(null)}
                                      onSubmitted={async () => { setUploadFor(null); await onSubmitted(); }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}


            {/* "Released when this stage is approved" was here, with the stage figure
                and a line about verification. Removed 30 Oct 2026 at Favour's request.
                It said verification out loud on a surface where verification is
                hidden, and it repeated a number the Money tab already carries — the
                Work tab is for the work. */}
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

    <WorkRail assigned={assigned} />
    </div>
  );
}

/**
 * The right-hand rail on the Work tab: next release, the build's own facts, and
 * who is on it.
 *
 * It was dropped when the tab was refactored and the page went full width —
 * reported 30 Oct: "this is not how it is in the screen design." The verifier row
 * is not here, with the rest of verification.
 */
function WorkRail({ assigned }: { assigned: AssignedProject }) {
  const t = useT();
  const money = useProjectMoney(assigned.project.country);
  const [viewers, setViewers] = useState<ProjectViewer[] | null>(null);
  const { project, stages, activeStage } = assigned;

  useEffect(() => {
    let alive = true;
    fetchProjectViewers(project.id)
      .then(rows => { if (alive) setViewers(rows); })
      .catch(() => { if (alive) setViewers([]); });
    return () => { alive = false; };
  }, [project.id]);

  const sum = (list: typeof stages) =>
    list.reduce((n, s) => n + (s.payment_milestone_usd ?? 0), 0);
  const approved = stages.filter(s => s.status === 'complete' && s.pre_existing !== true);
  const contract = money.pair(sum(stages));
  const signedOff = money.pair(sum(approved));
  const pct = sum(stages) > 0 ? Math.round((sum(approved) / sum(stages)) * 100) : 0;
  const due = money.pair(activeStage?.payment_milestone_usd ?? null);

  return (
    <aside className="flex min-w-0 flex-col gap-4">
      {due && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractor.projects.colNextRelease')}
          </h2>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-brand-near-black dark:text-white">
            {due.local}
          </p>
          {due.usd && (
            <p className="font-mono text-[11px] text-brand-mid-grey">
              {t('contractorDashboard.atRate', {
                usd: due.usd,
                rate: money.rate.toLocaleString('en-US', { maximumFractionDigits: 2 }),
                code: money.code,
              })}
            </p>
          )}
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-border-grey dark:bg-[#2c2c2c]">
            <div className="h-full rounded-full bg-state-complete" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex justify-between text-[11px] text-brand-mid-grey">
            <span>{t('contractorMoney.signedOff', { amount: signedOff?.local ?? '—' })}</span>
            <span>{t('contractorMoney.ofContractPct', { pct })}</span>
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
          {t('contractorWork.thisBuild')}
        </h2>
        <div className="kv mt-1">
          <div className="flex items-start justify-between gap-3 border-t border-brand-border-grey py-2.5 text-xs dark:border-[#2c2c2c]">
            <span className="text-brand-mid-grey">{t('contractorMoney.contractValue')}</span>
            <span className="text-right">
              <span className="block font-mono font-semibold tabular-nums text-brand-near-black dark:text-white">
                {contract?.local ?? '—'}
              </span>
              {contract?.usd && <span className="block font-mono text-[10px] text-brand-mid-grey">≈ {contract.usd}</span>}
            </span>
          </div>
          {[project.city, project.country].filter(Boolean).length > 0 && (
            <div className="flex items-start justify-between gap-3 border-t border-brand-border-grey py-2.5 text-xs dark:border-[#2c2c2c]">
              <span className="text-brand-mid-grey">{t('contractorWork.where')}</span>
              <span className="text-right font-semibold text-brand-near-black dark:text-white">
                {[project.city, project.country].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-3 border-t border-brand-border-grey py-2.5 text-xs dark:border-[#2c2c2c]">
            <span className="text-brand-mid-grey">{t('contractorWork.stagesDone')}</span>
            <span className="text-right font-semibold text-brand-near-black dark:text-white">
              {t('contractor.projects.stageOf', { n: assigned.completedStages, total: assigned.totalStages })}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
          {t('contractorWork.peopleOnThis')}
        </h2>
        <SeenBy initials={t('contractorPeople.you').slice(0, 2).toUpperCase()}
                name={t('contractorPeople.you')} role={t('contractorPeople.youOwner')} />
        {viewers?.map(v => (
          <SeenBy key={v.id} initials={v.email.slice(0, 2).toUpperCase()}
                  name={v.relationship?.trim() || v.email}
                  role={t(v.acceptedAt ? 'contractorDocs.clientCanView' : 'contractorPeople.pending')} />
        ))}
        {viewers !== null && viewers.length === 0 && (
          <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPeople.nobodyInvited')}</p>
        )}
        <Link to="?tab=people" className="mt-3 inline-block text-xs underline underline-offset-2 text-brand-mid-grey">
          {t('contractorPeople.onThisProject')}
        </Link>
      </section>
    </aside>
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

/**
 * Documents: an organised collection of the project's files.
 *
 * Philip, 29 October: a document dropped in at random has no use. So there is no
 * upload here — a photo that proves work belongs against the stage item it proves,
 * on the Work tab, where it ticks that item off. This tab is for finding things.
 *
 * Grouped by what a file IS, not by when it arrived: "show me the foundation
 * photos" is the question people ask on a call, and a reverse-chronological list
 * never answers it.
 */
function DocumentsTab({ assigned, documents, isOwner }: {
  assigned: AssignedProject; documents: ProjectDocumentRow[]; isOwner: boolean;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [filter, setFilter] = useState<'all' | 'drawings' | 'boq' | 'site' | 'certificates'>('all');
  const [viewers, setViewers] = useState<ProjectViewer[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProjectViewers(assigned.project.id)
      .then(rows => { if (alive) setViewers(rows); })
      .catch(() => { if (alive) setViewers([]); });
    return () => { alive = false; };
  }, [assigned.project.id]);

  const drawings = documents.filter(d => d.category !== 'boq' && d.category !== 'site_photo');
  const boq = documents.filter(d => d.category === 'boq');
  const sitePhotos = documents.filter(d => d.category === 'site_photo');
  // One certificate per approved stage — that is how they are issued, so that is
  // how they are counted. Nothing invented: an unapproved stage has none.
  const certificates = assigned.stages.filter(st => st.status === 'complete');
  /** The stages the group below lists, so the chip counts what is under it. */
  const stagesWithUpdates = assigned.stages.filter(st =>
    st.status === 'complete' || st.status === 'active' || st.status === 'pending_review');

  const CHIPS = [
    { id: 'all' as const,          label: t('contractorDocs.chipAll'),      n: documents.length + certificates.length },
    { id: 'drawings' as const,     label: t('contractorDocs.chipDrawings'), n: drawings.length },
    { id: 'boq' as const,          label: t('contractorDocs.chipBoq'),      n: boq.length },
    { id: 'site' as const,         label: t('contractorDocs.chipSite'),     n: stagesWithUpdates.length },
    { id: 'certificates' as const, label: t('contractorDocs.chipCerts'),    n: certificates.length },
  ];

  const show = (which: typeof filter) => filter === 'all' || filter === which;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {CHIPS.map(c => (
            <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === c.id
                  ? 'border-brand-near-black bg-brand-near-black font-semibold text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]')}>
              {c.label}
              <span className={cn('ml-1.5 font-mono text-[10px] tabular-nums',
                filter === c.id ? 'opacity-60' : 'text-brand-mid-grey')}>{c.n}</span>
            </button>
          ))}
        </div>

        {documents.length === 0 && certificates.length === 0 && (
          <p className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
            {t('contractorProject.noDocuments')}
          </p>
        )}

        {(show('drawings') || show('boq')) && (drawings.length > 0 || boq.length > 0) && (
          <Group title={t('contractorDocs.theBuild')}>
            {[...boq, ...drawings].map(d => (
              <FileRow key={d.id} kind="PDF" name={d.file_name}
                       sub={[d.category === 'boq' ? t('contractorDocs.billOfQuantities') : t('contractorDocs.drawing'),
                            d.file_size ? `${Math.round(d.file_size / 1024)} KB` : null].filter(Boolean).join(' · ')}
                       when={formatDate(d.created_at)} />
            ))}
          </Group>
        )}

        {show('site') && (
          <Group title={t('contractorDocs.siteUpdatesFiled')}>
            {stagesWithUpdates.length === 0
              ? <p className="py-3 text-xs text-brand-mid-grey">{t('contractorDocs.noSiteUpdates')}</p>
              : stagesWithUpdates.map(st => (
                    <FileRow key={st.id} kind={String(st.stage_number)} name={stageLabel(st)}
                             sub={t(st.status === 'complete'
                               ? 'contractorDocs.stageApproved' : 'contractorDocs.stageOpen')}
                             when="" state={st.status === 'complete' ? 'done' : 'open'} />
                ))}
          </Group>
        )}

        {show('certificates') && certificates.length > 0 && (
          <Group title={t('contractorDocs.certificatesIssued')}>
            {certificates.map(st => (
              <FileRow key={st.id} kind="CRT"
                       name={t('contractorDocs.stageCertificate', { n: st.stage_number, name: stageLabel(st) })}
                       sub={t('contractorDocs.issuedByGroundwork')} when="" action={t('contractorDocs.share')} />
            ))}
          </Group>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorDocs.whoCanSee')}
          </h2>
          {/* The verifier row is hidden with the rest of verification (30 Oct 2026). */}
          {viewers?.map(v => (
            <SeenBy key={v.id} initials={v.email.slice(0, 2).toUpperCase()}
                    name={v.relationship?.trim() || v.email}
                    role={t('contractorDocs.clientCanView')} />
          ))}
          <SeenBy initials={t('contractorPeople.you').slice(0, 2).toUpperCase()}
                  name={t('contractorPeople.you')} role={t('contractorDocs.ownerEverything')} />
          {viewers !== null && viewers.length === 0 && (
            <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPeople.nobodyInvited')}</p>
          )}
          {isOwner && (
            <Link to="?tab=people" className="mt-3 inline-block text-xs underline underline-offset-2 text-brand-mid-grey">
              {t('contractorPeople.inviteTitle')}
            </Link>
          )}
        </section>

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorDocs.nothingLeaves')}
          </h2>
          <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorDocs.nothingLeavesBody')}</p>
        </section>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white px-5 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="py-2 text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{title}</h3>
      {children}
    </section>
  );
}

function FileRow({ kind, name, sub, when, action, state }: {
  kind: string; name: string; sub: string; when: string;
  action?: string; state?: 'done' | 'open';
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-border-grey bg-brand-off-white font-mono text-[8px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#141414]">
        {kind}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-brand-near-black dark:text-white">{name}</span>
        <span className="block text-[11px] text-brand-mid-grey">{sub}</span>
      </span>
      {when && <span className="shrink-0 font-mono text-[11px] text-brand-mid-grey">{when}</span>}
      {state && (
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px] font-semibold',
          state === 'done' ? 'text-state-complete' : 'text-state-held')}>
          <span aria-hidden className={cn('size-1.5 rounded-full',
            state === 'done' ? 'bg-state-complete' : 'bg-state-held')} />
          {t(state === 'done' ? 'contractorDocs.approved' : 'contractorDocs.open')}
        </span>
      )}
      {action && (
        <span className="shrink-0 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-[11px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c]">
          {action}
        </span>
      )}
    </div>
  );
}

/** One person in the "who can see these" rail. */
function SeenBy({ initials, name, role }: { initials: string; name: string; role: string }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-brand-border-grey py-2.5 first:border-t-0 dark:border-[#2c2c2c]">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-border-grey text-[10px] font-bold text-brand-mid-grey dark:border-[#2c2c2c]">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-brand-near-black dark:text-white">{name}</span>
        <span className="block text-[11px] text-brand-mid-grey">{role}</span>
      </span>
    </div>
  );
}

/** A figure that is already a string — the ledger's own currency, not a conversion. */
function FigureText({ label, value, hint, tone }: {
  label: string; value: string | null; hint?: string; tone?: 'complete';
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{label}</p>
      <p className={cn('mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight',
        tone === 'complete' && value ? 'text-state-complete' : 'text-brand-near-black dark:text-white')}>
        {/* A dash, not a zero: an unreadable ledger has not told us nothing moved. */}
        {value ?? '—'}
      </p>
      {hint && <p className="mt-1 text-xs text-brand-mid-grey">{hint}</p>}
    </div>
  );
}
