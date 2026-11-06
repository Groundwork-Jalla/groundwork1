import { useMemo, useState, useEffect } from 'react';
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
import {
  formatUSDFull,
  DESIGN_RATE_XAF_PER_M2,
  LABOR_PCT,
  MATERIAL_PCT,
  PERMIT_PCT_OF_BUILD,
  decomposeBudget,
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
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, BudgetBreakdown } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { useDomainLabels } from '@/lib/domain-labels';

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
  label: string; value: string; sub?: string; icon?: React.ReactNode; valueSize?: string;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col">
      {icon && (
        <div className="size-8 rounded-lg bg-brand-off-white dark:bg-[#252525] flex items-center justify-center mb-3 shrink-0">
          {icon}
        </div>
      )}
      <p className={cn('font-black tabular-nums leading-tight text-brand-near-black dark:text-white', valueSize)}>{value}</p>
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
            stroke="currentColor" className="text-brand-near-black dark:text-white transition-all duration-700"
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

function CostBreakdownCard({ budget, paid, paidTotal, outstanding }: {
  budget: BudgetBreakdown;
  paid: BudgetBreakdown;
  paidTotal: number;
  outstanding: number;
}) {
  const t = useT();
  const total = budget.total;
  const paidPct = total > 0 ? Math.min(Math.round((paidTotal / total) * 100), 100) : 0;

  const rows = [
    { label: t('project.overview.costConstruction'), planned: budget.construction, paid: paid.construction },
    { label: t('project.overview.costDesign'),       planned: budget.design,       paid: paid.design },
    { label: t('project.overview.costProfessional'), planned: budget.professional, paid: paid.professional },
    { label: t('project.overview.costPermit'),       planned: budget.permit,       paid: paid.permit },
    { label: t('project.overview.costVerification'), planned: budget.verification, paid: paid.verification },
    { label: t('project.overview.costContingency'),  planned: budget.contingency,  paid: paid.contingency },
  ].filter(r => r.planned > 0);

  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
      <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.overview.costTitle')}</p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: t('project.overview.costPlanned'), value: formatUSDFull(total), cls: '' },
          { label: t('project.overview.costPaid'), value: formatUSDFull(paidTotal), cls: 'text-state-complete' },
          { label: outstanding > 0 ? t('project.overview.costOutstanding') : t('project.overview.costUnder'), value: formatUSDFull(outstanding), cls: 'text-state-held' },
        ].map(c => (
          <div key={c.label} className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-2 py-2 text-center">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-brand-mid-grey">{c.label}</p>
            <p className={cn('text-sm font-bold tabular-nums', c.cls || 'text-brand-near-black dark:text-white')}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-light-grey dark:bg-[#282828]">
        <div className="h-full rounded-full bg-brand-near-black dark:bg-white" style={{ width: `${paidPct}%` }} />
      </div>
      <p className="mt-1.5 text-center text-[10px] text-brand-mid-grey">{t('project.overview.costFunded', { pct: paidPct })}</p>

      <div className="mt-4 space-y-2.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-[11px] text-brand-mid-grey">{r.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-light-grey dark:bg-[#282828]">
              <div className="h-full rounded-full bg-state-complete" style={{ width: `${Math.min(Math.round((r.paid / r.planned) * 100), 100)}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right text-[11px] font-medium tabular-nums text-brand-near-black dark:text-white">
              {formatUSDFull(r.planned)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;

function LatestFromSite({ substages }: { substages: ProjectSubstageRow[] }) {
  const t = useT();
  const [signedUrls, setSignedUrls] = useState<string[]>([]);
  const [signing, setSigning] = useState(false);

  const imagePaths = useMemo(() => {
    const paths: string[] = [];
    for (const sub of substages) {
      for (const url of sub.evidence_urls ?? []) {
        if (IMG_RE.test(url.split('?')[0])) {
          paths.push(url);
          if (paths.length === 4) return paths;
        }
      }
    }
    return paths;
  }, [substages]);

  useEffect(() => {
    if (imagePaths.length === 0) { setSignedUrls([]); return; }
    let cancelled = false;
    setSigning(true);
    Promise.all(imagePaths.map(p => getSignedEvidenceUrl(p)))
      .then(results => { if (!cancelled) setSignedUrls(results.filter(Boolean) as string[]); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSigning(false); });
    return () => { cancelled = true; };
  }, [imagePaths]);

  if (imagePaths.length === 0) return null;

  const colClass = imagePaths.length === 1 ? 'grid-cols-1' : imagePaths.length === 2 ? 'grid-cols-2' : imagePaths.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';
  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-brand-near-black dark:text-white">{t('project.overview.latestFromSite')}</p>
        <span className="text-[10px] text-brand-mid-grey">{imagePaths.length} photo{imagePaths.length !== 1 ? 's' : ''}</span>
      </div>
      {signing ? (
        <div className={cn('grid gap-2', colClass)}>
          {imagePaths.map((_, i) => (
            <div key={i} className="w-full aspect-video rounded-lg bg-brand-light-grey dark:bg-[#282828] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={cn('grid gap-2', colClass)}>
          {signedUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Site photo ${i + 1}`}
                className="w-full aspect-video object-cover rounded-lg hover:opacity-90 transition-opacity"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────

interface OverviewTabProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
  substages: ProjectSubstageRow[];
  budget: BudgetBreakdown;
  onViewCosting: () => void;
  onViewStage: () => void;
}

export default function OverviewTab({
  project, stages, substages, budget, onViewCosting, onViewStage,
}: OverviewTabProps) {
  const { stageLabel } = useStageLabels();
  const labels = useDomainLabels();
  const t = useT();

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);

  const daysActive = Math.max(0, Math.floor(
    (Date.now() - new Date(project.created_at).getTime()) / 86_400_000
  ));

  const completedCount = sortedStages.filter(s => s.status === 'complete').length;
  const completedPct   = sortedStages.length > 0 ? Math.round((completedCount / sortedStages.length) * 100) : 0;

  const activeStage = sortedStages.find(s => s.status === 'active' || s.status === 'pending_review');
  const nextStage   = sortedStages.find(s => s.status !== 'complete');

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
  const unlockStage = sortedStages.find(
    s => s.status !== 'complete' && !s.pre_existing && s.payment_status !== 'paid',
  );

  // `pre_existing` first: those stages read 'paid' through 090's legacy projection because
  // nothing is owed on them, which is not the same as money having moved (103).
  const paidTotal   = sortedStages.filter(s => !s.pre_existing && s.payment_status === 'paid').reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);
  // `budget` already resolves the owner's confirmed budget_usd (see projectBudget), so
  // the slices and this total are shares of one figure. Re-reading project.budget_usd
  // here is what used to make "41% × total = materials" a false statement.
  const totalBudget = budget.total;
  const outstanding = Math.max(0, totalBudget - paidTotal);

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
          sub={activeStage?.name ?? nextStage?.name ?? ''}
          valueSize="text-xl"
          icon={<CheckCircle2 className="size-4 text-brand-near-black dark:text-white" />}
        />
        <StatCard
          label={t('project.overview.nextMilestone')}
          value={nextStage ? formatUSDFull(nextStage.payment_milestone_usd ?? 0) : '—'}
          sub={nextStage ? t('project.overview.nextStarts', { date: fmtDate(projStart) }) : t('project.overview.allDone')}
          valueSize="text-lg"
          icon={<Landmark className="size-4 text-brand-near-black dark:text-white" />}
        />
      </div>

      {/* Latest from Site — full-width, alone below the stat cards */}
      <LatestFromSite substages={substages} />

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
              {t('project.overview.unlockTitle')}
            </p>

            {unlockStage ? (
              <>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-near-black dark:text-white">
                  {t('project.overview.unlockAmount', {
                    // The full figure, not the compact one: a client about to transfer money
                    // needs the exact amount, and $1k is not an amount anybody can pay.
                    amount: formatUSDFull(unlockStage.payment_milestone_usd ?? 0),
                    stage:  stageLabel(unlockStage),
                  })}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-mid-grey">
                  {t('project.overview.unlockHowTo')}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-brand-mid-grey">
                {t('project.overview.unlockAllPaid')}
              </p>
            )}
          </div>

          <CostBreakdownCard
            budget={budget}
            paid={decomposeBudget(paidTotal, { builtAreaSqm: Number(project.sqm) * project.num_floors, floors: project.num_floors })}
            paidTotal={paidTotal}
            outstanding={outstanding}
          />

          {/* The latest on the stage in play, with a way into it. */}
          {activeStage && (
            <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">
                {t('project.overview.latestTitle')}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-brand-mid-grey">
                {awaitingReview > 0
                  ? t('project.overview.latestReview', { count: awaitingReview, stage: stageLabel(activeStage) })
                  : t('project.overview.latestProgress', { done: activeDone, total: activeSubs.length, stage: stageLabel(activeStage) })}
              </p>
              <button
                type="button"
                onClick={onViewStage}
                className="mt-4 w-full rounded-xl border border-brand-border-grey py-2.5 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#2c2c2c]"
              >
                {awaitingReview > 0 ? t('project.overview.latestReviewCta') : t('project.overview.latestOpenCta')}
              </button>
            </div>
          )}

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
