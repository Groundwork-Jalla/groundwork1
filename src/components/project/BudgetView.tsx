import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, ChevronRight, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { BUDGET_SLICES, projectBudget, sliceShares } from '@/lib/budget';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { sliceDerivation, type SliceDerivation } from '@/lib/budget/derivation';
import { formatShare } from '@/lib/budget/stage-shares';
import { checkEstimate } from '@/lib/budget/sanity';
import { resolveCityRate } from '@/lib/budget/model';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import type { ConstructionRate } from '@/types/project';
import { TakeoffComparison } from '@/components/takeoff/TakeoffComparison';
import { exportBudgetPDF } from '@/lib/pdf/export-budget';
import { sumBillAmounts } from '@/lib/budget/bill-budget';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { fetchProjectDocuments } from '@/lib/supabase/contractor-work';
import type { StagePayment } from '@/lib/supabase/verifications';
import { ProjectPayoutSummary } from './ProjectPayoutSummary';
import { StageSchedule } from './StageSchedule';
import { MoneyValue } from './MoneyValue';
import { ProjectExchangeRateNote } from './ExchangeRateNote';
// One definition of what a stage is worth, shared with the contractor's screens.
// They print the same payment and used to disagree about it — see stage-amounts.ts.
import {
  stageBasisFor, stageScheduleUsd, sumPayableUsd, type StageBasis,
} from '@/lib/budget/stage-amounts';

// ── Types ────────────────────────────────────────────────────

export interface BudgetViewProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
  payments?: Map<string, StagePayment>;
  /** Admin's provider ledger is separate from direct client-to-contractor receipts. */
  showMilestoneBuckets?: boolean;
  allowBoqEditing?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

// Six shades, dark to light in slice order. Not six hues: these are shares of one
// budget, not six independent things, and a ramp says "parts of a whole" where a
// rainbow says "unrelated categories". It also leaves colour free to mean status.
const SLICE_SHADES = ['#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db'] as const;

// ── Overview budget bar (animated, expandable) ───────────────

/**
 * One budget line, openable to show how it was arrived at.
 *
 * Philip's note on this screen was that an owner needs the granular figures without
 * exporting a PDF first.
 *
 * EVERY line opens now. Only construction distributes across stages — each stage takes
 * its `budget_pct` of it, which is exactly how the milestone amounts are derived, so
 * those figures reconcile with the payment schedule below rather than being a second,
 * differently-rounded estimate. Spreading a flat fee across seven stages would still be
 * inventing a schedule, so the other three do not get one.
 *
 * What they get instead is their derivation, which is what was actually missing. Favour:
 * the tab "only has a drop down for the construction... it doesn't have a drop down for
 * design... professional fees or permits", and construction itself "doesn't show the
 * breakdown between actual construction, material cost, and labor cost". A fee with no
 * visible arithmetic reads as arbitrary, which is the opposite of the point of the
 * screen. See lib/budget/derivation.ts.
 */
function OverviewBar({
  label,
  pct,
  amount,
  index,
  stages,
  distributes = false,
  derivation,
  stageConstructionTotal,
  stageBasis,
}: {
  label: string;
  pct: number;
  amount: number;
  index: number;
  stages: ProjectStageRow[];
  /** Whether this line is shared out across the stage weights. Construction only. */
  distributes?: boolean;
  /** How this line is calculated. Every slice has one. */
  derivation?: SliceDerivation | null;
  /** Full-construction basis for the stage split on joined projects. */
  stageConstructionTotal?: number | null;
  stageBasis?: StageBasis;
}) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  // Every figure on this page is shown in the project's currency — 9 Nov 2026.
  // See project-money-context.tsx: the conversion is a rendering decision only.
  const [open, setOpen] = useState(false);
  const color = SLICE_SHADES[index % SLICE_SHADES.length];

  // Stages carrying no budget share (Land Secured, Design, Exterior) would be $0 rows.
  const funded = stages.filter(s => (s.budget_pct ?? 0) > 0);
  const stageBase = stageConstructionTotal ?? amount;
  const openable = distributes || !!derivation;

  return (
    <div className="border-b border-brand-off-white last:border-b-0 dark:border-[#242424]">
      <button
        type="button"
        onClick={() => openable && setOpen(o => !o)}
        aria-expanded={openable ? open : undefined}
        disabled={!openable}
        className="flex w-full items-center gap-3 py-1.5 text-left transition-colors enabled:hover:bg-brand-off-white/60 dark:enabled:hover:bg-[#242424]"
      >
        <span className="flex w-28 shrink-0 items-center gap-1.5">
          <ChevronRight className={cn(
            'size-3 shrink-0 text-brand-mid-grey transition-transform',
            open && 'rotate-90',
            !openable && 'invisible',
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
          <MoneyValue usd={amount} />
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
              {/* The arithmetic first — it explains the figure on the row above. The
                  stage schedule below it answers a different question (when), and only
                  construction has one. */}
              {derivation && (
                <div className={cn('flex flex-col gap-1', distributes && 'mb-3')}>
                  {derivation.rows.map(row => (
                    <div key={row.labelKey} className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="min-w-0 text-brand-mid-grey">{t(row.labelKey, row.params)}</span>
                      {row.amount != null && (
                        <span className="w-20 shrink-0 text-right font-medium tabular-nums text-brand-near-black dark:text-white">
                          <MoneyValue usd={row.amount} />
                        </span>
                      )}
                    </div>
                  ))}
                  {derivation.noteKey && (
                    <p className="mt-1 text-[10px] leading-relaxed text-brand-mid-grey">
                      {t(derivation.noteKey)}
                    </p>
                  )}
                </div>
              )}

              {distributes && (
              <>
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
                        <span className="text-brand-border-grey tabular-nums">{formatShare(stage.budget_pct)}</span>
                        <span className="w-16 text-right font-medium tabular-nums text-brand-near-black dark:text-white">
                          <MoneyValue usd={stageScheduleUsd(stage, stageBasis ?? { wholeProject: false, base: stageBase })} amount={stage.milestone_amount} />
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Per-stage bar ────────────────────────────────────────────

function MetricBox({
  label,
  value,
  dimmed,
  sourceAmount,
}: {
  label: string;
  value: number;
  dimmed?: boolean;
  sourceAmount?: number | null;
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
        <MoneyValue usd={value} amount={sourceAmount} />
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export default function BudgetView({ project, stages, payments, showMilestoneBuckets = true, allowBoqEditing = false }: BudgetViewProps) {
  const { stageLabel } = useStageLabels();
  const { lang } = useLanguage();
  const t = useT();
  // The same currency and rate the page is rendering with, so the downloaded report
  // cannot disagree with the screen it came from.
  const fx = useProjectMoneyContext();
  const [exporting, setExporting] = useState(false);
  const [hasBoq, setHasBoq] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchProjectDocuments(project.id)
      .then(docs => { if (alive) setHasBoq(docs.some(d => d.category === 'boq')); })
      .catch(() => { if (alive) setHasBoq(false); });
    return () => { alive = false; };
  }, [project.id]);
  // The country rate row, for its rule-of-thumb reference figure. Same pattern as
  // ProjectPayments and TakeoffComparison; a failure leaves it null, which switches the
  // check off rather than surfacing a fetch error on a costing screen.
  const [sanityRate, setSanityRate] = useState<ConstructionRate | null>(null);
  useEffect(() => {
    let live = true;
    getConstructionRate(project.country)
      .then(r => { if (live) setSanityRate(r); })
      .catch(() => {});
    return () => { live = false; };
  }, [project.country]);

  async function handleExportPDF() {
    setExporting(true);
    try {
      await exportBudgetPDF(project, stages, lang, fx ? { code: fx.code, rate: fx.rate } : undefined);
    } finally {
      setExporting(false);
    }
  }

  // One budget, one total. `projectBudget` resolves the owner's confirmed `budget_usd`
  // and only falls back to the engine estimate when there isn't one — so the slices
  // below are always shares of the figure printed above them.
  const budget = projectBudget(project);
  const shares = sliceShares(budget);
  // Footprint x floors — the same built area the design fee is charged on, so the
  // dropdown shows the figure the fee was actually calculated from.
  const builtAreaSqm = (project.sqm ?? 0) * (project.num_floors ?? 1);

  // Floor check against the regional reference — see lib/budget/sanity.ts. This is where
  // it earns its keep: `budget.total` is the owner's own confirmed figure whenever they
  // have set one, and a person can type anything. Warning on their number is deliberate —
  // the advice, have a contractor check a total this low for a building this size, is
  // sound whoever arrived at it.
  //
  // The reference rate lives on the country row (migration 073), so this waits for the
  // fetch rather than guessing. Until it lands `sanityRate` is null and the check simply
  // returns "not comparable", which renders nothing.
  const sanity = checkEstimate(budget.total, {
    sqm:      project.sqm,
    floors:   project.num_floors,
    rate:     sanityRate,
    cityRate: resolveCityRate(project.city, project.country),
  });

  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  // An uploaded Bill of Quantities already is the whole figure, so each stage is its
  // percentage of the project total. A build from scratch keeps the fees (permit, project
  // manager, contingency, ...) on top, and its stages are shares of construction alone.
  const basis = stageBasisFor(project, sortedStages, project.budget_source === 'boq' || hasBoq);
  const stageConstructionTotal = basis.base;

  const historicalStages = sortedStages.filter(s => s.pre_existing);
  const historical = sumPayableUsd(historicalStages, basis);

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
          <p className="text-sm font-medium text-brand-near-black">{t((project.pricing_revision ?? 0)>0 ? 'project.priceChanges.approvedTotal' : project.budget_source === 'boq' ? 'project.review.confirmedBillTotal' : 'project.costing.budgetEstimate')}</p>
          <div className="flex items-center gap-3 shrink-0">
            <p className="text-xs text-brand-mid-grey">{t(project.budget_source === 'boq' || (project.pricing_revision ?? 0)>0 ? 'project.review.savedUsdRate' : 'project.costing.usdIndicative')}</p>
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
          <span className="text-3xl font-mono font-semibold text-brand-near-black tabular-nums">
            <MoneyValue usd={budget.total} amount={project.budget_amount} />
            <ProjectExchangeRateNote/>
          </span>
        </div>

        <div className="flex flex-col">
          {BUDGET_SLICES.filter(slice => project.budget_source !== 'boq' || slice.key === 'construction').map((slice, i) => (
            <OverviewBar
              key={slice.key}
              label={t(slice.labelKey)}
              pct={shares[slice.key]}
              amount={budget[slice.key]}
              index={i}
              stages={sortedStages}
              distributes={slice.key === 'construction'}
              derivation={project.budget_source === 'boq' || (project.pricing_revision ?? 0)>0 ? undefined : sliceDerivation(slice.key, budget, builtAreaSqm)}
              stageConstructionTotal={slice.key === 'construction' ? stageConstructionTotal : null}
              stageBasis={basis}
            />
          ))}
        </div>

        {project.budget_source !== 'boq' && !(project.pricing_revision ?? 0) && sanity.low && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
            <TriangleAlert className="size-4 shrink-0 mt-px text-amber-600" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-amber-900 leading-snug">
                {t('wizard.lowEstimateTitle')}
              </p>
              <p className="mt-1 text-[11px] text-amber-800 leading-relaxed">
                {t('wizard.lowEstimateBody')}
              </p>
            </div>
          </div>
        )}

        <p className="mt-4 text-[11px] text-brand-mid-grey leading-relaxed">
          {t((project.pricing_revision ?? 0)>0 ? 'project.priceChanges.approvedNote' : project.budget_source === 'boq' ? 'project.review.confirmedBillNote' : 'project.costing.disclaimer')}
        </p>
      </div>

      {/*
        What contractors actually quoted, beside what we estimated. Renders nothing until
        a take-off has been submitted, so the tab is unchanged for projects with none.
      */}

      {/* ── Section 2: 2×2 Summary Grid ────────────────────── */}
      {allowBoqEditing && <TakeoffComparison project={project} />}
      <div className="grid grid-cols-2 gap-3">
        <MetricBox label={t('project.costing.totalBudget')} value={budget.total} />
        {historical > 0 && <MetricBox label={t('project.overview.historicalValue')} value={historical}
          sourceAmount={project.budget_precision != null ? sumBillAmounts(historicalStages.map(s => s.milestone_amount), project.budget_precision) : null} />}
      </div>
      {showMilestoneBuckets && <ProjectPayoutSummary project={project} stages={stages} refreshKey={payments} />}

      {sortedStages.length > 0 && <StageSchedule project={project} stages={sortedStages} basis={basis} payments={payments} />}

    </motion.div>
  );
}
