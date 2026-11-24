import { ProjectCloseoutPanel } from '@/components/project/ProjectCloseoutPanel';
import { ProjectPaymentHistory } from '@/components/project/ProjectPaymentHistory';
import { ProjectBackLink } from '@/components/project/ProjectBackLink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { useProjectNotificationFocus } from '@/hooks/useProjectNotificationFocus';
import { Camera, Check, FileText, Loader2, Lock, MessageSquare, Plus, Search, Send, Split, Upload, UserRound, X } from 'lucide-react';
import {
  fetchAssignedProject, fetchSubstages, fetchProjectDocuments, fetchRework, fetchMyPayments,
  submitSiteUpdate,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import type { ProjectRow, ProjectSubstageRow, ProjectDocumentRow } from '@/types/project';
import { fetchProjectViewers, type ProjectViewer } from '@/lib/supabase/project-viewers';
import { getSignedDocumentUrl } from '@/lib/supabase/documents';
import { fetchProjectCertificates, type IssuedCertificate } from '@/lib/supabase/certificates';
import { EvidenceThumbs } from '@/components/project/EvidenceThumbs';
import { DocumentViewer } from '@/components/project/DocumentViewer';
import { ProjectDocuments } from '@/components/project/ProjectDocuments';
import { ReceiptDecisionDialog } from '@/components/contractor/ReceiptDecisionDialog';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { ProjectMoneyProvider } from '@/lib/budget/project-money-context';
import { ProjectExchangeRateNote } from '@/components/project/ExchangeRateNote';
// The same definition the client's costing page uses. These screens print the same
// payment the client is shown, and until 11 Nov 2026 they disagreed about it by ~3.34%
// on every stage of a bill-of-quantities project — see lib/budget/stage-amounts.ts.
import { stageBasisFor, stagePayableUsd, sumPayableUsd } from '@/lib/budget/stage-amounts';
import { sumBillAmounts, normaliseBudgetInput } from '@/lib/budget/bill-budget';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';
import {
  fetchProjectContractorPaymentState, requestStagePayment,
  type ProjectContractorPaymentState,
} from '@/lib/supabase/contractor-payments';
import { moneyPair, type MoneyPair } from '@/lib/budget/money-pair';
import { formatDate } from '@/lib/format';
import { useStageLabels } from '@/lib/stage-labels';
import { fileProblem, FILE_ACCEPT_ATTR, MAX_FILE_MB } from '@/lib/documents/accepted-files';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { ProjectSharing } from '@/components/project/ProjectSharing';
import { StagePaymentGate } from '@/components/project/StagePaymentGate';
import { ContractorPaymentVerificationBar } from '@/components/project/ContractorPaymentVerificationBar';
import { StageBreakdownPanel } from '@/components/project/StageBreakdownPanel';
import type { StageBreakdownInlineState } from '@/components/project/StageBreakdownPanel';
import { addProjectSubstage } from '@/lib/supabase/stage-breakdown';
import { updateProjectStartingStage } from '@/lib/supabase/tracking';
import { StagePricingPanel } from '@/components/project/StagePricingPanel';
import { fetchStagePayments, type StagePayment } from '@/lib/supabase/verifications';
import { fetchStagePaymentPlan } from '@/lib/supabase/stage-payment-plans';
import { currencyFractionDigits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { ProjectConversations } from '@/components/project/ProjectConversations';
import { ProjectPayoutSummary } from '@/components/project/ProjectPayoutSummary';
import { partWorkReady, useSubstagePayments } from '@/lib/supabase/substage-payments';
import { contractorNextStep, receiptsToConfirm, type ContractorNextStep } from '@/lib/projects/contractor-next-step';
import { paymentOverview } from '@/lib/payments/payment-history';
import { stageReceiptBalance } from '@/lib/payments/stage-receipt-balance';
import { canActOnProjectStage, currentProjectStage, stagePaymentAcknowledged, stageWorkReady, canSubmitStageReceipt, stageStartsWithEvidence } from '@/lib/projects/stage-progression';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';

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
  const { access: teamAccess, error: teamError, refresh: refreshTeam } = useProjectTeamAccess(projectId ?? '');
  const { stageLabel, substageLabel } = useStageLabels();

  const [assigned, setAssigned] = useState<AssignedProject | null | 'denied'>(null);
  const [substages, setSubstages] = useState<ProjectSubstageRow[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentRow[]>([]);
  /**
   * Did the price come from an uploaded bill of quantities?
   *
   * Read off the documents this route already loads for the Documents tab, so the
   * money screens cost no extra request. It is the one signal that decides whether a
   * stage percentage is a share of the project total or of construction alone — and it
   * is deliberately NOT inferred from the stages: a project can join mid-build without
   * a bill, or arrive with a bill and no history, and the two say nothing about
   * each other.
   */
  const hasBoq = assigned && assigned !== 'denied' && assigned.project.budget_source != null
    ? assigned.project.budget_source === 'boq' : documents.some(d => d.category === 'boq');
  const [rework, setRework] = useState<ReworkItem[]>([]);
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  /** Incoming tranches per stage (175). Distinct from `payments` above, which is
   *  this contractor's own OUTGOING ledger — opposite direction, opposite person. */
  const [stagePayments, setStagePayments] = useState<Map<string, StagePayment>>(new Map());
  const [searchParams, setSearchParams] = useSearchParams();
  useProjectNotificationFocus(projectId, searchParams.toString());
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
  /** The stage open in the Work tab's detail panel; null follows the current stage. */
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  /** The receipt in the "Did this payment arrive?" dialog. */
  const [reviewing, setReviewing] = useState<{ stageId: string; receiptId: string } | null>(null);

  const loadSequence = useRef(0);
  const activeProject = useRef<string | null | undefined>(projectId); activeProject.current = projectId;
  const load = useCallback(async () => {
    if (!projectId) return;
    const sequence = ++loadSequence.current;
    const isCurrent = () => activeProject.current === projectId && loadSequence.current === sequence;
    // A project that is not yours returns no row under RLS — the same answer as one that
    // does not exist, which is the answer it should get.
    const a = await fetchAssignedProject(projectId).catch(() => null);
    if (!isCurrent()) return;
    if (!a) { setAssigned('denied'); return; }
    const [subs, docs, rw, pay, stagePay] = await Promise.all([
      fetchSubstages(projectId).catch(() => []),
      fetchProjectDocuments(projectId).catch(() => []),
      fetchRework([a]).catch(() => []),
      fetchMyPayments().catch(() => ({ rows: [], available: false })),
      fetchStagePayments(projectId).catch(() => new Map<string, StagePayment>()),
    ]);
    if (!isCurrent()) return;
    setAssigned(a);
    setSubstages(subs);
    setDocuments(docs);
    setRework(rw);
    setPayments({ ...pay, rows: pay.rows.filter(r => r.projectId === projectId) });
    setStagePayments(stagePay);
    if (typeof window !== 'undefined') window.dispatchEvent?.(new Event('groundwork:project-action'));
  }, [projectId]);

  useEffect(() => {
    activeProject.current = projectId;
    setAssigned(null);
    setSubstages([]);
    setDocuments([]);
    setRework([]);
    setPayments(null);
    setStagePayments(new Map());
    setSelectedStageId(null);
    setReviewing(null);
    void load();
    return () => { activeProject.current = null; ++loadSequence.current; };
  }, [load, projectId]);
  useEffect(() => {
    if (!projectId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void load();
      }, 250);
    };
    const channel = supabase.channel(`contractor-project-money-${projectId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stages', filter: `project_id=eq.${projectId}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_substages', filter: `project_id=eq.${projectId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `project_id=eq.${projectId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_payment_receipts', filter: `project_id=eq.${projectId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'substage_payment_requests', filter: `project_id=eq.${projectId}` }, scheduleRefresh)
      .subscribe();
    window.addEventListener('focus', scheduleRefresh);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('focus', scheduleRefresh);
      void supabase.removeChannel(channel);
    };
  }, [projectId, load]);

  const activeSubstages = useMemo(
    () => (assigned && assigned !== 'denied' && assigned.activeStage
      ? substages.filter(s => s.stage_id === assigned.activeStage!.id)
      : []),
    [assigned, substages],
  );

  // RLS also permits observers to read this project. A global contractor account
  // does not establish a work assignment on this particular build.
  if (teamAccess && !teamAccess.assignedContractor && projectId) {
    return <Navigate to={`/projects/${projectId}`} replace />;
  }
  if (teamError && assigned !== 'denied') {
    return <div className="flex flex-col items-start gap-4">
      <Back />
      <p role="alert" className="text-sm text-state-alert">{t('teamAccess.loadFailed')}</p>
      <button type="button" className="text-sm underline underline-offset-4" onClick={() => { void refreshTeam(); }}>{t('common.retry')}</button>
    </div>;
  }
  if (assigned === null || (assigned !== 'denied' && assigned.project.id !== projectId) || (!teamAccess && assigned !== 'denied')) {
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

  const { project, stages, completedStages, totalStages } = assigned;
  const current = currentProjectStage(stages);
  const place = [project.city, project.country].filter(Boolean).join(', ');
  const canDecide = (stage: (typeof stages)[number]) =>
    receiptDecisionAllowed(project, stages, stage, teamAccess?.primaryContractor === true, stagePayments.get(stage.id));
  const waitingReceiptsCount = receiptsToConfirm(stages, stagePayments, canDecide).length;
  const reviewStage = reviewing ? stages.find(stage => stage.id === reviewing.stageId) : undefined;
  const reviewPayment = reviewStage ? stagePayments.get(reviewStage.id) : undefined;
  const reviewReceipt = reviewPayment?.receipts?.find(receipt => receipt.id === reviewing?.receiptId);
  const openStage = (stageId: string) => {
    setSelectedStageId(stageId); setTab('work');
    if (typeof window !== 'undefined') window.setTimeout(() => document.getElementById('work-stage-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return (
    <div className="flex flex-col gap-5">
      <Back />

      {/* 18 Nov redesign (docs/mockups/2026-11-18-contractor-project): the calm layout the
          homeowner's project view uses. Place, name, where the build stands, one way to
          reach the homeowner. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl flex-1 basis-full sm:basis-auto">
          {place && <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-mid-grey">{place}</p>}
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-brand-near-black sm:text-[28px] dark:text-white">{project.name}</h1>
          {totalStages > 0 && <p className="mt-2 text-[13px] text-brand-mid-grey">
            {current ? t('contractorView.stageOfTotal', { n: current.stage_number, total: totalStages, name: stageLabel(current) })
              : t('contractor.projects.stageOf', { n: completedStages, total: totalStages })}</p>}
          {stages.length > 0 && <StageSegments stages={stages} currentId={current?.id} />}
        </div>
        <button type="button" onClick={() => setTab('messages')} data-action="message-homeowner"
          className="inline-flex items-center gap-2 rounded-xl border border-brand-border-grey bg-white px-4 py-2.5 text-sm font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          <MessageSquare className="size-4" aria-hidden />{t('contractorView.messageHomeowner')}
        </button>
      </header>

      {/* Five tabs do not fit across 390px, and a clipped row would put People out
          of reach on the phone the work is actually done on. The row scrolls; the
          page does not. */}
      <nav className="-mx-1 flex gap-1.5 overflow-x-auto border-b border-brand-border-grey px-1 pb-3 [scrollbar-width:none] dark:border-[#2c2c2c] [&::-webkit-scrollbar]:hidden">
        {TABS.map(x => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)} aria-current={tab === x.id ? 'page' : undefined} data-tab={x.id}
                  className={cn('shrink-0 whitespace-nowrap rounded-[10px] px-3.5 py-2 text-sm font-semibold transition-colors',
                    tab === x.id
                      ? 'bg-brand-green text-white'
                      : 'text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#1e1e1e] dark:hover:text-white')}>
            {t(x.key)}
            {x.id === 'money' && waitingReceiptsCount > 0 && (
              <span data-money-badge className={cn('ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-bold leading-none',
                tab === 'money' ? 'bg-white/20 text-white' : 'bg-state-held/15 text-state-held')}>
                {waitingReceiptsCount}
              </span>
            )}
            {x.id === 'documents' && documents.length > 0 && <span className="ml-1 font-mono text-[11px] opacity-70">{documents.length}</span>}
            {/* Not a count and not a second list: just "there is something on Work". */}
            {x.id === 'work' && rework.length > 0 && (
              <span aria-label={t('contractor.needsAction.title')}
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-state-alert align-middle" />
            )}
          </button>
        ))}
      </nav>

      {tab === 'work' && (
        <ProjectCloseoutPanel key={`closeout:${project.id}`} projectId={project.id} refreshKey={stagePayments}
          stageName={stageId => { const stage = assigned.stages.find(row => row.id === stageId); return stage ? stageLabel(stage) : ''; }}
          onViewStage={openStage} onClosed={load} />
      )}
      {tab === 'work' && (
        <WorkTab
          key={`work:${project.id}`}
          hasBoq={hasBoq}
          assigned={assigned} substages={substages} rework={rework}
          isOwner={user?.id === project.user_id}
          canConfirmPayments={teamAccess?.primaryContractor === true}
          stagePayments={stagePayments}
          onSubmitted={load}
          selectedStageId={selectedStageId} onSelectStage={setSelectedStageId}
          canDecide={canDecide} onReviewReceipt={(stageId, receiptId) => setReviewing({ stageId, receiptId })}
          onMessage={() => setTab('messages')}
          inviteHomeowner={teamAccess?.canInviteClient === true && teamAccess.hasClientInvitation !== true}
        />
      )}

      {tab === 'documents' && (
        <ProjectDocuments
          key={`docs:${assigned.project.id}`}
          projectId={assigned.project.id}
          stages={assigned.stages}
          documents={documents}
        />
      )}

      {tab === 'money' && (
        <div className="space-y-4">
          <StagePricingPanel key={`pricing:${project.id}`} project={project} onChanged={load} />
          <MoneyTab key={`money:${project.id}`} assigned={assigned} payments={payments} stagePayments={stagePayments} hasBoq={hasBoq} substages={substages}
            canDecide={canDecide} onReviewReceipt={(stageId, receiptId) => setReviewing({ stageId, receiptId })} onOpenStage={openStage} />
        </div>
      )}

      {tab === 'people' && (
        <PeopleTab key={`people:${project.id}`} project={project} isOwner={user?.id === project.user_id} />
      )}

      {tab === 'messages' && (
        <ProjectConversations key={`chat:${project.id}`} projectId={project.id} projectName={project.name} />
      )}

      {reviewStage && reviewPayment && reviewReceipt && canDecide(reviewStage) && (
        <ReceiptReviewHost project={project} stage={reviewStage} payment={reviewPayment} receipt={reviewReceipt}
          stageName={`${t('project.stages.stageN', { n: reviewStage.stage_number })} \u00b7 ${stageLabel(reviewStage)}`}
          onClose={() => setReviewing(null)} onDecided={load} />
      )}
    </div>
  );
}

/**
 * May this contractor decide on a receipt for this stage? The same gate the stage payment
 * panel applies before it offers a review: the primary contractor, on a project that is
 * open (or a stage already complete), and a stage whose receipts can be submitted.
 */
function receiptDecisionAllowed(
  project: ProjectRow,
  stages: AssignedProject['stages'],
  stage: AssignedProject['stages'][number],
  primaryContractor: boolean,
  stagePayment?: StagePayment,
) {
  const hasSubmittedReceipt = !!(stagePayment?.receipts?.some(r => !r.replacedBy) || stagePayment?.receiptPath);
  return primaryContractor && !stage.pre_existing && project.status !== 'archived'
    && (project.status === 'active' || stage.status === 'complete')
    && canSubmitStageReceipt(stage, stages, project.workflow_origin, hasSubmittedReceipt);
}

/** The ten stages as one segmented bar: done, current, still to come. */
function StageSegments({ stages, currentId }: { stages: AssignedProject['stages']; currentId?: string }) {
  return (
    <div aria-hidden className="mt-2 flex gap-1">
      {[...stages].sort((a, b) => a.stage_number - b.stage_number).map(stage => (
        <i key={stage.id} className={cn('h-[5px] flex-1 rounded-full',
          stage.status === 'complete' ? 'bg-brand-green' : stage.id === currentId ? 'bg-brand-green/45' : 'bg-brand-border-grey dark:bg-[#2c2c2c]')} />
      ))}
    </div>
  );
}

/** Holds the project's money basis for the dialog, so the page itself adds no hooks. */
function ReceiptReviewHost({ project, stage, payment, receipt, stageName, onClose, onDecided }: {
  project: ProjectRow; stage: AssignedProject['stages'][number]; payment: StagePayment;
  receipt: NonNullable<StagePayment['receipts']>[number]; stageName: string;
  onClose: () => void; onDecided: () => void | Promise<void>;
}) {
  const money = useProjectMoney(project);
  return <ReceiptDecisionDialog receipt={receipt} payment={payment} stage={stage} projectName={project.name} stageName={stageName}
    currency={money.code} rate={money.budgetRate ?? money.rate} onClose={onClose} onDecided={onDecided} />;
}

function Back() {
  return <ProjectBackLink fallbackRole="contractor" />;
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
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-green px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover">
                <Camera className="size-4" aria-hidden />
                {t('contractorSubmit.takePhoto')}
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                       onChange={e => addFiles(e)} />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-brand-border-grey bg-white px-3.5 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
                <Upload className="size-4" aria-hidden />
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

          {/* A file is required, not merely one of file-or-note. Philip, 30 Oct 2026:
              "a photo or a file must be added alongside a note before the submit
              button should work." An item ticks itself when a file lands against it,
              so a note-only update would tick an item with nothing to look at —
              exactly the thing the checklist is supposed to make impossible. */}
          <button type="button" disabled={busy || files.length === 0}
                  onClick={submit}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-hover disabled:opacity-40 sm:w-fit">
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
function MoneyTab({ assigned, payments, stagePayments, hasBoq, substages, canDecide, onReviewReceipt, onOpenStage }: {
  hasBoq: boolean;
  substages: ProjectSubstageRow[];
  assigned: AssignedProject;
  payments: { rows: ContractorPayment[]; available: boolean } | null;
  stagePayments: Map<string, StagePayment>;
  canDecide: (stage: AssignedProject['stages'][number]) => boolean;
  onReviewReceipt: (stageId: string, receiptId: string) => void;
  onOpenStage: (stageId: string) => void;
}) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project);
  const { stages } = assigned;

  /**
   * Three facts, kept apart (30 Oct 2026; laid out to the 18 Nov redesign).
   *
   * The CONTRACT and what is STILL TO COME come from the schedule, which is what
   * Groundwork governs. What the contractor CONFIRMED RECEIVING comes from the
   * homeowner's receipts the contractor confirmed, by the same rule the stage cards and
   * the homeowner's payment history use. Transfers a payment provider made come from
   * the LEDGER, the only record of money a provider moved, and show only when there are
   * some.
   *
   * Approved is not paid: a stage signed off this morning and not yet paid is never
   * counted as money received. And `pre_existing` stages, finished before the build
   * joined Groundwork, are worth something and owed nothing.
   */
  const basis = stageBasisFor(assigned.project, stages, hasBoq);
  // PAYABLE, not schedule: a pre-existing stage is worth something and is owed nothing.
  const sum = (list: typeof stages) => sumPayableUsd(list, basis);

  const outstanding = stages.filter(s => s.status !== 'complete');

  const contract = money.pair(assigned.project.budget_source === 'boq' ? assigned.project.budget_usd : sum(stages), assigned.project.budget_amount);
  const toCome   = money.pair(sum(outstanding), assigned.project.budget_precision != null
    ? sumBillAmounts(outstanding.map(s => s.milestone_amount), assigned.project.budget_precision) : null);
  const overview = paymentOverview(stages, stagePayments, money.code, money.budgetRate ?? money.rate);
  const confirmed = overview.received == null ? null
    : `${overview.received.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${money.code}`;

  /** What the ledger says reached this contractor on this project. */
  const ledger = payments?.available ? payments.rows : null;
  const ledgerCodes = new Set((ledger ?? []).map(r => r.currency.toUpperCase()));
  const releasedLabel = ledger === null ? null
    : ledger.length === 0 ? money.pair(0)?.local ?? null
    : ledgerCodes.size === 1
      ? moneyPair(ledger.reduce((n, r) => n + r.amount, 0), [...ledgerCodes][0], null).local
      // More than one currency: a sum would be a number that means nothing.
      : null;

  const waiting = receiptsToConfirm(stages, stagePayments, canDecide);
  const first = waiting[0];
  const firstStage = first ? stages.find(stage => stage.id === first.stageId) : undefined;
  const firstPart = first?.receipt.substageId ? substages.find(row => row.id === first.receipt.substageId) : undefined;

  const figures = [
    { key: 'contract', label: t('contractorMoney.contractValue'), value: contract?.local ?? '\u2014', sub: t('contractorView.contractSub', { n: stages.length }) },
    { key: 'confirmed', label: t('project.historyView.confirmed'), value: confirmed ?? '\u2014', sub: t('contractorView.confirmedSub'), dot: true },
    { key: 'toCome', label: t('contractorMoney.stillToCome'), value: toCome?.local ?? '\u2014', sub: t('contractorMoney.stagesToCome', { n: outstanding.length }) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {first && firstStage && (
        <section data-needs-you className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-state-held bg-state-held/[0.06] p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-state-held">{t('contractorView.needsYou')}</p>
            <p className="mt-0.5 text-[15px] font-bold text-brand-near-black dark:text-white">
              {t('contractorView.receiptToConfirmAmount', { amount: `${(first.receipt.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${first.receipt.currency ?? ''}`.trim() })}</p>
            <p className="mt-0.5 text-[12.5px] text-brand-mid-grey">
              {[`${t('project.stages.stageN', { n: firstStage.stage_number })} \u00b7 ${stageLabel(firstStage)}`,
                firstPart ? t('project.historyView.part', { n: firstPart.substage_number, name: substageLabel(firstPart) }) : null,
                formatDate(first.receipt.submittedAt)].filter(Boolean).join(' \u00b7 ')}
              {waiting.length > 1 && <span className="block">{t('contractorView.moreToConfirm', { n: waiting.length - 1 })}</span>}
            </p>
          </div>
          <button type="button" onClick={() => onReviewReceipt(first.stageId, first.receipt.id)} data-action="needs-you-review"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover">
            {t('contractorView.reviewReceipt')}</button>
        </section>
      )}

      <dl className="grid divide-y divide-brand-border-grey rounded-2xl border border-brand-border-grey bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-[#2c2c2c] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        {figures.map(figure => (
          <div key={figure.key} data-figure={figure.key} className="flex items-baseline justify-between gap-3 px-4 py-3 sm:block sm:px-5 sm:py-4">
            <dt className="flex items-center gap-2 text-xs text-brand-mid-grey">{figure.dot && <span aria-hidden className="size-1.5 rounded-full bg-state-complete" />}{figure.label}</dt>
            <dd className="text-right sm:text-left">
              <span className="font-mono text-[15px] font-semibold tabular-nums text-brand-near-black sm:mt-1.5 sm:block sm:text-xl dark:text-white">{figure.value}</span>
              <span className="mt-1 hidden text-[11.5px] text-brand-mid-grey sm:block">{figure.sub}</span>
            </dd>
          </div>
        ))}
      </dl>
      <ProjectExchangeRateNote money={money}/>

      <ProjectPaymentHistory stagePayments={stagePayments} projectCurrency={money.code} stages={stages} substages={substages}
        layout="full" summary={false} projectRate={money.budgetRate ?? money.rate} onOpenStage={onOpenStage}
        onReview={receiptId => { const hit = waiting.find(row => row.receipt.id === receiptId); if (hit) onReviewReceipt(hit.stageId, receiptId); }}
        stageName={stageId => { const stage = stages.find(row => row.id === stageId); return stage ? stageLabel(stage) : ''; }} />

      {/* Transfers a payment provider made, when there are any. Three states stay apart:
          an unreadable ledger, a readable empty one, and rows. */}
      {ledger !== null && ledger.length > 0 && (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold text-brand-near-black dark:text-white">{t('contractorView.transfersToYou')}</h2>
            <span className="font-mono text-sm font-semibold tabular-nums">{releasedLabel ?? '\u2014'}</span>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {ledger.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-brand-near-black dark:text-white">{p.note ?? t('contractorPayments.milestone')}</span>
                  <span className="block text-[11px] text-brand-mid-grey">{formatDate(p.createdAt)}</span>
                </span>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{moneyPair(p.amount, p.currency, null).local}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PeopleTab({ project, isOwner }: { project: ProjectRow; isOwner: boolean }) {
  const t = useT();
  const { access } = useProjectTeamAccess(project.id);
  const [viewers, setViewers] = useState<ProjectViewer[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProjectViewers(project.id)
      .then(rows => { if (alive) setViewers(rows); })
      .catch(() => { if (alive) setViewers([]); });
    return () => { alive = false; };
  }, [project.id, access]);

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
    { label: t('contractorPeople.canInvite'),  you: access?.canInvite === true, client: true },
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
                    {(v.email || t('projectLinks.title')).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-brand-near-black dark:text-white">{v.email || t('projectLinks.title')}</span>
                    <span className="block text-xs text-brand-mid-grey">
                      {v.acceptedAt
                        ? t('contractorPeople.accepted', { date: formatDate(v.acceptedAt) })
                        : t('contractorPeople.invitedNotOpened', { date: formatDate(v.invitedAt) })}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-[11px] font-semibold',
                    v.acceptedAt ? 'text-state-complete' : 'text-state-held')}>
                    {t(v.isClient ? 'teamAccess.primaryClient' : 'teamAccess.observer')}{!v.acceptedAt && ` · ${t('contractorPeople.pending')}`}
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
        <ProjectSharing projectId={project.id} projectName={project.name} />
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
function WorkTab({ assigned, substages, rework, isOwner, canConfirmPayments, stagePayments, onSubmitted, hasBoq,
  selectedStageId, onSelectStage, canDecide, onReviewReceipt, onMessage, inviteHomeowner }: {
  hasBoq: boolean;
  assigned: AssignedProject;
  substages: ProjectSubstageRow[];
  rework: ReworkItem[];
  isOwner: boolean;
  canConfirmPayments: boolean;
  /** Incoming tranches per stage, so a stage can show the homeowner's receipts (175). */
  stagePayments: Map<string, StagePayment>;
  onSubmitted: () => Promise<void> | void;
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
  canDecide: (stage: AssignedProject['stages'][number]) => boolean;
  onReviewReceipt: (stageId: string, receiptId: string) => void;
  onMessage: () => void;
  /** The homeowner has not been invited and this contractor may invite them. */
  inviteHomeowner: boolean;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const { stageLabel, substageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project);
  const { project, stages } = assigned;
  const current = currentProjectStage(stages);
  const activeStage = current && (current.status === 'active' || current.status === 'pending_review') ? current : undefined;
  const activeParts = useSubstagePayments(activeStage?.id, !!activeStage?.paid_by_part, activeStage ? stagePayments.get(activeStage.id) : undefined);
  const basis = stageBasisFor(project, stages, hasBoq);
  /** The item whose Upload was pressed; null means no form is open. */
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  /** Per-substage "Request payment" inline dropdown state (19 Nov). */
  const [requestPayFor, setRequestPayFor] = useState<string | null>(null);
  const [requestAmount, setRequestAmount] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [contractorPayState, setContractorPayState] = useState<ProjectContractorPaymentState | null>(null);
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const reloadContractorPayState = useCallback(async () => {
    const pid = project.id;
    try {
      const nextState = await fetchProjectContractorPaymentState(pid);
      if (currentProjectId.current === pid) setContractorPayState(nextState);
    } catch {
      // Non-blocking: table/RPC may not be populated in older environments or test mocks.
    }
  }, [project.id]);
  const loadedPayStateFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedPayStateFor.current !== project.id) {
      loadedPayStateFor.current = project.id;
      setContractorPayState(null);
    }
    void reloadContractorPayState();
  }, [project.id, reloadContractorPayState, stagePayments]);
  const stageParams = new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search ?? '');
  const linkedStage = stageParams.get('stage_id') ?? stageParams.get('stage');
  const ordered = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);
  const selected = ordered.find(stage => stage.id === selectedStageId)
    ?? ordered.find(stage => stage.id === linkedStage || String(stage.stage_number) === linkedStage)
    ?? current ?? ordered[0];
  const isRowPaidUpfront = (row: AssignedProject['stages'][number]) =>
    !!contractorPayState?.verifiedStageIds.has(row.id)
    || (contractorPayState?.initialPayment?.covered_stages?.includes(row.stage_number) ?? false);
  const selectedPaidUpfront = !!selected && isRowPaidUpfront(selected);
  const isOpen = !!selected && (selected.id === activeStage?.id || (selected.status === 'active' && selectedPaidUpfront));
  // One read of the parts per stage: the open stage's is shared with the next step.
  const otherParts = useSubstagePayments(selected && !isOpen ? selected.id : undefined, !!selected?.paid_by_part, selected ? stagePayments.get(selected.id) : undefined);
  const parts = isOpen ? activeParts : otherParts;
  const scrolledStage = useRef('');
  useEffect(() => {
    if (!linkedStage) { scrolledStage.current = ''; return; }
    const key = `${project.id}:${linkedStage}`;
    if (scrolledStage.current === key || typeof document === 'undefined') return;
    const target = document.getElementById('work-stage-detail');
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); scrolledStage.current = key; }
  }, [project.id, linkedStage, stages]);

  const [carriedInByStage, setCarriedInByStage] = useState<{ stageId: string; amount: number }>({ stageId: '', amount: 0 });
  const [addingSubstage, setAddingSubstage] = useState(false);
  const [newSubstageName, setNewSubstageName] = useState('');
  const [addSubstageBusy, setAddSubstageBusy] = useState(false);
  const [addSubstageError, setAddSubstageError] = useState<string | null>(null);
  const [openBreakdownAddSignal, setOpenBreakdownAddSignal] = useState(0);
  const [breakdownCtrl, setBreakdownCtrl] = useState<StageBreakdownInlineState | null>(null);
  const [editingStartStage, setEditingStartStage] = useState(false);
  const [nextStartStage, setNextStartStage] = useState(1);
  const [confirmStartStage, setConfirmStartStage] = useState(false);
  const [savingStartStage, setSavingStartStage] = useState(false);
  const [startStageError, setStartStageError] = useState<string | null>(null);
  useEffect(() => {
    setEditingStartStage(false);
    setConfirmStartStage(false);
    setStartStageError(null);
  }, [project.id]);
  const selectedIdForPlan = selected?.id ?? '';
  useEffect(() => {
    setAddingSubstage(false);
    setNewSubstageName('');
    setAddSubstageError(null);
  }, [selectedIdForPlan]);
  const selectedTrancheRef = selected ? stagePayments.get(selected.id) : undefined;
  useEffect(() => {
    if (!selectedIdForPlan) { setCarriedInByStage({ stageId: '', amount: 0 }); return; }
    let alive = true;
    void fetchStagePaymentPlan(selectedIdForPlan)
      .then(ctx => {
        if (alive) setCarriedInByStage({ stageId: selectedIdForPlan, amount: Math.max(0, Number(ctx.carried_in ?? 0)) });
      })
      .catch(() => {
        if (alive) setCarriedInByStage(prev => prev.stageId === selectedIdForPlan ? prev : { stageId: selectedIdForPlan, amount: 0 });
      });
    return () => { alive = false; };
  }, [selectedIdForPlan, selectedTrancheRef]);

  if (!selected) {
    return (
      <section className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">
          {t('contractor.projects.noStages')}
        </p>
      </section>
    );
  }

  const fxRate = money.budgetRate ?? money.rate;
  const itemsOf = (stageId: string) => substages.filter(item => item.stage_id === stageId).sort((a, b) => a.substage_number - b.substage_number);
  const waitingOn = (stage: AssignedProject['stages'][number]) => canDecide(stage)
    ? (stagePayments.get(stage.id)?.receipts ?? []).filter(receipt => receipt.decision === 'pending' && !receipt.replacedBy) : [];

  // The work rules, unchanged from the accordion this replaces: a stage takes updates
  // when the project is active, the stage is reachable and its money is confirmed; a
  // stage paid by part takes them only on the part that is paid (18 Nov).
  const workFor = (stage: AssignedProject['stages'][number], open: boolean) => {
    const tranche = stagePayments.get(stage.id);
    const upfront = isRowPaidUpfront(stage);
    const funded = upfront || stageWorkReady(stage, stages, tranche, project.workflow_origin);
    const canWork = open && project.status === 'active' && (upfront || canActOnProjectStage(stage, stages)) && funded;
    // Why Upload is off, in words. The button used to go quiet with no cue at all —
    // a contractor on 14 Nov 2026 reported it "not clicking" on a stage whose
    // approved updates were waiting on the client's payment.
    const blocked: 'paused' | 'previous' | 'payment' | null = canWork ? null
      : project.status !== 'active' ? 'paused'
      : !(upfront || canActOnProjectStage(stage, stages)) ? 'previous'
      : 'payment';
    const blockedText = blocked === null ? null
      : blocked === 'paused' ? t('contractorProject.uploadPaused')
      : blocked === 'previous' ? t('contractorProject.uploadPreviousFirst')
      : stage.review_payment_pending ? t('contractorProject.uploadAwaitingPayment')
      : t('project.stages.paymentBeforeWork');
    return { tranche, canWork, blocked, blockedText };
  };

  const activeWork = activeStage ? workFor(activeStage, true) : null;
  const next: ContractorNextStep | null = contractorNextStep({
    stages, current: activeStage, stagePayments, canDecide, inviteHomeowner,
    items: activeStage ? itemsOf(activeStage.id) : [],
    canUploadItem: itemId => !!activeWork?.canWork && partWorkReady(activeParts, !!activeStage?.paid_by_part, itemId),
    uploadBlocked: activeWork?.blocked ?? null,
  });
  const nameOf = (stageId: string, substageId?: string | null) => {
    const stage = stages.find(row => row.id === stageId);
    const part = substageId ? substages.find(row => row.id === substageId) : null;
    if (part) return t('project.historyView.part', { n: part.substage_number, name: substageLabel(part) });
    return stage ? `${t('project.stages.stageN', { n: stage.stage_number })} · ${stageLabel(stage)}` : '';
  };
  const startUpload = (stageId: string, itemId: string) => {
    onSelectStage(stageId); setUploadFor(itemId);
    if (typeof window !== 'undefined') window.setTimeout(() => document.getElementById(`substage-${itemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };
  const nextCard = next && (() => {
    const receiptMoney = next.kind === 'receipt' ? `${(next.receipt.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${next.receipt.currency ?? ''}`.trim() : '';
    const title = next.kind === 'receipt' ? t('contractorView.nextReceipt', { what: nameOf(next.stageId, next.receipt.substageId) })
      : next.kind === 'invite' ? t('contractorView.nextInvite')
      : next.kind === 'upload' ? t('contractorView.nextUpload', { what: activeStage?.paid_by_part ? nameOf(next.stageId, next.itemId) : substageLabel(substages.find(row => row.id === next.itemId) ?? { name: '', substage_key: null }) })
      : next.kind === 'awaitReview' ? t('contractorView.nextAwaitReview', { n: next.stageNumber })
      : t('contractorView.nextAwaitPayment', { n: next.stageNumber });
    const body = next.kind === 'receipt' ? t('contractorView.nextReceiptBody', { amount: receiptMoney })
      : next.kind === 'invite' ? t('contractorView.nextInviteBody')
      : next.kind === 'upload' ? t('contractorView.nextUploadBody')
      : next.kind === 'awaitReview' ? t('contractorView.nextAwaitReviewBody')
      : t('contractorView.nextAwaitPaymentBody');
    const action = next.kind === 'receipt' ? { label: t('contractorView.reviewReceipt'), run: () => onReviewReceipt(next.stageId, next.receipt.id) }
      : next.kind === 'invite' ? { label: t('contractorView.invite'), run: () => document.getElementById('work-invite')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
      : next.kind === 'upload' ? { label: t('contractorView.uploadUpdates'), run: () => startUpload(next.stageId, next.itemId) }
      : { label: t('contractorView.messageHomeowner'), run: onMessage };
    return (
      <section data-next-step={next.kind} className="flex flex-col gap-4 rounded-2xl bg-brand-green px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/75">{t('contractorView.nextStep')}</p>
          <p className="mt-0.5 text-lg font-bold leading-snug sm:text-xl">{title}</p>
          <p className="mt-1 text-[13px] text-white/85">{body}</p>
        </div>
        <button type="button" onClick={action.run} data-action={`next-${next.kind}`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-green hover:bg-white/90">
          {next.kind === 'upload' && <Camera className="size-4" aria-hidden />}{action.label}
        </button>
      </section>
    );
  })();

  // ---- the selected stage
  const stage = selected;
  const items = itemsOf(stage.id);
  const due = money.pair(stagePayableUsd(stage, basis), stage.milestone_amount);
  const sent = rework.filter(r => r.stageId === stage.id);
  const { tranche, canWork, blockedText } = workFor(stage, isOpen);
  const stagePaidUpfront =
    isRowPaidUpfront(stage)
    || (tranche != null && stageReceiptBalance(tranche, money.code, fxRate, stage.milestone_amount).remaining === 0
      && (stageReceiptBalance(tranche, money.code, fxRate, stage.milestone_amount).received ?? 0) > 0);
  const showGate = !stage.pre_existing && (canActOnProjectStage(stage, stages) || stage.status === 'complete' || isRowPaidUpfront(stage)) && !!tranche;
  const liveStageReceipts = (tranche?.receipts ?? []).filter(r => !r.replacedBy);
  const stageCarriedIn = carriedInByStage.stageId === stage.id ? carriedInByStage.amount : 0;
  const stageTotalLocal = stage.milestone_amount != null && Number.isFinite(Number(stage.milestone_amount))
    ? Number(stage.milestone_amount)
    : stagePayableUsd(stage, basis) * fxRate;
  const balance = tranche ? stageReceiptBalance(tranche, money.code, fxRate, stage.milestone_amount) : null;
  const split = !!stage.paid_by_part && !!parts?.split;
  const partReady = (substageId: string) => partWorkReady(parts, !!stage.paid_by_part && isOpen, substageId);
  const waiting = waitingOn(stage);
  const canRequestSubstagePayment =
    canConfirmPayments && !stage.pre_existing && stage.status !== 'complete'
    && stagePayableUsd(stage, basis) > 0 && !stagePaidUpfront;
  // Carried-over overpayment automatically covers early substages in order until exhausted (19 Nov).
  const isCoveredByCarryover = (index: number, part: { paid?: boolean } | undefined) => {
    if (stageCarriedIn <= 0) return false;
    if (split) return !!part?.paid;
    if (items.length === 0 || stageTotalLocal <= 0) return false;
    const share = stageTotalLocal / items.length;
    return stageCarriedIn > index * share;
  };
  const openRequestFor = (substageId: string) =>
    contractorPayState?.requests.find(r => r.stage_id === stage.id && r.substage_id === substageId);
  async function submitSubstagePaymentRequest(substageId: string) {
    if (requestBusy) return;
    const parsed = canonicalReceiptAmount(requestAmount.trim());
    if (!parsed) {
      setRequestError(t('project.stages.receiptAmountInvalid'));
      return;
    }
    setRequestBusy(true);
    setRequestError(null);
    try {
      await requestStagePayment({
        stageId: stage.id,
        substageId,
        amount: Number(parsed),
        currency: money.code,
        note: requestNote,
      });
      setRequestPayFor(null);
      setRequestAmount('');
      setRequestNote('');
      await reloadContractorPayState();
    } catch (err) {
      setRequestError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setRequestBusy(false);
    }
  }
  // Price by part (18 Nov; inline per-substage mode 23 Nov): each part is paid before its work,
  // so the contractor edits prices right on the single substage checklist instead of a duplicated
  // table below. The server decides who may propose; the panel stays quiet when nothing is active.
  const priceable = !stage.pre_existing && stage.status !== 'complete' && stagePayableUsd(stage, basis) > 0;
  const breakdown = priceable
    ? <div id="stage-breakdown-section" data-tour={isOpen ? 'price-by-part' : undefined}>
        <StageBreakdownPanel stageId={stage.id} projectName={project.name ?? ''} isContractor hidden={stagePaidUpfront}
          inlineRows onInlineState={setBreakdownCtrl} openAddPartSignal={openBreakdownAddSignal} onDiscussPrice={onMessage} onChanged={onSubmitted}
          stageName={`${t('project.stages.stageN', { n: stage.stage_number })} · ${stageLabel(stage)}`} />
      </div>
    : null;
  const activeBreakdown = breakdownCtrl?.stageId === stage.id && !stagePaidUpfront ? breakdownCtrl : null;
  const isEditingPrices = !!activeBreakdown?.editing;
  const pendingProposal = !isEditingPrices ? activeBreakdown?.pending ?? null : null;
  const canAddSubstage = (canConfirmPayments || isOwner) && !stage.pre_existing && stage.status !== 'complete' && project.status !== 'archived';
  function handleOpenAddSubstage() {
    if (isEditingPrices && activeBreakdown) {
      activeBreakdown.addRow();
      return;
    }
    if (split) {
      setOpenBreakdownAddSignal(n => n + 1);
      if (typeof document !== 'undefined') {
        window.setTimeout(() => document.getElementById('stage-breakdown-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
      }
      return;
    }
    setAddingSubstage(prev => !prev);
    setAddSubstageError(null);
  }
  function handleStartPricing() {
    if (!activeBreakdown?.canPropose || activeBreakdown.pending) return;
    setUploadFor(null);
    setRequestPayFor(null);
    setAddingSubstage(false);
    activeBreakdown.startEditing(false);
  }
  async function handleSaveNewSubstage(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newSubstageName.trim();
    if (trimmed.length < 2 || addSubstageBusy) return;
    setAddSubstageBusy(true);
    setAddSubstageError(null);
    try {
      await addProjectSubstage(stage.id, trimmed);
      setNewSubstageName('');
      setAddingSubstage(false);
      await onSubmitted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/stage_split_use_breakdown/.test(msg)) {
        setAddingSubstage(false);
        setOpenBreakdownAddSignal(n => n + 1);
        if (typeof document !== 'undefined') {
          window.setTimeout(() => document.getElementById('stage-breakdown-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
        }
      } else {
        setAddSubstageError(errorMessage(err, t('common.somethingWrong')));
      }
    } finally {
      setAddSubstageBusy(false);
    }
  }
  const pill = waiting.length > 0 ? { tone: 'held', label: t('contractorView.receiptToConfirm') }
    : stage.status === 'complete' ? { tone: 'complete', label: t('contractorStageStatus.complete') }
    : stage.pre_existing ? { tone: 'muted', label: t('contractorView.builtBefore') }
    : isOpen ? { tone: stage.status === 'active' && canWork ? 'complete' : 'held', label: t(`contractorStageStatus.${stage.status}` as TKey) }
    : { tone: 'muted', label: t('contractorView.afterStage', { n: Math.max(1, stage.stage_number - 1) }) };

  const statusLine = (row: AssignedProject['stages'][number]) => waitingOn(row).length > 0 ? t('contractorView.receiptToConfirm')
    : row.pre_existing ? t('contractorView.builtBefore')
    : row.status === 'complete' ? t('contractorStageStatus.complete')
    : row.status === 'active' || row.status === 'pending_review' ? t(`contractorStageStatus.${row.status}` as TKey)
    : t('contractorView.afterStage', { n: Math.max(1, row.stage_number - 1) });

  const currentStartStageNum = ordered.find(row => !row.pre_existing)?.stage_number ?? 1;
  const hasRecordedReceipts = [...stagePayments.values()].some(
    p => (p.receipts ?? []).some(r => !r.replacedBy) || !!p.receiptPath || (p.state && p.state !== 'expected'),
  );
  const hasRecordedEvidence = substages.some(
    sub => (sub.evidence_urls?.length ?? 0) > 0 || !!sub.approved_at,
  );
  const hasRecordedStageWork = ordered.some(
    row => (!row.pre_existing && (
      row.status === 'complete'
      || row.status === 'pending_review'
      || (Number(row.payment_milestone_usd ?? 0) > 0 && row.payment_status === 'paid')
    )) || isRowPaidUpfront(row),
  );
  const canChangeStartingStage = (canConfirmPayments || isOwner)
    && project.status !== 'archived'
    && ordered.length > 1
    && !contractorPayState?.initialPayment
    && !hasRecordedReceipts
    && !hasRecordedEvidence
    && !hasRecordedStageWork;

  function handleSaveStartingStage(e: React.FormEvent) {
    e.preventDefault();
    if (savingStartStage) return;
    if (nextStartStage === currentStartStageNum) {
      setEditingStartStage(false);
      return;
    }
    setStartStageError(null);
    setConfirmStartStage(true);
  }

  async function executeSaveStartingStage() {
    if (savingStartStage) return;
    setSavingStartStage(true);
    setStartStageError(null);
    try {
      await updateProjectStartingStage(project.id, nextStartStage);
      setConfirmStartStage(false);
      setEditingStartStage(false);
      const targetRow = ordered.find(row => row.stage_number === nextStartStage);
      await onSubmitted();
      if (targetRow) onSelectStage(targetRow.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setStartStageError(/starting_stage_locked/.test(msg)
        ? t('wizard.joined.changeStartStageLocked')
        : errorMessage(err, t('common.somethingWrong')));
    } finally {
      setSavingStartStage(false);
    }
  }

  const fromStageRow = ordered.find(row => row.stage_number === currentStartStageNum);
  const toStageRow = ordered.find(row => row.stage_number === nextStartStage);

  const card = 'rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return (
    <div className="flex flex-col gap-4">
      {nextCard}

      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
          <section className={cn(card, 'overflow-hidden')} aria-labelledby="work-stages-title">
            <div className="px-4 pb-2.5 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 id="work-stages-title" className="text-sm font-bold text-brand-near-black dark:text-white">{t('contractorWork.stages')}</h2>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorView.stagesDone', { done: assigned.completedStages, total: assigned.totalStages })}</p>
                </div>
                {canChangeStartingStage && (
                  <button
                    type="button"
                    data-action="change-starting-stage"
                    onClick={() => {
                      setNextStartStage(currentStartStageNum);
                      setStartStageError(null);
                      setEditingStartStage(prev => !prev);
                    }}
                    className="shrink-0 rounded-lg border border-brand-border-grey px-2 py-1 text-[11px] font-semibold text-brand-green hover:bg-brand-green/5 dark:border-[#3a3a3a] dark:text-[#86efac]"
                  >
                    {t('wizard.joined.changeStartStage')}
                  </button>
                )}
              </div>
              {canChangeStartingStage && editingStartStage && (
                <form onSubmit={handleSaveStartingStage} className="mt-3 space-y-2 rounded-xl border border-brand-border-grey bg-brand-off-white/60 p-3 dark:border-[#2c2c2c] dark:bg-[#141414]" data-change-starting-stage-form>
                  <label className="block">
                    <span className="block text-xs font-semibold text-brand-near-black dark:text-white">{t('wizard.joined.stageLabel')}</span>
                    <select
                      value={nextStartStage}
                      onChange={e => setNextStartStage(Number(e.target.value))}
                      disabled={savingStartStage}
                      className="mt-1.5 w-full rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs text-brand-near-black focus:border-brand-green focus:outline-none dark:border-[#3a3a3a] dark:bg-[#1e1e1e] dark:text-white"
                    >
                      {ordered.slice(0, -1).map(row => (
                        <option key={row.id} value={row.stage_number}>{row.stage_number} · {stageLabel(row)}</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] leading-relaxed text-brand-mid-grey">{t('wizard.joined.changeStartStageHint')}</p>
                  {startStageError && <p role="alert" className="text-[11px] font-medium text-state-blocked">{startStageError}</p>}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="submit"
                      disabled={savingStartStage}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-hover disabled:opacity-50"
                    >
                      {savingStartStage && <Loader2 className="size-3 animate-spin" aria-hidden />}
                      {t('wizard.joined.changeStartStageSave')}
                    </button>
                    <button
                      type="button"
                      disabled={savingStartStage}
                      onClick={() => { setEditingStartStage(false); setConfirmStartStage(false); setStartStageError(null); }}
                      className="rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:border-[#3a3a3a]"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              )}
              <ConfirmModal
                open={confirmStartStage}
                title={t('wizard.joined.confirmChangeTitle')}
                description={t('wizard.joined.confirmChangeBody', {
                  from: currentStartStageNum,
                  fromName: fromStageRow ? stageLabel(fromStageRow) : String(currentStartStageNum),
                  to: nextStartStage,
                  toName: toStageRow ? stageLabel(toStageRow) : String(nextStartStage),
                })}
                confirmLabel={t('wizard.joined.confirmChangeCta')}
                cancelLabel={t('common.cancel')}
                loading={savingStartStage}
                error={startStageError}
                onCancel={() => { if (!savingStartStage) setConfirmStartStage(false); }}
                onConfirm={() => { void executeSaveStartingStage(); }}
              />
            </div>
            <ul>
              {ordered.map(row => {
                const on = row.id === stage.id;
                const rowDue = money.pair(stagePayableUsd(row, basis), row.milestone_amount);
                const live = row.id === activeStage?.id || (row.status === 'active' && isRowPaidUpfront(row));
                const held = waitingOn(row).length > 0;
                return (
                  <li key={row.id} id={`work-stage-${row.id}`} className="border-t border-brand-border-grey dark:border-[#2c2c2c]">
                    <button type="button" onClick={() => onSelectStage(row.id)} aria-current={on ? 'true' : undefined} data-stage-row={row.stage_number}
                      className={cn('flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-off-white dark:hover:bg-[#242424]',
                        on && 'bg-brand-green/[0.06] shadow-[inset_3px_0_0_var(--color-brand-green)]')}>
                      <span className={cn('mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold',
                        row.status === 'complete' ? 'bg-brand-green text-white'
                          : live ? 'border-2 border-brand-green text-brand-green dark:border-state-complete dark:text-state-complete'
                          : 'border border-brand-border-grey text-brand-mid-grey dark:border-[#3a3a3a]')}>
                        {row.status === 'complete' ? <Check className="size-2.5 stroke-[3]" aria-hidden /> : row.status === 'locked' && !live ? <Lock className="size-2.5" aria-hidden /> : row.stage_number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[13px] font-semibold', row.status === 'locked' && !live ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                          {row.stage_number} · {stageLabel(row)}
                        </span>
                        <span className={cn('block text-xs', held ? 'font-semibold text-state-held' : 'text-brand-mid-grey')}>{statusLine(row)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                        <span className="font-mono text-[11.5px] tabular-nums text-brand-mid-grey">{rowDue?.local ?? '—'}</span>
                        {held && <span className="rounded-full bg-state-held/15 px-2 py-0.5 text-[10px] font-bold text-state-held">{t('contractorView.receiptToConfirm')}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {/* Philip, 30 Oct: getting the homeowner onto the build is what this screen is
              for. The invitation stays on the Work tab, under the stages. */}
          <div id="work-invite"><ProjectSharing projectId={project.id} projectName={project.name} /></div>
        </div>

        <section id="work-stage-detail" aria-labelledby="work-stage-detail-title" className={cn(card, 'order-1 min-w-0 p-4 sm:p-5 lg:order-2')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-mid-grey">{t('project.stages.stageN', { n: stage.stage_number })}</p>
                <button
                  type="button"
                  data-action="jump-stages"
                  onClick={() => { if (typeof document !== 'undefined') document.getElementById('work-stages-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-border-grey bg-brand-off-white px-2.5 py-1 text-[11.5px] font-semibold text-brand-near-black hover:border-brand-near-black lg:hidden dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
                >
                  {t('contractorWork.stages')} ▾
                </button>
              </div>
              <h2 id="work-stage-detail-title" className="mt-0.5 text-xl font-extrabold tracking-tight text-brand-near-black dark:text-white">{stageLabel(stage)}</h2>
              <span className={cn('mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                pill.tone === 'held' ? 'bg-state-held/10 text-state-held' : pill.tone === 'complete' ? 'bg-state-complete/10 text-state-complete' : 'bg-brand-light-grey text-brand-mid-grey')}>
                <span aria-hidden className={cn('size-1.5 rounded-full', pill.tone === 'held' ? 'bg-state-held' : pill.tone === 'complete' ? 'bg-state-complete' : 'bg-brand-muted-grey')} />{pill.label}
              </span>
            </div>
            {(canAddSubstage || activeBreakdown?.canPropose || activeBreakdown?.lockedForContractor || due) && (
              <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
                {(canAddSubstage || (activeBreakdown?.canPropose && !activeBreakdown.pending && !isEditingPrices) || (activeBreakdown?.lockedForContractor && !isEditingPrices)) && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {canAddSubstage && (
                      <button
                        type="button"
                        data-action="add-substage"
                        onClick={handleOpenAddSubstage}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-green px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-brand-green-hover"
                      >
                        <Plus className="size-3.5 shrink-0" aria-hidden />
                        {t('contractorView.addSubstage')}
                      </button>
                    )}
                    {activeBreakdown?.canPropose && !activeBreakdown.pending && !isEditingPrices && (
                      <button
                        type="button"
                        data-action="split-stage"
                        onClick={handleStartPricing}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-brand-green/50 bg-white px-3.5 py-2 text-xs font-semibold text-brand-green transition-colors hover:bg-brand-green/5 dark:bg-[#141414] dark:text-[#b4d8bf]"
                      >
                        <Split className="size-3.5 shrink-0" aria-hidden />
                        {t(activeBreakdown.split ? 'project.breakdown.editPrices' : 'project.breakdown.setPrices')}
                      </button>
                    )}
                    {activeBreakdown?.lockedForContractor && !isEditingPrices && (
                      <button
                        type="button"
                        disabled
                        title={t('project.breakdown.lockedAfterWork')}
                        className="inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey bg-brand-off-white px-3.5 py-2 text-xs font-semibold text-brand-mid-grey opacity-60 dark:border-[#2c2c2c] dark:bg-[#141414]"
                      >
                        <Lock className="size-3.5 shrink-0" aria-hidden />
                        {t(activeBreakdown.split ? 'project.breakdown.editPrices' : 'project.breakdown.setPrices')}
                      </button>
                    )}
                  </div>
                )}
                {due && <div className="w-full rounded-xl bg-brand-off-white px-4 py-3 text-right sm:w-auto dark:bg-[#141414]">
                  <p className="text-[11.5px] text-brand-mid-grey">{t(stage.paid_by_part ? 'contractorView.stagePriceByPart' : 'contractorView.stagePrice')}</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-brand-near-black dark:text-white">{due.local}</p>
                  {isRowPaidUpfront(stage)
                    ? <p className="mt-0.5 text-[11.5px] text-brand-green dark:text-[#b4d8bf]">{t('project.historyView.stageConfirmed', { amount: due.local })}</p>
                    : balance?.received != null && balance.received > 0 && <p className="mt-0.5 text-[11.5px] text-brand-mid-grey">{t('project.historyView.stageConfirmed', { amount: balance.received.toLocaleString('en-US', { maximumFractionDigits: 2 }) })}</p>}
                </div>}
              </div>
            )}
          </div>

          {activeBreakdown?.lastDeclined && !isEditingPrices && !pendingProposal && (
            <div
              role="status"
              data-breakdown-declined-banner
              className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-state-held/40 bg-state-held/[0.07] px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-near-black dark:text-white">
                  {t('project.breakdown.declinedBannerTitle')}
                </p>
                <p className="mt-0.5 text-[11.5px] text-brand-mid-grey">
                  {t('project.breakdown.declinedBannerHint')}
                </p>
              </div>
              <button
                type="button"
                data-action="see-decline-reason"
                onClick={onMessage}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover"
              >
                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
                {t('project.breakdown.seeReason')}
              </button>
            </div>
          )}

          {addingSubstage && canAddSubstage && !split && (
            <form
              onSubmit={handleSaveNewSubstage}
              data-add-substage-form
              className="mt-4 space-y-2.5 rounded-xl border border-brand-green/35 bg-brand-green/[0.04] p-3.5 dark:bg-[#141414]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-brand-near-black dark:text-white">
                  {t('contractorView.addSubstageTitle')}
                </p>
                <span className="text-[11px] text-brand-mid-grey">
                  {t('project.stages.stageN', { n: stage.stage_number })} · {stageLabel(stage)}
                </span>
              </div>
              <p className="text-xs text-brand-mid-grey">{t('contractorView.addSubstageHint')}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={newSubstageName}
                  onChange={e => { setNewSubstageName(e.target.value); setAddSubstageError(null); }}
                  placeholder={t('contractorView.addSubstagePlaceholder')}
                  maxLength={120}
                  disabled={addSubstageBusy}
                  autoFocus
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={addSubstageBusy || newSubstageName.trim().length < 2}
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-xs font-semibold text-white hover:bg-brand-green-hover disabled:opacity-45"
                  >
                    {addSubstageBusy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {t('contractorView.addSubstageSave')}
                  </button>
                  <button
                    type="button"
                    disabled={addSubstageBusy}
                    onClick={() => { setAddingSubstage(false); setAddSubstageError(null); }}
                    className="min-h-10 px-2.5 py-2 text-xs font-semibold text-brand-mid-grey underline underline-offset-4"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
              {addSubstageError && <p role="alert" className="text-xs text-state-alert">{addSubstageError}</p>}
            </form>
          )}

          {blockedText && stage.status !== 'complete' && !stage.pre_existing && <p role="status" className="mt-3 text-xs text-brand-mid-grey">{blockedText}</p>}

          {/* Chronological first step: ask whether the Homeowner has paid BEFORE evidence
              upload, only while the stage is unpaid and has no receipts yet (19 Nov). */}
          {showGate && !stagePaidUpfront && stage.status !== 'complete' && (
            <div className="mt-4">
              <ContractorPaymentVerificationBar
                stageId={stage.id}
                isContractor={true}
                readOnly={!canConfirmPayments}
                settled={tranche?.state === 'funded' || tranche?.state === 'reconciled'}
                hasReceipts={liveStageReceipts.length > 0}
                currencyCode={money.code}
                fxRate={fxRate}
                scheduledAmount={stage.milestone_amount}
                onChanged={async () => { await reloadContractorPayState(); await onSubmitted(); }}
              />
            </div>
          )}

          {/* What a verifier sent back belongs to the stage it is about. */}
          {sent.length > 0 && (
            <div className="mt-4 rounded-xl border border-state-held/40 bg-state-held/10 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-state-held">{t('contractor.needsAction.title')}</p>
              {sent.map(r => (
                <div key={`${r.stageId}:${r.decidedAt}`} className="mt-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-state-held">
                    {t(r.decision === 'rejected' ? 'contractor.decision.rejected' : 'contractor.decision.needsMoreEvidence')}
                  </p>
                  {r.findings && <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">{r.findings}</p>}
                </div>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <ul className="mt-4 overflow-hidden rounded-xl border border-brand-border-grey dark:border-[#2c2c2c]">
              {items.map((item, itemIndex) => {
                const complete = item.status === 'complete';
                const count = item.evidence_urls?.length ?? 0;
                const part = split ? parts?.parts?.find(row => row.id === item.id) : undefined;
                const partWaiting = part ? waiting.find(receipt => receipt.substageId === item.id) : undefined;
                const ready = partReady(item.id);
                const openReq = openRequestFor(item.id);
                const carriedCovered = isCoveredByCarryover(itemIndex, part);
                const stageFullyPaid = stagePaidUpfront || (balance?.remaining === 0 && (balance?.received ?? 0) > 0);
                // When the client uploads a receipt on a non-split stage after a contractor
                // payment request, flip the row immediately from "Request payment" to "Review receipt".
                const rowWaiting = partWaiting ?? (!split && openReq ? waiting[0] : undefined);
                const rowPaid = !!part?.paid || carriedCovered || stageFullyPaid;
                const showRequestBtn = !isEditingPrices && canRequestSubstagePayment && !complete && !rowPaid && !rowWaiting;
                // When the contractor marks a split stage as already paid upfront (`stageFullyPaid`),
                // unlock evidence uploads on every substage immediately so uploads never disappear.
                const showUploadBtn = !isEditingPrices && isOpen && !complete && !rowWaiting && (canWork || carriedCovered || stageFullyPaid) && (ready || carriedCovered || stageFullyPaid);
                const draftRowIndex = isEditingPrices && activeBreakdown
                  ? activeBreakdown.rows.findIndex(r => r.substageId === item.id)
                  : -1;
                const draftRow = draftRowIndex >= 0 && activeBreakdown ? activeBreakdown.rows[draftRowIndex] : null;
                const pendingLine = pendingProposal?.lines.find(l => l.substage_id === item.id) ?? null;
                return (
                  <li key={item.id} id={`substage-${item.id}`} className={cn('border-t border-brand-border-grey px-3.5 py-3 first:border-t-0 dark:border-[#2c2c2c]', rowWaiting && 'bg-state-held/[0.05]')}>
                    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 md:grid-cols-[22px_minmax(0,1fr)_auto_auto]">
                      <span aria-hidden className={cn('mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold',
                        complete ? 'bg-brand-green text-white' : isOpen && (ready || carriedCovered) ? 'border-2 border-brand-green text-brand-green dark:border-state-complete dark:text-state-complete' : 'border border-brand-border-grey text-brand-mid-grey dark:border-[#3a3a3a]')}>
                        {complete ? <Check className="size-2.5 stroke-[3]" /> : item.substage_number}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block text-[13.5px] font-semibold', complete || (isOpen && (ready || carriedCovered)) ? 'text-brand-near-black dark:text-white' : 'text-brand-mid-grey')}>
                          {split ? t('project.historyView.part', { n: item.substage_number, name: substageLabel(item) }) : substageLabel(item)}
                        </span>
                        <span className="block text-xs text-brand-mid-grey">
                          {rowWaiting ? <><span className="font-semibold text-state-held">{t('contractorView.receiptToConfirm')}</span> · {t('contractorView.uploadsOpenAfter')}</>
                            : complete ? t('contractorView.approvedOn')
                            : part && !part.paid && !ready && !carriedCovered && !stageFullyPaid ? t('contractorView.partPaidAfter', { n: Math.max(1, item.substage_number - 1) })
                            : count > 0 ? t('contractorProject.evidenceCount', { count }) : t('contractorProject.noEvidence')}
                        </span>
                        {carriedCovered && !complete && (
                          <span className="mt-1 inline-block rounded-full bg-state-complete/10 px-2 py-0.5 text-[11px] font-semibold text-state-complete" data-substage-carryover-covered>
                            {t('contractorView.coveredByCarryover')}
                          </span>
                        )}
                        {!part && !carriedCovered && stageFullyPaid && !complete && (
                          <span className="mt-1 inline-block rounded-full bg-brand-green/10 px-2 py-0.5 text-[11px] font-semibold text-brand-green dark:text-[#86efac]" data-substage-stage-paid>
                            {t('contractorView.partPaid')}
                          </span>
                        )}
                        {openReq && openReq.amount != null && !rowPaid && !rowWaiting && (
                          <span className="mt-1 inline-block rounded-full bg-state-held/10 px-2 py-0.5 text-[11px] font-semibold text-state-held" data-substage-payment-requested>
                            {t('contractorView.paymentRequestedTag', {
                              amount: `${Number(openReq.amount).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: currencyFractionDigits(openReq.currency ?? money.code) })} ${openReq.currency ?? money.code}`,
                            })}
                          </span>
                        )}
                      </span>
                      {/* One set of thumbnails: beside the part on desktop, under its name on a phone. */}
                      <span className="col-start-2 row-start-2 min-w-0 md:col-start-3 md:row-start-1 [&>div]:mt-0">
                        <EvidenceThumbs paths={item.evidence_urls ?? []} />
                      </span>
                      <span className="col-start-3 row-start-1 flex shrink-0 flex-col items-end gap-2 md:col-start-4">
                        {isEditingPrices && draftRow && activeBreakdown ? (
                          <div className="flex items-center gap-1.5" data-inline-substage-price>
                            <input
                              type="text"
                              required
                              inputMode="decimal"
                              disabled={activeBreakdown.working}
                              aria-label={t('project.breakdown.amountFor', { part: substageLabel(item), currency: activeBreakdown.currency })}
                              placeholder={t('project.breakdown.amountPlaceholder')}
                              value={draftRow.amount}
                              onChange={event => {
                                const raw = event.target.value;
                                activeBreakdown.editRow(draftRowIndex, {
                                  amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw,
                                });
                              }}
                              className="min-h-9 w-32 rounded-lg border border-brand-green/50 bg-white px-2.5 py-1.5 text-right font-mono text-xs text-brand-near-black outline-none focus:border-brand-green sm:w-36 dark:border-[#3a3a3a] dark:bg-[#141414] dark:text-white"
                            />
                            <span className="font-mono text-[11px] font-semibold text-brand-mid-grey">{activeBreakdown.currency}</span>
                          </div>
                        ) : pendingLine && activeBreakdown ? (
                          <span className="rounded-lg border border-state-held/40 bg-state-held/10 px-2.5 py-1 text-right font-mono text-xs tabular-nums text-state-held" data-inline-pending-price>
                            {pendingLine.before != null && pendingLine.before !== pendingLine.amount
                              ? `${activeBreakdown.format(pendingLine.before)} → ${activeBreakdown.format(pendingLine.amount)}`
                              : activeBreakdown.format(pendingLine.amount)}
                            <span className="block font-sans text-[10px] font-semibold">{t('project.breakdown.proposedTag')}</span>
                          </span>
                        ) : (
                          part && <span className="text-right font-mono text-xs tabular-nums text-brand-near-black dark:text-white">
                            {Number(part.price).toLocaleString('en-US', { maximumFractionDigits: currencyFractionDigits(parts?.currency ?? money.code) })}
                            <span className="block font-sans text-[11px] text-brand-mid-grey">
                              {t(part.paid || carriedCovered || stageFullyPaid || complete ? 'contractorView.partPaid' : Number(part.pending) > 0 ? 'contractorView.toConfirm' : 'contractorView.partNotPaid')}</span>
                          </span>
                        )}
                        {!isEditingPrices && rowWaiting && <button type="button" onClick={() => onReviewReceipt(stage.id, rowWaiting.id)} data-action="review-part-receipt"
                          className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover">{t('contractorView.reviewReceipt')}</button>}
                        {/* Sequential CTA order: primary expected next action always appears FIRST (19 Nov). */}
                        {(showRequestBtn || showUploadBtn) && (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {showUploadBtn && (
                              <button type="button" onClick={() => { setUploadFor(item.id); setRequestPayFor(null); }}
                                data-tour="upload-evidence" data-action="upload"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover">
                                <Camera className="size-3.5" aria-hidden />{t('contractorProject.upload')}
                              </button>
                            )}
                            {showRequestBtn && (
                              <button
                                type="button"
                                onClick={() => {
                                  const closing = requestPayFor === item.id;
                                  setRequestPayFor(closing ? null : item.id);
                                  setUploadFor(null);
                                  setRequestAmount(part?.price ? String(part.price) : '');
                                  setRequestNote('');
                                  setRequestError(null);
                                }}
                                data-action="request-substage-payment"
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                                  showUploadBtn
                                    ? 'border border-brand-green bg-white text-brand-green hover:bg-brand-green/5 dark:bg-[#1a1a1a] dark:text-[#b4d8bf]'
                                    : 'bg-brand-green text-white hover:bg-brand-green-hover',
                                )}
                              >
                                <Send className="size-3" aria-hidden />{t('contractorView.requestSubstagePayment')}
                              </button>
                            )}
                          </div>
                        )}
                      </span>
                    </div>

                    {/* Inline Request payment dropdown for this substage (19 Nov). */}
                    {requestPayFor === item.id && showRequestBtn && (
                      <form
                        onSubmit={e => { e.preventDefault(); void submitSubstagePaymentRequest(item.id); }}
                        className="mt-3 space-y-2.5 rounded-xl border border-brand-green/30 bg-brand-off-white px-4 py-3.5 text-xs dark:bg-[#141414]"
                        data-substage-payment-dropdown
                      >
                        <label className="block font-medium text-brand-near-black dark:text-white">
                          {t('contractorView.requestSubstageAmountLabel', { currency: money.code })}
                          <input
                            type="text"
                            inputMode="decimal"
                            value={requestAmount}
                            disabled={requestBusy}
                            onChange={e => {
                              const raw = e.target.value;
                              setRequestAmount(/^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw);
                              setRequestError(null);
                            }}
                            className="mt-1 min-h-10 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 font-mono text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
                          />
                        </label>
                        <label className="block font-medium text-brand-near-black dark:text-white">
                          {t('contractorView.noteOptional')}
                          <input
                            type="text"
                            maxLength={500}
                            value={requestNote}
                            disabled={requestBusy}
                            onChange={e => setRequestNote(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
                          />
                        </label>
                        {requestError && <p role="alert" className="text-state-alert">{requestError}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="submit" disabled={requestBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-semibold text-white disabled:opacity-50">
                            {requestBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                            {t('contractorView.sendPaymentRequest')}
                          </button>
                          <button type="button" disabled={requestBusy} onClick={() => { setRequestPayFor(null); setRequestError(null); }}
                            className="px-2 py-1.5 text-brand-mid-grey underline underline-offset-4">
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Opened against the item it belongs to, so the camera and
                        the file picker are under the thumb that pressed Upload. */}
                    {uploadFor === item.id && (canWork || carriedCovered || stageFullyPaid) && (ready || carriedCovered || stageFullyPaid) && (
                      <div className="mt-3 rounded-xl bg-brand-off-white px-4 py-3.5 dark:bg-[#141414]">
                        <SubmitWork projectId={project.id} stage={stage} substages={items}
                                    fixedSubstageId={item.id}
                                    substageLabel={substageLabel}
                                    onCancel={() => setUploadFor(null)}
                                    onSubmitted={async () => { setUploadFor(null); await onSubmitted(); }} />
                      </div>
                    )}
                  </li>
                );
              })}
              {/* New substage draft rows while inline pricing is open. */}
              {isEditingPrices && activeBreakdown && activeBreakdown.rows.map((row, rowIndex) => {
                if (row.substageId) return null;
                return (
                  <li key={`new-part-${rowIndex}`} className="border-t border-brand-border-grey bg-brand-green/[0.03] px-3.5 py-3 dark:border-[#2c2c2c]" data-inline-new-substage>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-brand-green font-mono text-[10px] font-bold text-brand-green">+</span>
                      <input
                        type="text"
                        disabled={activeBreakdown.working}
                        aria-label={t('project.breakdown.newPartName')}
                        placeholder={t('project.breakdown.newPartName')}
                        value={row.name}
                        maxLength={120}
                        onChange={event => activeBreakdown.editRow(rowIndex, { name: event.target.value })}
                        className="min-h-9 min-w-[160px] flex-1 rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs text-brand-near-black outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white"
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          required
                          inputMode="decimal"
                          disabled={activeBreakdown.working}
                          aria-label={t('project.breakdown.amountFor', { part: row.name || t('project.breakdown.newPart'), currency: activeBreakdown.currency })}
                          placeholder={t('project.breakdown.amountPlaceholder')}
                          value={row.amount}
                          onChange={event => {
                            const raw = event.target.value;
                            activeBreakdown.editRow(rowIndex, {
                              amount: /^[\d.,\s]*$/.test(raw) ? normaliseBudgetInput(raw, lang) : raw,
                            });
                          }}
                          className="min-h-9 w-32 rounded-lg border border-brand-green/50 bg-white px-2.5 py-1.5 text-right font-mono text-xs text-brand-near-black outline-none focus:border-brand-green sm:w-36 dark:border-[#3a3a3a] dark:bg-[#141414] dark:text-white"
                        />
                        <span className="font-mono text-[11px] font-semibold text-brand-mid-grey">{activeBreakdown.currency}</span>
                        <button
                          type="button"
                          disabled={activeBreakdown.working}
                          aria-label={t('project.breakdown.removePart')}
                          onClick={() => activeBreakdown.removeRow(rowIndex)}
                          className="rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#242424]"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
              {/* Newly proposed substages shown inline while waiting for Homeowner approval. */}
              {pendingProposal && activeBreakdown && pendingProposal.lines.filter(l => !l.substage_id).map((line, idx) => (
                <li key={`pending-new-${idx}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-border-grey bg-state-held/[0.04] px-3.5 py-3 dark:border-[#2c2c2c]" data-inline-pending-new-substage>
                  <div className="flex items-center gap-3">
                    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-state-held font-mono text-[10px] font-bold text-state-held">+</span>
                    <span className="text-[13.5px] font-semibold text-brand-near-black dark:text-white">
                      {line.name}
                      <span className="ml-2 rounded-full bg-brand-green/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand-green">{t('project.breakdown.newPart')}</span>
                    </span>
                  </div>
                  <span className="rounded-lg border border-state-held/40 bg-state-held/10 px-2.5 py-1 text-right font-mono text-xs tabular-nums text-state-held">
                    {activeBreakdown.format(line.amount)}
                    <span className="block font-sans text-[10px] font-semibold">{t('project.breakdown.proposedTag')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {breakdown}
          {showGate && (
            <div data-tour="confirm-payment">
            {/* Share the project's canonical budget basis with the client payment
                panel; transaction currencies keep their own saved conversions. */}
            <ProjectMoneyProvider project={project}>
              <StagePaymentGate projectId={project.id} stageId={stage.id} stageNumber={stage.stage_number}
                payment={tranche}
                workReviewed={stage.review_payment_pending}
                canUpload={(project.status === 'active'||stage.status==='complete') && project.status!=='archived' && canSubmitStageReceipt(stage, stages, project.workflow_origin, !!(contractorPayState?.requests.some(r => r.stage_id === stage.id && r.status === 'open') || tranche?.receipts?.some(r => !r.replacedBy) || tranche?.receiptPath))}
                scheduledAmount={stage.milestone_amount}
                blockedReason={t(stageStartsWithEvidence(stage, stages, project.workflow_origin) ? 'project.receiptFlow.evidenceFirstContractor' : 'project.receiptFlow.waitForUpdatesContractor')} isContractor readOnly={!canConfirmPayments}
                hideVerificationPrompt
                contractorPaidUpfront={isRowPaidUpfront(stage)}
                onChanged={onSubmitted} parts={parts} hideParts={split} onReviewReceipt={receiptId => onReviewReceipt(stage.id, receiptId)} />
            </ProjectMoneyProvider>
            </div>
          )}
        </section>
      </div>
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
