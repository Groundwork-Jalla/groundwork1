import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateBudget, formatUSD, formatUSDFull } from '@/lib/budget';
import { exportBudgetPDF } from '@/lib/pdf/export-budget';
import type { ProjectRow, ProjectStageRow, StageStatus } from '@/types/project';

// ── Types ────────────────────────────────────────────────────

export interface BudgetViewProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
}

// ── Constants ────────────────────────────────────────────────

const BUDGET_SLICES = [
  { label: 'Materials',          pct: 41, key: 'materials'   as const },
  { label: 'Labor',              pct: 23, key: 'labor'       as const },
  { label: 'Engineering',        pct: 16, key: 'engineering' as const },
  { label: 'Proj. Management',   pct: 10, key: 'management'  as const },
  { label: 'Contingency',        pct: 8,  key: 'contingency' as const },
  { label: 'Permits',            pct: 2,  key: 'permits'     as const },
] as const;

// ── Helpers ──────────────────────────────────────────────────

function sumMilestones(
  stages: ProjectStageRow[],
  predicate: (s: ProjectStageRow) => boolean,
): number {
  return stages
    .filter(predicate)
    .reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Status badge ─────────────────────────────────────────────

function StatusBadge({ status }: { status: StageStatus }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-off-white border border-brand-border-grey px-1.5 py-px text-[9px] font-medium text-brand-mid-grey uppercase tracking-wide">
        Complete
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-near-black px-1.5 py-px text-[9px] font-semibold text-white uppercase tracking-wide">
        Active
      </span>
    );
  }
  if (status === 'pending_review') {
    return (
      <span className="inline-flex items-center rounded-full border border-brand-border-grey px-1.5 py-px text-[9px] font-medium text-brand-mid-grey uppercase tracking-wide">
        In Review
      </span>
    );
  }
  // locked
  return (
    <span className="inline-flex items-center rounded-full border border-brand-border-grey bg-white px-1.5 py-px text-[9px] font-medium text-brand-border-grey uppercase tracking-wide">
      Locked
    </span>
  );
}

const SLICE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'] as const;

// ── Overview budget bar (animated) ───────────────────────────

function OverviewBar({
  label,
  pct,
  amount,
  index,
}: {
  label: string;
  pct: number;
  amount: number;
  index: number;
}) {
  const color = SLICE_COLORS[index % SLICE_COLORS.length];
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex items-center gap-1.5 w-28 shrink-0">
        <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs text-brand-mid-grey truncate">{label}</span>
      </div>
      <div className="relative flex-1 h-1.5 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: 'easeOut', delay: 0.12 + index * 0.07 }}
          style={{ originX: 0, width: `${pct}%`, backgroundColor: color }}
          className="absolute inset-y-0 left-0 rounded-full"
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-medium text-brand-near-black dark:text-white tabular-nums">
        {formatUSD(amount)}
      </span>
      <span className="w-7 shrink-0 text-right text-[10px] text-brand-mid-grey tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

// ── Per-stage bar ────────────────────────────────────────────

function StageBar({ stage }: { stage: ProjectStageRow }) {
  const isComplete = stage.status === 'complete';
  const isActive   = stage.status === 'active';
  const isReview   = stage.status === 'pending_review';

  const barColor = isComplete ? '#22c55e' : isActive ? '#3b82f6' : isReview ? '#f59e0b' : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'text-sm font-medium truncate',
              stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white',
            )}
          >
            {stage.name}
          </span>
          <StatusBadge status={stage.status} />
        </div>
        <span className="shrink-0 text-xs text-brand-mid-grey tabular-nums whitespace-nowrap">
          {formatUSDFull(stage.payment_milestone_usd ?? 0)}{' '}
          <span className="text-[10px]">({stage.budget_pct}%)</span>
        </span>
      </div>

      {/* Bar track */}
      <div className="relative h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
        {isComplete && (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ originX: 0, backgroundColor: barColor }}
            className="absolute inset-0 rounded-full"
          />
        )}
        {(isActive || isReview) && (
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ backgroundColor: barColor }}
            className="absolute inset-0 rounded-full"
          />
        )}
        {/* locked: no fill, grey track only */}
      </div>
    </div>
  );
}

// ── Timeline dot ─────────────────────────────────────────────

function TimelineDot({ status }: { status: StageStatus }) {
  if (status === 'complete') {
    return <span className="flex size-3 rounded-full shrink-0" style={{ backgroundColor: '#22c55e' }} />;
  }
  if (status === 'active') {
    return (
      <span className="relative flex size-3 shrink-0 items-center justify-center">
        <motion.span
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inline-flex size-3 rounded-full"
          style={{ backgroundColor: '#3b82f6' }}
        />
        <span className="relative inline-flex size-3 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
      </span>
    );
  }
  if (status === 'pending_review') {
    return <span className="flex size-3 rounded-full shrink-0" style={{ backgroundColor: '#f59e0b' }} />;
  }
  // locked
  return <span className="flex size-3 rounded-full border-2 border-brand-border-grey dark:border-[#444] bg-white dark:bg-[#1e1e1e] shrink-0" />;
}

// ── Metric box ───────────────────────────────────────────────

function MetricBox({
  label,
  value,
  dimmed,
}: {
  label: string;
  value: number;
  dimmed?: boolean;
}) {
  return (
    <div className="rounded-xl border border-brand-border-grey p-4 flex flex-col gap-1">
      <span className="text-xs text-brand-mid-grey">{label}</span>
      <span
        className={cn(
          'text-lg font-bold tabular-nums leading-snug',
          dimmed ? 'text-brand-mid-grey' : 'text-brand-near-black',
        )}
      >
        {value > 0 ? formatUSDFull(value) : '—'}
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export default function BudgetView({ project, stages }: BudgetViewProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExportPDF() {
    setExporting(true);
    try {
      await exportBudgetPDF(project, stages);
    } finally {
      setExporting(false);
    }
  }

  const budget = calculateBudget({
    country:         project.country,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  });

  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  const released  = sumMilestones(sortedStages, s => s.status === 'complete');
  const held      = sumMilestones(sortedStages, s => s.status === 'active' || s.status === 'pending_review');
  const remaining = sumMilestones(sortedStages, s => s.status === 'locked');
  const totalBudget = project.budget_usd ?? budget.total;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-col gap-6"
    >
      {/* ── Section 1: Budget Overview Card ────────────────── */}
      <div className="rounded-xl border border-brand-border-grey p-5">
        <div className="flex items-center justify-between mb-1 gap-3">
          <p className="text-sm font-medium text-brand-near-black">Budget Estimate</p>
          <div className="flex items-center gap-3 shrink-0">
            <p className="text-xs text-brand-mid-grey">USD · indicative</p>
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={exporting}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black border border-brand-border-grey rounded-lg px-2.5 py-1 hover:bg-brand-off-white transition-colors disabled:opacity-50"
            >
              <Download className="size-3" />
              {exporting ? 'Exporting…' : 'PDF'}
            </button>
          </div>
        </div>

        <div className="mb-5">
          <span className="text-3xl font-black text-brand-near-black tabular-nums">
            {formatUSDFull(budget.total)}
          </span>
        </div>

        <div className="flex flex-col">
          {BUDGET_SLICES.map((slice, i) => (
            <OverviewBar
              key={slice.key}
              label={slice.label}
              pct={slice.pct}
              amount={budget[slice.key]}
              index={i}
            />
          ))}
        </div>

        <p className="mt-4 text-[11px] text-brand-mid-grey leading-relaxed">
          Indicative range. Final costs depend on local market conditions, site specifics, and contractor negotiations.
        </p>
      </div>

      {/* ── Section 2: 2×2 Summary Grid ────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricBox label="Total Budget" value={totalBudget} />
        <MetricBox label="Released"     value={released} dimmed={released === 0} />
        <MetricBox label="Held"         value={held}     dimmed={held === 0} />
        <MetricBox label="Remaining"    value={remaining} dimmed={remaining === 0} />
      </div>

      {/* ── Section 3: Per-Stage Budget Bars ───────────────── */}
      {sortedStages.length > 0 && (
        <div className="rounded-xl border border-brand-border-grey p-5">
          <p className="text-sm font-medium text-brand-near-black mb-4">Stage Breakdown</p>
          <div className="flex flex-col gap-4">
            {sortedStages.map(stage => (
              <StageBar key={stage.id} stage={stage} />
            ))}
          </div>
        </div>
      )}

      {/* ── Section 4: Payment Timeline ────────────────────── */}
      {sortedStages.length > 0 && (
        <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
          <p className="text-sm font-medium text-brand-near-black dark:text-white mb-5">Payment Timeline</p>

          <div className="flex flex-col">
            {sortedStages.map((stage, i) => {
              const isLast = i === sortedStages.length - 1;
              const isComplete = stage.status === 'complete';
              const isActive   = stage.status === 'active';
              const isReview   = stage.status === 'pending_review';

              return (
                <div key={stage.id} className="flex gap-4">
                  {/* Left: dot + connector line */}
                  <div className="flex flex-col items-center">
                    <div className="pt-0.5">
                      <TimelineDot status={stage.status} />
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 mt-1.5 mb-1" style={{
                        backgroundColor: isComplete ? '#22c55e' : '#e5e7eb',
                        minHeight: 28,
                      }} />
                    )}
                  </div>

                  {/* Right: content */}
                  <div className={cn('flex-1 pb-5', isLast && 'pb-0')}>
                    {isComplete ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-none" style={{ color: '#22c55e' }}>
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">released</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stage.name}</p>
                        {stage.completed_at && (
                          <p className="text-[10px] text-brand-mid-grey mt-0.5">{formatDate(stage.completed_at)}</p>
                        )}
                      </>
                    ) : isActive ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-none" style={{ color: '#3b82f6' }}>
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">held · in progress</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stage.name}</p>
                      </>
                    ) : isReview ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-none" style={{ color: '#f59e0b' }}>
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">awaiting approval</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stage.name}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium tabular-nums text-brand-mid-grey leading-none">
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal ml-1.5">locked</span>
                        </p>
                        <p className="text-[10px] text-brand-border-grey dark:text-[#555] mt-0.5">{stage.name}</p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
