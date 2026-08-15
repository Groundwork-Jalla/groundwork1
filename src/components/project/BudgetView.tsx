import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Layers, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { BUDGET_SLICES, formatUSD, formatUSDFull, projectBudget, sliceShares } from '@/lib/budget';
import { exportBudgetPDF } from '@/lib/pdf/export-budget';
import type { ProjectRow, ProjectStageRow, StageStatus, FloorRoom } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';

// ── Types ────────────────────────────────────────────────────

export interface BudgetViewProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
}

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
  const t = useT();
  const base = 'inline-flex items-center rounded-full px-1.5 py-px text-[9px] uppercase tracking-wide';

  if (status === 'complete') {
    return <span className={cn(base, 'border border-brand-border-grey bg-brand-off-white font-medium text-brand-mid-grey')}>{t('project.costing.statusComplete')}</span>;
  }
  if (status === 'active') {
    return <span className={cn(base, 'bg-brand-near-black font-semibold text-white')}>{t('project.costing.statusActive')}</span>;
  }
  if (status === 'pending_review') {
    return <span className={cn(base, 'border border-brand-border-grey font-medium text-brand-mid-grey')}>{t('project.costing.statusInReview')}</span>;
  }
  return <span className={cn(base, 'border border-brand-border-grey bg-white font-medium text-brand-border-grey')}>{t('project.costing.statusLocked')}</span>;
}

// Six shades, dark to light in slice order. Not six hues: these are shares of one
// budget, not six independent things, and a ramp says "parts of a whole" where a
// rainbow says "unrelated categories". It also leaves colour free to mean status.
const SLICE_SHADES = ['#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db'] as const;

// ── Overview budget bar (animated, expandable) ───────────────

/**
 * One budget line, openable to show where that money lands across the build.
 *
 * Philip's note on this screen was that an owner needs the granular figures without
 * exporting a PDF first. Only the CONSTRUCTION line distributes across stages — each
 * stage takes its `budget_pct` of it, which is exactly how the milestone amounts are
 * derived, so the numbers here reconcile with the payment schedule further down the page
 * rather than being a second, differently-rounded estimate.
 *
 * The other three lines do not distribute at all: design is paid at one stage, and permit
 * and professional are their own milestones. They render as flat rows with no disclosure,
 * because spreading a flat fee across seven stages would be inventing a schedule.
 */
function OverviewBar({
  label,
  pct,
  amount,
  index,
  stages,
  distributes = false,
}: {
  label: string;
  pct: number;
  amount: number;
  index: number;
  stages: ProjectStageRow[];
  /** Whether this line is shared out across the stage weights. Construction only. */
  distributes?: boolean;
}) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  const [open, setOpen] = useState(false);
  const color = SLICE_SHADES[index % SLICE_SHADES.length];

  // Stages carrying no budget share (Land Secured, Design, Exterior) would be $0 rows.
  const funded = stages.filter(s => (s.budget_pct ?? 0) > 0);

  return (
    <div className="border-b border-brand-off-white last:border-b-0 dark:border-[#242424]">
      <button
        type="button"
        onClick={() => distributes && setOpen(o => !o)}
        aria-expanded={distributes ? open : undefined}
        disabled={!distributes}
        className="flex w-full items-center gap-3 py-1.5 text-left transition-colors enabled:hover:bg-brand-off-white/60 dark:enabled:hover:bg-[#242424]"
      >
        <span className="flex w-28 shrink-0 items-center gap-1.5">
          <ChevronRight className={cn(
            'size-3 shrink-0 text-brand-mid-grey transition-transform',
            open && 'rotate-90',
            !distributes && 'invisible',
          )} />
          <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
          <span className="truncate text-xs text-brand-mid-grey">{label}</span>
        </span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-brand-light-grey dark:bg-[#282828]">
          <motion.span
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.55, ease: 'easeOut', delay: 0.12 + index * 0.07 }}
            style={{ originX: 0, width: `${pct}%`, backgroundColor: color }}
            className="absolute inset-y-0 left-0 rounded-full"
          />
        </span>
        <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-brand-near-black dark:text-white">
          {formatUSD(amount)}
        </span>
        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-brand-mid-grey">
          {pct}%
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pb-3 pl-9 pr-2 pt-1">
              <p className="mb-2 text-[10px] text-brand-mid-grey">
                {t('project.costing.acrossStages', { label })}
              </p>
              {funded.length === 0 ? (
                <p className="text-[11px] text-brand-mid-grey">{t('project.costing.noStageData')}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {funded.map(stage => (
                    <div key={stage.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="min-w-0 truncate text-brand-mid-grey">{stageLabel(stage)}</span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="text-brand-border-grey tabular-nums">{stage.budget_pct}%</span>
                        <span className="w-16 text-right font-medium tabular-nums text-brand-near-black dark:text-white">
                          {formatUSD(amount * ((stage.budget_pct ?? 0) / 100))}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Per-stage bar ────────────────────────────────────────────

function StageBar({ stage }: { stage: ProjectStageRow }) {
  const { stageLabel } = useStageLabels();
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
            {stageLabel(stage)}
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

// ── Per-floor cost distribution ────────────────────────────────

interface FloorCost {
  floor: number;
  label: string;
  amount: number;
  pct: number;
  rooms: FloorRoom | null;
}

function computeFloorCosts(total: number, numFloors: number, floorRooms: FloorRoom[] | null): FloorCost[] {
  if (numFloors <= 1) return [];

  // Base weights: GF heavier (carries foundation + substructure cost),
  // top floor slightly heavier (roofing), middle floors equal.
  const weights: number[] = Array.from({ length: numFloors }, (_, i) => {
    if (i === 0) return 1.45;
    if (i === numFloors - 1) return 1.1;
    return 1.0;
  });

  // Refine by room count per floor when wizard data is present.
  if (floorRooms && floorRooms.length > 0) {
    floorRooms.forEach(fr => {
      const roomCount = fr.bedrooms + fr.bathrooms + fr.livingRooms + fr.kitchens;
      const delta = (roomCount - 4) * 0.04; // 4 rooms = baseline
      if (weights[fr.floor] !== undefined) {
        weights[fr.floor] = Math.max(0.5, weights[fr.floor] + delta);
      }
    });
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);

  return weights.map((w, i) => {
    const roomData = floorRooms?.find(fr => fr.floor === i) ?? null;
    return {
      floor: i,
      label: i === 0 ? 'Ground Floor' : `Floor ${i}`,
      amount: Math.round(total * w / totalWeight),
      pct: Math.round((w / totalWeight) * 100),
      rooms: roomData,
    };
  });
}

function roomSummary(rooms: FloorRoom | null): string {
  if (!rooms) return '';
  const parts: string[] = [];
  if (rooms.bedrooms > 0)    parts.push(`${rooms.bedrooms} bed`);
  if (rooms.bathrooms > 0)   parts.push(`${rooms.bathrooms} bath`);
  if (rooms.livingRooms > 0) parts.push(`${rooms.livingRooms} living`);
  if (rooms.kitchens > 0)    parts.push(`${rooms.kitchens} kitchen`);
  return parts.join(' · ');
}

function FloorBreakdownSection({ total, numFloors, floorRooms }: {
  total: number;
  numFloors: number;
  floorRooms: FloorRoom[] | null;
}) {
  const t = useT();
  const floors = computeFloorCosts(total, numFloors, floorRooms);
  if (floors.length === 0) return null;

  const maxAmount = Math.max(...floors.map(f => f.amount));

  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="size-4 text-brand-mid-grey" />
        <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.costing.perFloor')}</p>
        <span className="ml-auto text-[10px] text-brand-mid-grey">{t('project.costing.floorsCount', { count: numFloors })}</span>
      </div>

      <div className="flex flex-col gap-4">
        {floors.map((fc, i) => (
          <div key={fc.floor}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-off-white dark:bg-[#282828] text-[9px] font-bold text-brand-near-black dark:text-white tabular-nums">
                  {fc.floor === 0 ? 'GF' : `F${fc.floor}`}
                </span>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-brand-near-black dark:text-white">{fc.label}</span>
                  {fc.rooms && (
                    <span className="ml-2 text-[10px] text-brand-mid-grey">{roomSummary(fc.rooms)}</span>
                  )}
                  {fc.floor === 0 && (
                    <span className="ml-2 text-[10px] text-brand-mid-grey">incl. foundation</span>
                  )}
                  {fc.floor === numFloors - 1 && numFloors > 1 && (
                    <span className="ml-2 text-[10px] text-brand-mid-grey">incl. roofing</span>
                  )}
                </div>
              </div>
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-xs font-bold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(fc.amount)}</span>
                <span className="text-[10px] text-brand-mid-grey tabular-nums">{fc.pct}%</span>
              </div>
            </div>

            <div className="relative h-2 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.55, ease: 'easeOut', delay: 0.08 + i * 0.06 }}
                style={{
                  originX: 0,
                  width: `${(fc.amount / maxAmount) * 100}%`,
                  // A floor is an identity, not a state — greyscale, darkest at
                  // ground and lightening upward, which also reads as the stack.
                  backgroundColor: fc.floor === 0
                    ? '#1f2937'
                    : fc.floor === numFloors - 1 ? '#9ca3af' : '#4b5563',
                }}
                className="absolute inset-y-0 left-0 rounded-full"
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[10px] text-brand-mid-grey leading-relaxed">
        Estimated by floor. Ground floor carries foundation and substructure costs; top floor includes roofing.
        Actual figures depend on your contractor's pricing.
      </p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export default function BudgetView({ project, stages }: BudgetViewProps) {
  const { stageLabel } = useStageLabels();
  const { lang } = useLanguage();
  const t = useT();
  const [exporting, setExporting] = useState(false);

  async function handleExportPDF() {
    setExporting(true);
    try {
      await exportBudgetPDF(project, stages, lang);
    } finally {
      setExporting(false);
    }
  }

  // One budget, one total. `projectBudget` resolves the owner's confirmed `budget_usd`
  // and only falls back to the engine estimate when there isn't one — so the slices
  // below are always shares of the figure printed above them.
  const budget = projectBudget(project);
  const shares = sliceShares(budget);

  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  const released  = sumMilestones(sortedStages, s => s.status === 'complete');
  const held      = sumMilestones(sortedStages, s => s.status === 'active' || s.status === 'pending_review');
  const remaining = sumMilestones(sortedStages, s => s.status === 'locked');

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
          <p className="text-sm font-medium text-brand-near-black">{t('project.costing.budgetEstimate')}</p>
          <div className="flex items-center gap-3 shrink-0">
            <p className="text-xs text-brand-mid-grey">{t('project.costing.usdIndicative')}</p>
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={exporting}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black border border-brand-border-grey rounded-lg px-2.5 py-1 hover:bg-brand-off-white transition-colors disabled:opacity-50"
            >
              <Download className="size-3" />
              {exporting ? t('project.costing.exporting') : t('project.costing.pdf')}
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
              label={t(slice.labelKey)}
              pct={shares[slice.key]}
              amount={budget[slice.key]}
              index={i}
              stages={sortedStages}
              distributes={slice.key === 'construction'}
            />
          ))}
        </div>

        <p className="mt-4 text-[11px] text-brand-mid-grey leading-relaxed">
          {t('project.costing.disclaimer')}
        </p>
      </div>

      {/* ── Section 2: 2×2 Summary Grid ────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricBox label={t('project.costing.totalBudget')} value={budget.total} />
        <MetricBox label={t('project.costing.released')}    value={released} dimmed={released === 0} />
        <MetricBox label={t('project.costing.held')}        value={held}     dimmed={held === 0} />
        <MetricBox label={t('project.costing.remaining')}   value={remaining} dimmed={remaining === 0} />
      </div>

      {/* ── Section 3: Per-Floor Breakdown (multi-floor only) ── */}
      {(project.num_floors ?? 1) > 1 && (
        <FloorBreakdownSection
          total={budget.total}
          numFloors={project.num_floors ?? 1}
          floorRooms={project.floor_rooms ?? null}
        />
      )}

      {/* ── Section 4: Per-Stage Budget Bars ───────────────── */}
      {sortedStages.length > 0 && (
        <div className="rounded-xl border border-brand-border-grey p-5">
          <p className="text-sm font-medium text-brand-near-black mb-4">{t('project.costing.stageBreakdown')}</p>
          <div className="flex flex-col gap-4">
            {sortedStages.map(stage => (
              <StageBar key={stage.id} stage={stage} />
            ))}
          </div>
        </div>
      )}

      {/* ── Section 5: Payment Timeline ────────────────────── */}
      {sortedStages.length > 0 && (
        <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
          <p className="text-sm font-medium text-brand-near-black dark:text-white mb-5">{t('project.costing.paymentTimeline')}</p>

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
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">{t('project.costing.releasedLabel')}</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stageLabel(stage)}</p>
                        {stage.completed_at && (
                          <p className="text-[10px] text-brand-mid-grey mt-0.5">{formatDate(stage.completed_at)}</p>
                        )}
                      </>
                    ) : isActive ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-none" style={{ color: '#3b82f6' }}>
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">{t('project.costing.heldInProgress')}</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stageLabel(stage)}</p>
                      </>
                    ) : isReview ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-none" style={{ color: '#f59e0b' }}>
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal text-brand-mid-grey ml-1.5">{t('project.costing.awaitingApproval')}</span>
                        </p>
                        <p className="text-xs text-brand-near-black dark:text-white mt-0.5">{stageLabel(stage)}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium tabular-nums text-brand-mid-grey leading-none">
                          {formatUSDFull(stage.payment_milestone_usd ?? 0)}
                          <span className="text-xs font-normal ml-1.5">{t('project.costing.lockedLabel')}</span>
                        </p>
                        <p className="text-[10px] text-brand-border-grey dark:text-[#555] mt-0.5">{stageLabel(stage)}</p>
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
