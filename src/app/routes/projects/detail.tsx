import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft, MapPin, Building2, Layers, Home, Wrench,
  CalendarDays, BadgeCheck, ShieldCheck, Briefcase,
} from 'lucide-react';
import { useAuth }               from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { supabase }              from '@/lib/supabase/client';
import {
  fetchProject,
  fetchProjectStages,
  fetchProjectSubstages,
  fetchProjectFees,
}                                from '@/lib/supabase/projects';
import {
  markSubstageComplete,
  approveStage,
}                                from '@/lib/supabase/approvals';
import { projectBudget, formatUSDFull } from '@/lib/budget';
import { ProjectMoneyProvider } from '@/lib/budget/project-money-context';
import { projectStagesAfterApproval } from '@/lib/projects/stage-progression';
import { StageTracker }          from '@/components/project/StageTracker';
import { fetchStagePayments, type StagePayment, type ApproveStageResult } from '@/lib/supabase/verifications';
import EvidenceUpload            from '@/components/project/EvidenceUpload';
import { MoneyValue } from '@/components/project/MoneyValue';
import BudgetView                from '@/components/project/BudgetView';
import { StagePricingPanel } from '@/components/project/StagePricingPanel';
import { ClientDocuments }       from '@/components/project/ClientDocuments';
import { ProjectConversations }  from '@/components/project/ProjectConversations';
import { ProjectTeam }           from '@/components/project/ProjectTeam';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';
import OverviewTab               from '@/components/project/OverviewTab';
import TimelineTab               from '@/components/project/TimelineTab';
import StartTrackingGate         from '@/components/project/StartTrackingGate';
import type {
  ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectFeeRow,
  FinishLevel, ProjectTier, PaymentStatus,
}                                from '@/types/project';
import { useDomainLabels } from '@/lib/domain-labels';

// ── Label maps ────────────────────────────────────────────



// ── Tab bar ───────────────────────────────────────────────

type Tab = 'overview' | 'stages' | 'costing' | 'timeline' | 'documents' | 'messages' | 'team';

/**
 * `?tab=` to a Tab, or the default.
 *
 * Validated against the known set: an arbitrary or stale value in somebody's URL
 * resolves to the overview rather than selecting a tab that renders nothing.
 */
const ALL_TABS: Tab[] =
  ['overview', 'stages', 'costing', 'timeline', 'documents', 'messages', 'team'];

function tabFromUrl(value: string | null): Tab {
  return ALL_TABS.includes(value as Tab) ? (value as Tab) : 'overview';
}

const OWNER_TABS: { id: Tab; labelKey: TKey }[] = [
  { id: 'overview',   labelKey: 'project.tabs.overview'  },
  { id: 'stages',     labelKey: 'project.tabs.stages'    },
  { id: 'team',       labelKey: 'project.tabs.team'      },
  { id: 'costing',    labelKey: 'project.tabs.costing'   },
  { id: 'timeline',   labelKey: 'project.tabs.timeline'  },
  { id: 'documents',  labelKey: 'project.tabs.documents' },
  { id: 'messages',   labelKey: 'project.tabs.messages'  },
];

const CONTRACTOR_TABS: { id: Tab; labelKey: TKey }[] = [
  { id: 'stages',   labelKey: 'project.tabs.stages'   },
  { id: 'messages', labelKey: 'project.tabs.messages' },
  { id: 'team',     labelKey: 'project.tabs.team'     },
];

function TabBar({
  active, onChange, isContractor, projectId, canInviteContractor,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  isContractor: boolean;
  projectId: string;
  canInviteContractor: boolean;
}) {
  const tabs = isContractor ? CONTRACTOR_TABS : OWNER_TABS;
  const t = useT();
  return (
    <div className="flex gap-0 overflow-x-auto scrollbar-hide border-b border-brand-border-grey mb-6">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          data-tour={tab.id === 'team' && active !== 'team' && canInviteContractor ? 'invite-contractor' : undefined}
          className={`shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
            active === tab.id
              ? 'text-brand-near-black border-b-2 border-brand-near-black -mb-px'
              : 'text-brand-mid-grey hover:text-brand-near-black'
          }`}
        >
          {t(tab.labelKey)}
        </button>
      ))}


    </div>
  );
}

// ── Detail row (project info card) ───────────────────────

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-brand-mid-grey shrink-0">{icon}</span>
      <span className="w-24 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <span className="flex-1 text-sm font-medium text-brand-near-black leading-snug">{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────


/**
 * The Jalla Management estimate, in the project's own currency.
 *
 * Its own component for one reason: `useMoney()` has to be called from INSIDE
 * `ProjectMoneyProvider`, and this route's body is what renders the provider. Called
 * there it would always fall back to dollars — which is exactly what it used to do, on
 * the figure a Management client is quoted.
 */
function ManagedEstimate({ usd }: { usd: number | null }) {
  return <MoneyValue usd={usd} className="text-lg font-bold text-brand-near-black dark:text-white" />;
}

export default function ProjectDetail() {
  const { stageLabel, substageLabel } = useStageLabels();
  const labels = useDomainLabels();
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const attachmentFailed = searchParams.get('attachment') === 'failed';
  const { user, isContractor: hasContractorRole } = useAuth();
  const scope = `${id ?? ''}:${user?.id ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadSequence.current++; };
  }, []);
  const [contractorProjectId, setContractorProjectId] = useState<string | null>(null);
  const isContractor = contractorProjectId === id;
  const { access: teamAccess } = useProjectTeamAccess(id ?? '');
  const canUploadEvidence = teamAccess?.assignedContractor === true && teamAccess.primaryClient !== true;
  const t        = useT();

  const [project,   setProject]   = useState<ProjectRow | null>(null);
  const [stages,    setStages]    = useState<ProjectStageRow[]>([]);
  const [substages, setSubstages] = useState<ProjectSubstageRow[]>([]);
  const [payments,  setPayments]  = useState<Map<string, StagePayment>>(new Map());
  // The permit, professional, verification and contingency lines. They carry no stage,
  // so without them the overview's "outstanding" could only ever be the whole budget
  // minus the stages — which is why it read as the project total (Philip, 9 Nov 2026).
  const [fees,      setFees]      = useState<ProjectFeeRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  /**
   * The open tab, taken from `?tab=` when there is one.
   *
   * It used to be plain state starting on 'overview', which meant every link that
   * named a tab — a notification bell, the "Read it in Groundwork" button in a message
   * email — landed on the project overview instead. The link said `?tab=messages` and
   * nothing read it.
   *
   * Kept in the URL as it changes, so the address bar matches the screen and a link
   * somebody copies opens where they are looking.
   */
  const activeTab = tabFromUrl(searchParams.get('tab'));
  const setActiveTab = useCallback((tab: Tab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // ── Data fetching ──────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!id || !mounted.current || currentScope.current !== scope) return;
    const sequence = ++loadSequence.current;
    const isCurrent = () => mounted.current && currentScope.current === scope && sequence === loadSequence.current;
    try {
      // The document count went with the delete confirmation it was counting for (053).
      const [p, s, sub, pay, fee, assignment] = await Promise.all([
        fetchProject(id),
        fetchProjectStages(id),
        fetchProjectSubstages(id),
        fetchStagePayments(id),
        fetchProjectFees(id),
        hasContractorRole && user?.id ? supabase.from('contractor_invites').select('id')
          .eq('project_id', id).eq('contractor_user_id', user.id).eq('status', 'accepted').limit(1)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!isCurrent()) return;
      if (assignment.error) throw assignment.error;
      if (!p) { setProject(null); setError(t('project.notFound')); return; }
      setError(null);
      setProject(p);
      setStages(s);
      setSubstages(sub);
      setPayments(pay);
      setFees(fee);
      setContractorProjectId(assignment.data?.length ? id : null);
      return;
    } catch {
      if (isCurrent()) setError(t('project.loadFailed'));
      return;
    }
    // `t` is a dependency now that the messages come from the dictionary: without it
    // a toggle after mount would leave this closure reporting in the old language.
  }, [id, t, hasContractorRole, user?.id, scope]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadAll().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAll]);

  // Real-time: update stage payment_status when it changes in Supabase
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`project-stages-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'project_stages', filter: `project_id=eq.${id}` },
        (payload) => {
          const updated = payload.new as ProjectStageRow;
          setStages(prev =>
            prev.map(s => s.id === updated.id ? { ...s, ...updated } : s),
          );
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_substages', filter: `project_id=eq.${id}` }, payload => {
        const updated = payload.new as ProjectSubstageRow;
        setSubstages(prev => prev.map(substage => substage.id === updated.id ? { ...substage, ...updated } : substage));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `project_id=eq.${id}` }, () => { void loadAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_payment_receipts', filter: `project_id=eq.${id}` }, () => { void loadAll(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${id}` }, () => { void loadAll(); })
      .subscribe();
    const refresh = () => { void loadAll(); };
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); supabase.removeChannel(channel); };
  }, [id, loadAll]);

  // ── Event handlers ─────────────────────────────────────

  const applyApproval = useCallback((result: ApproveStageResult) => {
    // The database already committed this transition. Keep its result visible if
    // the following refresh fails, and never apply an old project's response.
    if (!mounted.current || currentScope.current !== scope || result.projectId !== id) return;
    setStages(prev => projectStagesAfterApproval(prev, result));
    setProject(prev => prev?.id === result.projectId ? {
      ...prev, current_stage: result.awaitingReviewedStagePayment ? Math.max(prev.current_stage, result.stageNumber) : result.nextStageNumber ?? result.stageNumber,
      status: result.isFinal && !result.alreadyApproved ? 'completed' : prev.status,
    } : prev);
  }, [id, scope]);

  const handleMarkSubstageComplete = useCallback(async (substageId: string) => {
    if (!user || !project || project.id !== id || !teamAccess?.primaryClient) return;
    const result = await markSubstageComplete(substageId, project.tier, user.id);
    if (!mounted.current || currentScope.current !== scope) return;
    setSubstages(prev => prev.map(s =>
      s.id === substageId
        ? {
            ...s,
            status: 'complete',
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          }
        : s,
    ));
    if (result) applyApproval(result);
    void loadAll();
    return result;
  }, [user, project, id, scope, teamAccess, applyApproval, loadAll]);

  const handleEvidenceUploaded = useCallback((substageId: string, urls: string[]) => {
    setSubstages(prev => prev.map(s =>
      s.id === substageId ? { ...s, evidence_urls: urls } : s,
    ));
  }, []);

  const handleApproveStage = useCallback(async (stageId: string, stageNumber: number) => {
    if (!user || !project || project.id !== id || !teamAccess?.primaryClient) return;
    const result = await approveStage(project.id, stageId, stageNumber, user.id, project.tier);
    if (!mounted.current || currentScope.current !== scope) return;
    applyApproval(result);
    void loadAll();
    return result;
  }, [user, project, id, scope, teamAccess, applyApproval, loadAll]);

  // Render prop — passes EvidenceUpload down without creating circular imports
  const renderEvidenceUpload = useCallback((props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => {
    if (!project || project.status !== 'active' || !canUploadEvidence) return null;
    const stageId = substages.find(sub => sub.id === props.substageId)?.stage_id ?? '';
    // Through the dictionary, not the stored English. `name` is the persisted seed
    // string; `stage_key` is what makes it read in the client's own language.
    const stage = stages.find(s => s.id === stageId);
    const sub = substages.find(x => x.id === props.substageId);
    const stageName = stage ? stageLabel(stage) : undefined;
    const substageName = sub ? substageLabel(sub) : undefined;
    return (
      <EvidenceUpload
        canUploadEvidence={canUploadEvidence}
        projectId={project.id}
        stageId={stageId}
        substageId={props.substageId}
        existingUrls={props.existingUrls}
        onUploadComplete={props.onUploadComplete}
        tier={project.tier}
        projectName={project.name}
        stageName={stageName}
        substageName={substageName}
      />
    );
  }, [project, stages, substages, stageLabel, substageLabel, canUploadEvidence]);

  // ── Loading / error ────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  if (!project || project.id !== id) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-brand-mid-grey">{error ?? t('project.notFound')}</p>
        <Link to="/dashboard" className="text-sm font-medium text-brand-near-black underline underline-offset-4">
          {t('project.backToDashboard')}
        </Link>
      </div>
    );
  }

  // ── Derived display values ─────────────────────────────

  // Resolves the owner's confirmed budget_usd, falling back to the engine estimate.
  const budget  = projectBudget(project);

  const scaleStr   = [
    `${project.num_floors} floor${project.num_floors > 1 ? 's' : ''}`,
    `${project.sqm} sqm`,
    project.bedrooms  > 0 ? `${project.bedrooms} bed`  : null,
    project.bathrooms > 0 ? `${project.bathrooms} bath` : null,
    project.has_boys_quarters ? 'Staff quarters' : null,
  ].filter(Boolean).join(' · ');

  const startDate  = project.target_start
    ? new Date(project.target_start).toLocaleDateString('en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const completedPct = stages.length > 0
    ? Math.round((stages.filter(s => s.status === 'complete').length / stages.length) * 100)
    : 0;

  // From `user_roles` and accepted assignments, via AuthContext — NOT from
  // `user_metadata.role`, which is set by the browser at signup and which migration
  // 100 stopped writing. That check had been false for every contractor since, so a
  // partner who created a project for their client opened it and saw the CLIENT's
  // view, complete with an invitation to invite a contractor. Reported 29 October.
  // Real ownership, from the row — not `user_metadata`, which the browser sets. Since 112
  // a project can be OPEN to somebody who does not own it (a family viewer), so "not a
  // contractor" no longer means "the owner".
  const isOwner = !!user?.id && user.id === project?.user_id;
  const trackingStarted = !!project.tracking_started_at;
  const isManaged = project.tier === 'jalla_management' || (project.tier as string) === 'enterprise';
  const activeStageNum = stages.find(s => s.status === 'active' || s.status === 'pending_review')?.stage_number;

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'You';

  // Overview tab uses wider layout; others stay narrow
  const isWideTab = activeTab === 'overview';

  return (
    <div className="min-h-screen bg-white dark:bg-[#141414]">
      {/* Nav */}
      <nav className="border-b border-brand-border-grey dark:border-[#2c2c2c] px-4 sm:px-8 py-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">{t('nav.dashboard')}</span>
        </button>
        <span className="text-brand-border-grey hidden sm:inline">/</span>
        <span className="text-sm font-medium text-brand-near-black dark:text-white truncate">{project.name}</span>
      </nav>

      {/* Main — wider for overview, narrow for detail tabs */}
      <div className="mx-auto px-4 sm:px-6 py-8 sm:py-10 max-w-5xl">

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-state-alert/30 px-4 py-3 text-sm text-state-alert">
            {t('project.refreshFailed')}{' '}
            <button type="button" onClick={() => { void loadAll(); }} className="font-semibold underline">{t('project.retryRefresh')}</button>
          </p>
        )}

        {/* The wizard could not store the costing they attached. Said here because this
            is where they land, and because the alternative — the old behaviour — was to
            lose the file silently. */}
        {attachmentFailed && (
          <p role="alert" className="mb-6 rounded-xl border border-state-held/40 bg-state-held/10 px-4 py-3 text-sm text-brand-near-black dark:text-white">
            {t('wizard.confirmBudget.quoteFailed')}
          </p>
        )}
        {/* Every money figure on this page is rendered in the project's own currency —
            see project-money-context.tsx. One provider for the whole body so the budget
            gate, the overview, the costing tab, the stage list and the payments ledger
            can never quote four different conversions of the same stage. */}
        <ProjectMoneyProvider project={project}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-brand-mid-grey uppercase tracking-wide mb-1">
                {labels.buildingType(project.building_type)} · {labels.country(project.country)}
              </p>
              <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black dark:text-white leading-tight truncate">
                {project.name}
              </h1>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-brand-mid-grey">
                {project.bedrooms > 0 && <span>{t('project.header.bed', { count: project.bedrooms })}</span>}
                {project.bedrooms > 0 && project.num_floors > 0 && <span>·</span>}
                <span>{project.num_floors === 1 ? t('project.header.floor', { count: 1 }) : t('project.header.floors', { count: project.num_floors })}</span>
                {project.roof_type && <><span>·</span><span>{labels.roofType(project.roof_type)}</span></>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                {trackingStarted ? (
                  <span className="flex items-center gap-1 rounded-full bg-brand-off-white dark:bg-state-complete/30 border border-state-complete/30 dark:border-state-complete px-2 py-0.5 text-[10px] font-semibold text-state-complete dark:text-state-complete uppercase tracking-wide">
                    <span className="size-1.5 rounded-full bg-state-complete inline-block" />
                    {t('project.header.live')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-brand-off-white dark:bg-state-held/30 border border-state-held/30 dark:border-state-held px-2 py-0.5 text-[10px] font-semibold text-state-held dark:text-state-held uppercase tracking-wide">
                    <span className="size-1.5 rounded-full bg-state-held inline-block" />
                    {t('project.header.planning')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black dark:text-white">
                {t('project.review.clientApproval')}
              </div>
              {stages.length > 0 && (
                <span className="text-[10px] text-brand-mid-grey tabular-nums">
                  {t('project.header.percentComplete', { pct: completedPct })}
                </span>
              )}
            </div>
          </div>

          {/* Pre-tracking banner.
              Self Verify and Jalla Verify confirm their budget in the final wizard step,
              so they never arrive here untracked. What remains is Jalla Management, whose
              budget a Jalla admin confirms after creation, and the contractor's view of a
              project whose owner has not finished.

              StartTrackingGate is still rendered as a fallback for anything created
              before that change and not caught by migration 022. It sits above the tabs
              rather than replacing them — the project stays readable either way. */}
          {!trackingStarted && (
            isContractor ? (
              <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-6 py-8 text-center max-w-2xl mx-auto">
                <p className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.gate.contractorTitle')}</p>
                <p className="text-xs text-brand-mid-grey mt-1.5 leading-relaxed max-w-sm mx-auto">
                  {t('project.gate.contractorBody')}
                </p>
              </div>
            ) : isManaged ? (
              <div className="max-w-2xl mx-auto rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] overflow-hidden">
                <div className="px-6 sm:px-8 py-6 border-b border-brand-border-grey dark:border-[#2c2c2c] flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white dark:bg-[#252525]">
                    <Briefcase className="size-5 text-brand-near-black dark:text-white" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-brand-near-black dark:text-white leading-snug">
                      {t('project.gate.managedTitle')}
                    </h2>
                    <p className="text-sm text-brand-mid-grey mt-1 leading-relaxed">
                      {t('project.gate.managedBody')}
                    </p>
                  </div>
                </div>
                <div className="px-6 sm:px-8 py-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold text-brand-mid-grey uppercase tracking-wide">{t('project.gate.managedEstimate')}</p>
                    <p className="text-xs text-brand-mid-grey mt-0.5">{t('project.gate.managedNote')}</p>
                  </div>
                  <ManagedEstimate usd={project.budget_usd} />
                </div>
              </div>
            ) : (
              <StartTrackingGate project={project} userId={user?.id ?? ''} onStarted={loadAll} />
            )
          )}

          {/* Tabs.
              These render whether or not tracking has started. The gate above is a
              prompt, not a wall: stages and substages are seeded at project creation
              already `locked`, so nothing here is actionable until start_project_tracking
              activates stage 1. Hiding the whole project behind the budget form meant a
              user could not look at the build they had just costed. */}
          <TabBar active={activeTab} onChange={setActiveTab} isContractor={isContractor} projectId={project.id} canInviteContractor={teamAccess?.canInviteContractor === true} />
          {activeTab !== 'costing' && <StagePricingPanel project={project} onChanged={loadAll} compact onOpen={() => setActiveTab('costing')} />}

          {/* Somebody else built this project for them — an admin, or the partner
              contractor who brought them on (109). The client was told nothing before:
              a project simply appeared. Saying so, and saying plainly that they own it,
              is the difference between a surprise and a service. */}
          {activeTab === 'overview' && project.created_by && (
            <p className="mb-4 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
              {t('project.overview.setUpForYou')}
            </p>
          )}

          {/* Tab: Overview */}
          {activeTab === 'overview' && (
            <OverviewTab
              project={project}
              stages={stages}
              substages={substages}
              budget={budget}
              payments={payments}
              fees={fees}
              onViewCosting={() => setActiveTab('costing')}
              onViewStage={() => setActiveTab('stages')}
            />
          )}

          {/* Tab: Stages */}
          {activeTab === 'stages' && (
            <div className="space-y-6">
              {/* A plain wrapper, deliberately unstyled: `display: contents` measures
                  as a zero-sized box, so the tour would have nothing to point at. One
                  child of a `space-y-6` parent either way, so the spacing is unchanged. */}
              <div data-tour="stage-list">
              <StageTracker
                stages={stages}
                substages={substages}
                tier={project.tier}
                userId={user?.id ?? ''}
                isContractor={isContractor}
                workflowOrigin={project.workflow_origin}
                projectPaused={project.status !== 'active'}
                canApprove={teamAccess?.primaryClient === true}
                canUploadEvidence={canUploadEvidence}
                projectId={project.id}
                payments={payments}
                onPaymentChanged={loadAll}
                projectName={project.name}
                projectCountry={project.country}
                projectCity={project.city ?? null}
                ownerName={
                  user?.user_metadata?.full_name ?? user?.email ?? 'Project Owner'
                }
                onMarkSubstageComplete={handleMarkSubstageComplete}
                onEvidenceUploaded={handleEvidenceUploaded}
                onApproveStage={handleApproveStage}
                renderEvidenceUpload={renderEvidenceUpload}
              />
              </div>
            </div>
          )}

          {/* Tab: Costing */}
          {activeTab === 'costing' && (
            <div className="space-y-4">
              <StagePricingPanel project={project} onChanged={loadAll} />
              <BudgetView project={project} stages={stages} payments={payments} />
            </div>
          )}

          {/* Tab: Team */}
          {activeTab === 'team' && <ProjectTeam key={scope} project={project} />}

          {/* Tab: Timeline */}
          {activeTab === 'timeline' && (
            <div>
              <TimelineTab
                project={project}
                stages={stages}
                onGoToStages={() => setActiveTab('stages')}
              />
            </div>
          )}

          {/* Tab: Documents */}
          {activeTab === 'documents' && (
            <div>
              {/* The contractor's documents view, shared (11 Nov). An invited client on
                  somebody else's build reads and does not upload — 112 makes them a
                  viewer, and the server refuses the write anyway. The owner and the
                  contractor working the build both file documents against it. */}
              <ClientDocuments
                projectId={project.id}
                userId={user?.id ?? ''}
                tier={project.tier}
                stages={stages}
                canUpload={isOwner || isContractor}
              />

            </div>
          )}

          {/* Tab: Messages */}
          {activeTab === 'messages' && user && (
            <div>
              <ProjectConversations
                projectId={project.id}
                projectName={project.name}
              />
            </div>
          )}

          {/* "Manage this project" and its Archive button lived here. Philip, 2 Nov
              2026: remove extraneous elements "to keep the focus strictly on moving
              through the project". Archiving is not a step in a build, and a
              destructive action at the foot of the page a client reads every day is
              the one thing on it they can do by accident. */}

        </motion.div>
        </ProjectMoneyProvider>
      </div>
    </div>
  );
}
