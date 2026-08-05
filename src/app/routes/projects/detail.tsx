import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft, MapPin, Building2, Layers, Home, Wrench,
  CalendarDays, BadgeCheck, ShieldCheck, Briefcase,
} from 'lucide-react';
import { useAuth }               from '@/contexts/AuthContext';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { supabase }              from '@/lib/supabase/client';
import {
  fetchProject,
  fetchProjectStages,
  fetchProjectSubstages,
}                                from '@/lib/supabase/projects';
import {
  markSubstageComplete,
  approveStage,
}                                from '@/lib/supabase/approvals';
import { calculateBudget, formatUSDFull } from '@/lib/budget';
import { findCountry }           from '@/lib/countries';
import { StageTracker }          from '@/components/project/StageTracker';
import EvidenceUpload            from '@/components/project/EvidenceUpload';
import BudgetView                from '@/components/project/BudgetView';
import DocumentVault             from '@/components/project/DocumentVault';
import ProjectChat               from '@/components/project/ProjectChat';
import ContractorInvite          from '@/components/project/ContractorInvite';
import OverviewTab               from '@/components/project/OverviewTab';
import TimelineTab               from '@/components/project/TimelineTab';
import ProjectPayments          from '@/components/project/ProjectPayments';
import StartTrackingGate         from '@/components/project/StartTrackingGate';
import RelatedGuides             from '@/components/project/RelatedGuides';
import type {
  ProjectRow, ProjectStageRow, ProjectSubstageRow,
  FinishLevel, ProjectTier, PaymentStatus,
}                                from '@/types/project';
import { useDomainLabels } from '@/lib/domain-labels';

// ── Label maps ────────────────────────────────────────────

const TIER_META: Record<string, { labelKey: TKey; icon: React.ReactNode }> = {
  self_verify:      { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3.5" />  },
  jalla_verify:     { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3.5" /> },
  jalla_management: { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3.5" />   },
  // legacy values
  starter:    { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3.5" />  },
  pro:        { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3.5" /> },
  enterprise: { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3.5" />   },
};

// ── Tab bar ───────────────────────────────────────────────

type Tab = 'overview' | 'stages' | 'costing' | 'timeline' | 'payments' | 'documents' | 'messages';

const OWNER_TABS: { id: Tab; labelKey: TKey }[] = [
  { id: 'overview',   labelKey: 'project.tabs.overview'  },
  { id: 'stages',     labelKey: 'project.tabs.stages'    },
  { id: 'costing',    labelKey: 'project.tabs.costing'   },
  { id: 'timeline',   labelKey: 'project.tabs.timeline'  },
  { id: 'payments',   labelKey: 'project.tabs.payments'  },
  { id: 'documents',  labelKey: 'project.tabs.documents' },
  { id: 'messages',   labelKey: 'project.tabs.messages'  },
];

const CONTRACTOR_TABS: { id: Tab; labelKey: TKey }[] = [
  { id: 'stages',   labelKey: 'project.tabs.stages'   },
  { id: 'messages', labelKey: 'project.tabs.messages' },
];

function TabBar({
  active, onChange, isContractor,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  isContractor: boolean;
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

export default function ProjectDetail() {
  const labels = useDomainLabels();
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const t        = useT();
  const { suggestLangForCountry } = useLanguage();

  const [project,   setProject]   = useState<ProjectRow | null>(null);
  const [stages,    setStages]    = useState<ProjectStageRow[]>([]);
  const [substages, setSubstages] = useState<ProjectSubstageRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // ── Data fetching ──────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!id) return;
    try {
      const [p, s, sub] = await Promise.all([
        fetchProject(id),
        fetchProjectStages(id),
        fetchProjectSubstages(id),
      ]);
      if (!p) { setError('Project not found.'); return; }
      setProject(p);
      setStages(s);
      setSubstages(sub);
    } catch {
      setError('Failed to load project.');
    }
  }, [id]);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // Default a francophone-market project to French. Only applies when the user
  // has never picked a language themselves — an explicit choice always wins.
  useEffect(() => {
    suggestLangForCountry(project?.country);
  }, [project?.country, suggestLangForCountry]);

  // Real-time: update stage payment_status when it changes in Supabase
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`project-stages-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'project_stages', filter: `project_id=eq.${id}` },
        (payload) => {
          const updated = payload.new as { id: string; payment_status: PaymentStatus };
          setStages(prev =>
            prev.map(s => s.id === updated.id ? { ...s, payment_status: updated.payment_status } : s),
          );
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // ── Event handlers ─────────────────────────────────────

  const handleMarkSubstageComplete = useCallback(async (substageId: string) => {
    if (!user || !project) return;
    await markSubstageComplete(substageId, project.tier, user.id);
    const isSelfVerify = project.tier === 'self_verify' || (project.tier as string) === 'starter';
    setSubstages(prev => prev.map(s =>
      s.id === substageId
        ? {
            ...s,
            status:      isSelfVerify ? 'complete' : 'pending_review',
            approved_by: isSelfVerify ? user.id : null,
            approved_at: isSelfVerify ? new Date().toISOString() : null,
          }
        : s,
    ));
  }, [user, project]);

  const handleEvidenceUploaded = useCallback((substageId: string, urls: string[]) => {
    setSubstages(prev => prev.map(s =>
      s.id === substageId ? { ...s, evidence_urls: urls } : s,
    ));
  }, []);

  const handleApproveStage = useCallback(async (stageId: string, stageNumber: number) => {
    if (!user || !project) return;
    await approveStage(project.id, stageId, stageNumber, user.id, project.tier);
    await loadAll();
  }, [user, project, loadAll]);

  const handleStagePaymentUpdate = useCallback((stageId: string, status: PaymentStatus) => {
    setStages(prev => prev.map(s => s.id === stageId ? { ...s, payment_status: status } : s));
  }, []);

  // Render prop — passes EvidenceUpload down without creating circular imports
  const renderEvidenceUpload = useCallback((props: {
    substageId: string;
    existingUrls: string[];
    onUploadComplete: (urls: string[]) => void;
  }) => {
    if (!project) return null;
    const stageId = substages.find(sub => sub.id === props.substageId)?.stage_id ?? '';
    const stageName = stages.find(s => s.id === stageId)?.name;
    const substageName = substages.find(sub => sub.id === props.substageId)?.name;
    return (
      <EvidenceUpload
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
  }, [project, stages, substages]);

  // ── Loading / error ────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  if (error || !project) {
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

  const budget  = calculateBudget({
    country:         project.country,
    city:            project.city ?? '',
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  });

  const tier       = TIER_META[project.tier];
  const scaleStr   = [
    `${project.num_floors} floor${project.num_floors > 1 ? 's' : ''}`,
    `${project.sqm} sqm`,
    project.bedrooms  > 0 ? `${project.bedrooms} bed`  : null,
    project.bathrooms > 0 ? `${project.bathrooms} bath` : null,
    project.has_boys_quarters ? `BQ ×${project.bq_rooms}` : null,
  ].filter(Boolean).join(' · ');

  const startDate  = project.target_start
    ? new Date(project.target_start).toLocaleDateString('en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const completedPct = stages.length > 0
    ? Math.round((stages.filter(s => s.status === 'complete').length / stages.length) * 100)
    : 0;

  const isContractor = user?.user_metadata?.role === 'contractor';
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
                  <span className="flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                    <span className="size-1.5 rounded-full bg-green-500 inline-block" />
                    {t('project.header.live')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                    <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                    {t('project.header.planning')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black dark:text-white">
                {tier.icon}
                {t(tier.labelKey)}
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
                  <p className="text-lg font-bold tabular-nums text-brand-near-black dark:text-white">
                    {project.budget_usd ? formatUSDFull(project.budget_usd) : '—'}
                  </p>
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
          <>
          <TabBar active={activeTab} onChange={setActiveTab} isContractor={isContractor} />

          {/* Tab: Overview */}
          {activeTab === 'overview' && (
            <OverviewTab
              project={project}
              stages={stages}
              substages={substages}
              budget={budget}
              onViewCosting={() => setActiveTab('costing')}
              onViewStage={() => setActiveTab('stages')}
            />
          )}

          {/* Tab: Stages */}
          {activeTab === 'stages' && (
            <div className="space-y-6">
              {!isContractor && (
                <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
                  <ContractorInvite
                    projectId={project.id}
                    userId={user?.id ?? ''}
                    projectName={project.name}
                    projectTier={project.tier}
                  />
                </div>
              )}
              <StageTracker
                stages={stages}
                substages={substages}
                tier={project.tier}
                userId={user?.id ?? ''}
                isContractor={isContractor}
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
              <RelatedGuides tab="stages" currentStage={activeStageNum} />
            </div>
          )}

          {/* Tab: Costing */}
          {activeTab === 'costing' && (
            <div>
              <BudgetView project={project} stages={stages} />
              <RelatedGuides tab="costing" />
            </div>
          )}

          {/* Tab: Timeline */}
          {activeTab === 'timeline' && (
            <div>
              <TimelineTab
                project={project}
                stages={stages}
                onGoToStages={() => setActiveTab('stages')}
              />
              <RelatedGuides tab="timeline" />
            </div>
          )}

          {/* Tab: Payments */}
          {activeTab === 'payments' && (
            <div>
              <ProjectPayments
                project={project}
                stages={stages}
                onPaymentUpdated={handleStagePaymentUpdate}
              />
              <RelatedGuides tab="payments" />
            </div>
          )}

          {/* Tab: Documents */}
          {activeTab === 'documents' && (
            <div>
              <DocumentVault
                projectId={project.id}
                userId={user?.id ?? ''}
                tier={project.tier}
              />
              <RelatedGuides tab="documents" />
            </div>
          )}

          {/* Tab: Messages */}
          {activeTab === 'messages' && user && (
            <div>
              <ProjectChat
                projectId={project.id}
                currentUserId={user.id}
                currentUserName={displayName}
              />
              <RelatedGuides tab="messages" />
            </div>
          )}
          </>

        </motion.div>
      </div>
    </div>
  );
}
