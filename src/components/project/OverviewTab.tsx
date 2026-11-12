import { useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
  X,
  Maximize2,
  Package,
  Users,
  Briefcase,
  Landmark,
  BarChart2,
  Scale,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { sumBillAmounts } from '@/lib/budget/bill-budget';
import {
  DESIGN_RATE_XAF_PER_M2,
  LABOR_PCT,
  MATERIAL_PCT,
  PERMIT_PCT_OF_BUILD,
  projectBudget,
  buildDurationDays,
  buildDurationMonths,
  professionalParts,
  CONTINGENCY_PCT,
  CONTRACT_LAWYER_XAF,
  PROJECT_MANAGER_PCT_OF_BUILD,
  QUANTITY_SURVEYOR_XAF_PER_MONTH,
  SITE_MANAGER_XAF_PER_MONTH,
} from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { WeatherWidget } from '@/components/ui/WeatherWidget';
import { MoneyValue } from './MoneyValue';
import { currentProjectStage, stageWorkReady } from '@/lib/projects/stage-progression';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectFeeRow, BudgetBreakdown } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';
import { useStageLabels } from '@/lib/stage-labels';
import { useDomainLabels } from '@/lib/domain-labels';
import { ProjectPayoutSummary } from './ProjectPayoutSummary';

// The predicted duration used to be `const PREDICTED_DAYS = 196` — the same seven months
// for a bungalow and an eight-storey block, which is what beta testers who had actually
// built in Cameroon rejected. It now comes from the project's own floor count. See
// src/lib/budget/timeline.ts for the rule.

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The step-by-step budget explainer popup lived here: StepBadge, FormulaBox and
// BudgetBreakdownModal, ~270 lines. It became unreachable in the 2 Nov overview
// cleanup, which removed the cost card that opened it — cost details belong in
// Costing — and was left behind by mistake. It also held the only copy of the
// sentence "finished to <finish_level> standard", which would have read "finished to
// standard standard" for every project created after the finish-level picker was
// removed on 7 Nov. Unreachable UI that still reads as live is worse than none.
// ── Stat card ─────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, valueSize = 'text-2xl',
}: {
  label: string; value: React.ReactNode; sub?: string; icon?: React.ReactNode; valueSize?: string;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col">
      {icon && (
        <div className="size-8 rounded-lg bg-brand-off-white dark:bg-[#252525] flex items-center justify-center mb-3 shrink-0">
          {icon}
        </div>
      )}
      <p className={cn('font-mono font-semibold tabular-nums leading-tight text-brand-near-black dark:text-white', valueSize)}>{value}</p>
      <p className="text-[10px] font-semibold text-brand-mid-grey uppercase tracking-widest mt-1">{label}</p>
      {sub && <p className="text-[11px] text-brand-mid-grey mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function CompletionCard({ pct, count, total }: { pct: number; count: number; total: number }) {
  const t = useT();
  const R = 32;
  const circ = 2 * Math.PI * R;
  const arc = circ * 0.75;
  const filled = arc * Math.min(pct / 100, 1);
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col items-center justify-center">
      <div className="relative w-21 h-21">
        <svg viewBox="0 0 88 88" className="w-full h-full" style={{ transform: 'rotate(-225deg)' }}>
          <circle cx="44" cy="44" r={R} fill="none" strokeWidth="5.5" strokeLinecap="round"
            stroke="currentColor" className="text-brand-border-grey dark:text-[#2c2c2c]"
            strokeDasharray={`${arc} ${circ}`} />
          <circle cx="44" cy="44" r={R} fill="none" strokeWidth="5.5" strokeLinecap="round"
            stroke="currentColor" className="text-brand-green transition-all duration-700"
            strokeDasharray={`${filled} ${circ}`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pb-1">
          <span className="text-xl font-black text-brand-near-black dark:text-white tabular-nums leading-none">{pct}%</span>
          <span className="text-[8px] font-bold text-brand-mid-grey uppercase tracking-widest">{t('project.overview.completeUpper')}</span>
        </div>
      </div>
      <p className="text-[10px] text-brand-mid-grey mt-2">{t('project.overview.ofStages', { done: count, total })}</p>
    </div>
  );
}

// ── Cost breakdown ────────────────────────────────────────

function CostBreakdownCard({ budget, project, stages, payments, onViewCosting, boq, historical, remaining, historicalAmount, remainingAmount }: {
  budget: BudgetBreakdown;
  project: ProjectRow;
  stages: ProjectStageRow[];
  payments: Map<string, StagePayment>;
  onViewCosting: () => void;
  /** Renders a stored USD figure in the project's own currency. See `useProjectMoney`. */
  boq?: boolean;
  historical?: number;
  remaining?: number;
  historicalAmount?: number | null;
  remainingAmount?: number | null;
}) {
  const t = useT();
  const total = budget.total;


  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
      <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.reviewFollowUp.costSummary')}</p>

      <div className="mt-3 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">{t(boq ? 'contractorMoney.contractValue' : 'project.overview.costPlanned')}</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-brand-near-black dark:text-white"><MoneyValue usd={total} amount={project.budget_amount} /></p>
      </div>
      <ProjectPayoutSummary project={project} stages={stages} refreshKey={payments} compact />

      {boq && (
        <dl className="mt-3 space-y-1 text-xs text-brand-mid-grey">
          {!!historical && <div className="flex justify-between gap-3"><dt>{t('project.overview.historicalValue')}</dt><dd className="font-semibold tabular-nums"><MoneyValue usd={historical} amount={historicalAmount} /></dd></div>}
          <div className="flex justify-between gap-3"><dt>{t('contractorMoney.stillToCome')}</dt><dd className="font-semibold tabular-nums"><MoneyValue usd={remaining ?? 0} amount={remainingAmount} /></dd></div>
        </dl>
      )}

      <button type="button" onClick={onViewCosting} className="mt-4 text-xs font-semibold text-brand-green underline underline-offset-4">
        {t('project.reviewFollowUp.fullCosting')}
      </button>
    </div>
  );
}

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;

interface OverviewTabProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
  substages: ProjectSubstageRow[];
  budget: BudgetBreakdown;
  payments: Map<string, StagePayment>;
  fees: ProjectFeeRow[];
  onViewCosting: () => void;
  onViewStage: () => void;
}

export default function OverviewTab({
  project, stages, substages, budget, payments, fees, onViewCosting, onViewStage,
}: OverviewTabProps) {
  const { stageLabel } = useStageLabels();
  const labels = useDomainLabels();
  const t = useT();

  // Saved native BOQ amounts and the project's saved FX basis are shared by both views.
  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);

  const daysActive = Math.max(0, Math.floor(
    (Date.now() - new Date(project.created_at).getTime()) / 86_400_000
  ));

  const completedCount = sortedStages.filter(s => s.status === 'complete').length;
  const completedPct   = sortedStages.length > 0 ? Math.round((completedCount / sortedStages.length) * 100) : 0;

  const activeStage = sortedStages.find(s => s.status === 'active' || s.status === 'pending_review');
  const nextStage = currentProjectStage(sortedStages);

  // What is happening on the stage in play right now. The overview names it and sends
  // the reader into the stage to act, rather than hosting the action itself.
  const activeSubs     = activeStage ? substages.filter(sub => sub.stage_id === activeStage.id) : [];
  const awaitingReview = activeSubs.filter(sub => sub.status === 'pending_review').length;
  const activeDone     = activeSubs.filter(sub => sub.status === 'complete').length;

  /**
   * The one figure this page now leads with: what is owed to open the next stage.
   *
   * `pre_existing` is excluded for the reason 103 gives — those stages read 'paid'
   * because nothing was ever owed on them, which is not the same as money having
   * moved, and asking a client to pay for work that predates their arrival is the
   * worst version of this card being wrong.
   */
  const nextPayment = nextStage ? payments.get(nextStage.id) : undefined;
  const receiptWaiting = nextPayment?.receipts?.length ? nextPayment.receipts.some(row => row.decision === 'pending') : nextPayment?.state === 'receipt_submitted';
  const requestedTopUp = nextPayment?.receipts?.some(row => row.decision === 'received' && row.requestedTopUp != null && !row.allowsWork);
  const unlockStage = nextStage && !stageWorkReady(nextStage, sortedStages, nextPayment, project.workflow_origin) ? nextStage : undefined;


  // Planned costs come from the saved schedule. Actual payouts are read separately
  // by ProjectPayoutSummary; a paid flag or completed stage cannot supply a receipt amount.
  const billableStages = sortedStages.filter(stage => !stage.pre_existing);
  const scheduledDesign = billableStages.filter(stage => stage.stage_key === 'designCompleted')
    .reduce((sum, stage) => sum + (stage.payment_milestone_usd ?? 0), 0);
  const scheduledStages = billableStages.reduce((sum, stage) => sum + (stage.payment_milestone_usd ?? 0), 0);
  const plannedConstruction = scheduledStages - scheduledDesign;
  const feePlanned = (kind: ProjectFeeRow['kind']) => fees.filter(fee => fee.kind === kind)
    .reduce((sum, fee) => sum + Number(fee.amount_usd ?? 0), 0);
  const hasObligations = billableStages.length > 0 || fees.length > 0;
  const plannedBySlice: BudgetBreakdown = project.budget_source === 'boq' ? budget : hasObligations ? {
    total: scheduledStages + fees.reduce((sum, fee) => sum + Number(fee.amount_usd ?? 0), 0),
    construction: plannedConstruction,
    material: plannedConstruction * MATERIAL_PCT,
    labor: plannedConstruction * LABOR_PCT,
    design: scheduledDesign,
    permit: feePlanned('permit'),
    professional: feePlanned('professional'),
    verification: feePlanned('verification'),
    contingency: feePlanned('contingency'),
  } : budget;

  const country     = findCountry(project.country);
  const projStart   = new Date(project.target_start ? `${project.target_start}T00:00:00` : project.created_at);
  const predictedDays = buildDurationDays(project.num_floors);
  const projEnd     = project.target_end
    ? new Date(`${project.target_end}T00:00:00`)
    : addDays(projStart, predictedDays);
  const daysLeft    = Math.max(0, Math.ceil((projEnd.getTime() - Date.now()) / 86_400_000));

  return (
    <>
      {/*
        The budget, payment and stage-progress breakdown modals were rendered here.
        Philip, 2 Nov 2026, asked for the cards that opened them to go — cost belongs
        in Costing, and the stage detail is the Stages tab's job — so the modals had
        no way left to be opened. Unreachable UI that still reads as live is worse
        than none: the next person maintains it.
      */}

      {/* Stat cards — full-width row, alone */}
      <div className="flex flex-col sm:flex-row gap-3">
        <StatCard
          label={t('project.overview.daysActive')}
          value={String(daysActive)}
          sub={t('project.overview.daysActiveSub')}
          valueSize="text-3xl"
          icon={<Clock className="size-4 text-brand-near-black dark:text-white" />}
        />
        <CompletionCard pct={completedPct} count={completedCount} total={sortedStages.length} />
        <StatCard
          label={t('project.overview.activeStage')}
          value={activeStage
            ? t('project.overview.nowInProgress')
            : completedCount === sortedStages.length
              ? t('project.overview.nowComplete')
              : t('project.overview.nowStarting')}
          sub={activeStage ? stageLabel(activeStage) : nextStage ? stageLabel(nextStage) : ''}
          valueSize="text-xl"
          icon={<CheckCircle2 className="size-4 text-brand-near-black dark:text-white" />}
        />
        <StatCard
          label={t('project.overview.nextMilestone')}
          value={nextStage ? <MoneyValue usd={nextStage.payment_milestone_usd} amount={nextStage.milestone_amount} /> : '—'}
          sub={nextStage ? t('project.overview.nextStarts', { date: fmtDate(projStart) }) : t('project.overview.allDone')}
          valueSize="text-lg"
          icon={<Landmark className="size-4 text-brand-near-black dark:text-white" />}
        />
      </div>

      {/* Latest from Site — full-width, alone below the stat cards */}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── Left column ────────────────────────────────── */}
        {/*
          Philip, 2 Nov 2026, reviewing this page: remove "redundant elements like stage
          progress breakdowns and cost allocation breakdowns", because "cost details
          belong in the costing section"; keep payment status, but show "the payment
          required to unlock the next stage rather than total amounts due".

          So the three cards that were here are one card. What a client opens this page
          to find out is what they have to do next, and the answer was buried under a
          donut of cost shares, a bar of money already spent, and a second copy of the
          stage list that the Stages tab renders in full.
        */}
        <div className="flex flex-col gap-6">

          {/* What it takes to open the next stage */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <p className="text-sm font-medium text-brand-near-black dark:text-white">
              {t('project.review.nextAction')}
            </p>

            {project.status === 'on_hold' ? <p className="mt-3 text-sm text-brand-mid-grey">{t('project.review.paused')}</p>
              : unlockStage ? <>
                <p className="mt-3 text-sm text-brand-near-black dark:text-white">{t('project.review.paymentFor', { stage: stageLabel(unlockStage) })}</p>
                <MoneyValue usd={unlockStage.payment_milestone_usd} amount={unlockStage.milestone_amount} className="mt-2 text-2xl font-semibold" />
                <p className="mt-2 text-xs text-brand-mid-grey">{t(receiptWaiting ? 'project.review.pendingReceipt' : requestedTopUp ? 'project.receiptFlow.topUpNext' : unlockStage.review_payment_pending ? 'project.receiptFlow.reviewedStagePayment' : 'project.overview.unlockHowTo')}</p>
              </> : <p className="mt-3 text-sm text-brand-mid-grey">{t(nextStage ? (awaitingReview > 0 ? 'project.review.reviewUpdates' : 'project.review.awaitingUpdates') : 'project.overview.allDone')}</p>}
            {nextStage && project.status !== 'on_hold' && <button type="button" onClick={onViewStage}
              className="mt-4 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover">
              {t(unlockStage && !receiptWaiting ? 'project.stages.receiptChoose' : 'project.review.openStage')}
            </button>}

          </div>

          <CostBreakdownCard
            budget={plannedBySlice}
            project={project}
            stages={stages}
            payments={payments}
            onViewCosting={onViewCosting}
            boq={project.budget_source === 'boq'}
            historical={sortedStages.filter(s => s.pre_existing).reduce((sum, s) => sum + (s.payment_milestone_usd ?? 0), 0)}
            remaining={sortedStages.filter(s => s.status !== 'complete').reduce((sum, s) => sum + (s.payment_milestone_usd ?? 0), 0)}
            historicalAmount={project.budget_precision != null ? sumBillAmounts(sortedStages.filter(s => s.pre_existing).map(s => s.milestone_amount), project.budget_precision) : null}
            remainingAmount={project.budget_precision != null ? sumBillAmounts(sortedStages.filter(s => s.status !== 'complete').map(s => s.milestone_amount), project.budget_precision) : null}
          />

          {/* The latest on the stage in play, with a way into it. */}

          {/* The Stage Progress card was here. Removed 7 Nov 2026 at Favour's
              request, finishing what the 2 Nov cleanup started: the ten circles and
              the per-stage substage list went then, and the bar that was left said
              the same thing as the Stages tab and the completion stat card above it.
              Three places counting the same stages is two too many. */}
        </div>

        {/* ── Right sidebar ─────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* The sidebar used to repeat the 10-circle stage tracker that already sits
              in the left column a few hundred pixels away. One tracker, in the panel
              that also carries the substage detail. */}

          {/* Weather */}
          <WeatherWidget countryCode={project.country} city={project.city} />

          {/* Days active + location */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3 flex items-center gap-3">
            <Clock className="size-4 text-brand-mid-grey shrink-0" />
            <div>
              <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{t('project.overview.daysActiveCount', { count: daysActive })}</p>
              <p className="text-[10px] text-brand-mid-grey">
                {t('project.overview.since', { date: new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })}
              </p>
            </div>
          </div>

          {/* Predicted timeline */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-2">{t('project.overview.predictedTimeline')}</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">{t('project.overview.start')}</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{fmtDate(projStart)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">{t('project.overview.projectedEnd')}</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{fmtDate(projEnd)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">{t('project.overview.daysRemaining')}</span>
                <span className={cn('text-xs font-medium tabular-nums', daysLeft === 0 ? 'text-state-alert' : 'text-brand-near-black dark:text-white')}>{daysLeft === 0 ? t('project.overview.overdue') : `${daysLeft}d`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">{t('project.overview.totalDuration')}</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{t('project.overview.approxDays', { days: predictedDays })}</span>
              </div>
            </div>
          </div>

          {/* Build location */}
          {country && (
            <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
              <p className="text-[10px] text-brand-mid-grey mb-1">{t('project.overview.buildLocation')}</p>
              <p className="text-sm font-medium text-brand-near-black dark:text-white">{country.flag} {labels.country(project.country)}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
