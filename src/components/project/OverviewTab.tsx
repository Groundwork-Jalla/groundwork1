import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Clock, Lock, AlertCircle, X, Info,
  Maximize2, Package, Users, Briefcase, Landmark, BarChart2, Scale, RefreshCw, Plus, Check, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import {
  formatUSDFull, formatUSD,
  BUDGET_SLICES, CHARGED_STAGE_COUNT, DESIGN_RATE_XAF_PER_M2, LABOR_PCT, MATERIAL_PCT,
  PERMIT_PCT_OF_BUILD, PROFESSIONAL_FEE_XAF, decomposeBudget, projectBudget, sliceShares,
  type BudgetSliceKey,
} from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { WeatherWidget } from '@/components/ui/WeatherWidget';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import RelatedGuides from '@/components/project/RelatedGuides';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, BudgetBreakdown } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { useDomainLabels } from '@/lib/domain-labels';

const PREDICTED_DAYS = 196;

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

// ── Budget allocation donut ──────────────────────────────

// A local copy of this list used to live here with its own percentages. It has been
// deleted: BUDGET_SLICES is imported from @/lib/budget, and the shares are derived from
// the amounts by `sliceShares` so the legend cannot disagree with the figures.
//
// Greyscale, dark to light in legend order — the same ramp the dashboard donut uses, so
// the same four categories read identically on both screens. Colour on this page marks
// stage state (active, awaiting review, overdue); a category is not a state, and four
// hues competing with those made the states harder to pick out.
const SLICE_DESC: Record<BudgetSliceKey, TKey> = {
  construction: 'project.overview.catConstructionDesc',
  design:       'project.overview.catDesignDesc',
  professional: 'project.overview.catProfessionalDesc',
  permit:       'project.overview.catPermitDesc',
};

function BudgetDonut({
  total,
  budget,
  onBreakdown,
}: {
  total: number;
  budget: BudgetBreakdown;
  onBreakdown: () => void;
}) {
  const t     = useT();
  const size  = 180;
  const cx    = size / 2;
  const cy    = size / 2;
  const r     = 64;
  const sw    = 22;
  const circ  = 2 * Math.PI * r;

  const shares = sliceShares(budget);

  let offset = 0;
  const arcs = BUDGET_SLICES.map(s => {
    const pct  = shares[s.key];
    const dash = (pct / 100) * circ;
    const arc  = { ...s, pct, descKey: SLICE_DESC[s.key], dash, gap: circ - dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.overview.costingAllocation')}</p>
        <button
          type="button"
          onClick={onBreakdown}
          className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
        >
          <Info className="size-3" /> {t('project.overview.howCalculated')}
        </button>
      </div>

      <p className="text-xs text-brand-mid-grey -mt-3">
        {t('project.overview.biggestCostPre')}{' '}
        <span className="font-semibold text-brand-near-black dark:text-white">{t('project.costing.sliceConstruction')}</span>{' '}
        {t('project.overview.biggestCostMid')} <span className="font-semibold text-brand-near-black dark:text-white">{shares.construction}%</span> {t('project.overview.biggestCostPost')}
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            {arcs.map(arc => (
              <circle
                key={arc.key}
                cx={cx} cy={cy} r={r} fill="none"
                stroke={arc.color}
                strokeWidth={sw}
                strokeDasharray={`${arc.dash} ${arc.gap}`}
                strokeDashoffset={-arc.offset}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-lg font-black text-brand-near-black dark:text-white tabular-nums leading-none">{formatUSDFull(total)}</p>
            <p className="text-[9px] text-brand-mid-grey mt-1">{t('project.overview.totalBudgetSmall')}</p>
          </div>
        </div>

        {/* Legend with descriptions */}
        <div className="flex flex-col gap-3 flex-1 w-full">
          {arcs.map(s => (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs font-medium text-brand-near-black dark:text-white">{t(s.labelKey)}</span>
                </div>
                <span className="text-xs font-bold text-brand-near-black dark:text-white tabular-nums">{s.pct}%</span>
              </div>
              <p className="text-[10px] text-brand-mid-grey pl-4">{t(s.descKey)}</p>
            </div>
          ))}
          <p className="text-[10px] text-brand-mid-grey border-t border-brand-off-white dark:border-[#2c2c2c] pt-2">
            {t('project.overview.explain.totalEstimatedCost')} <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(total)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Budget breakdown popup — step-by-step ────────────────

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-xs font-black">
      {n}
    </span>
  );
}

function FormulaBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-lg bg-brand-off-white dark:bg-[#111] border border-brand-border-grey dark:border-[#333] px-4 py-2.5 font-mono text-xs text-brand-near-black dark:text-white leading-relaxed">
      {children}
    </div>
  );
}

function BudgetBreakdownModal({
  total,
  project,
  budget,
  paidTotal,
  outstanding,
  onClose,
}: {
  total: number;
  project: ProjectRow;
  budget: BudgetBreakdown;
  paidTotal: number;
  outstanding: number;
  onClose: () => void;
}) {
  const t = useT();
  const countryName = useDomainLabels().country(project.country);
  const paidPct   = total > 0 ? Math.round((paidTotal / total) * 100) : 0;
  const builtArea = Number(project.sqm) * project.num_floors;

  // The shares are exact for a whole-dollar total; a total carrying cents can leave a
  // penny in the allocator, so the formula says "≈" rather than claiming a false "=".
  const eq = Number.isInteger(total) ? '=' : '≈';

  // Payments are recorded per STAGE, not per category, so "paid by category" is an
  // apportionment of what has been paid — not observed data. Allocating it keeps the
  // rows summing to `paidTotal` instead of drifting like the old 0.41/0.23/… did.
  const paidSplit = decomposeBudget(paidTotal, { builtAreaSqm: builtArea });
  const floorNote   = project.num_floors > 1
    ? `Your build has ${project.num_floors} floors. Adding floors costs less than doubling everything — foundation and roof are shared — so each extra floor adds proportionally less.`
    : 'Your build is a single storey. No floor multiplier applies.';

  const STEPS: { icon: React.ReactNode; title: string; amount: number | null; pct: number | null; body: string | null; formula: string | null }[] = [
    {
      icon: <Maximize2 className="size-4 text-brand-mid-grey" />,
      title: 'Start with the size of your build',
      amount: null,
      pct: null,
      body: `Your project is ${project.sqm} sqm across ${project.num_floors} floor${project.num_floors !== 1 ? 's' : ''}, finished to ${project.finish_level} standard. ${floorNote}`,
      formula: `${project.sqm} sqm  ×  ${project.num_floors} floor${project.num_floors !== 1 ? 's' : ''}  (${project.finish_level} finish)`,
    },
    {
      icon: <Package className="size-4 text-brand-mid-grey" />,
      title: 'Price the construction itself',
      amount: budget.construction,
      pct: null,
      body: `Every trade on site, measured as a quantity surveyor would measure it: excavation, foundation, blockwork, the frame, roofing, doors and windows, electrical, plumbing, plaster and paint. Priced against real Bill of Quantity data for ${countryName}. Of this, about ${MATERIAL_PCT}% is material (${formatUSDFull(budget.material)}) and ${LABOR_PCT}% is labor (${formatUSDFull(budget.labor)}).`,
      formula: `Materials (${MATERIAL_PCT}%)  +  Labor (${LABOR_PCT}%)\n→  ${formatUSDFull(budget.material)}  +  ${formatUSDFull(budget.labor)}  ${eq}  ${formatUSDFull(budget.construction)}`,
    },
    {
      icon: <Briefcase className="size-4 text-brand-mid-grey" />,
      title: 'Add the design fee',
      amount: budget.design,
      pct: null,
      body: 'Architectural and structural drawings — the plans your contractor builds from and the permit office approves. Charged on the built area, so it scales with the size of the building rather than with what it costs to build.',
      formula: `${DESIGN_RATE_XAF_PER_M2.toLocaleString()} XAF  ×  ${builtArea} m² built  ${eq}  ${formatUSDFull(budget.design)}`,
    },
    {
      icon: <Users className="size-4 text-brand-mid-grey" />,
      title: 'Add the professional fee',
      amount: budget.professional,
      pct: null,
      body: 'Groundwork\'s own fee: stage-by-stage supervision, verification of the work before each payment is released, and coordination with your contractor. Charged per construction stage, so it does not grow with the size of your budget.',
      formula: `${PROFESSIONAL_FEE_XAF.toLocaleString()} XAF  ×  ${CHARGED_STAGE_COUNT} stages  ${eq}  ${formatUSDFull(budget.professional)}`,
    },
    {
      icon: <Landmark className="size-4 text-brand-mid-grey" />,
      title: 'Add the building permit',
      amount: budget.permit,
      pct: null,
      body: `Planning approval, building permit and lands registry in ${countryName}. Assessed against the value of the construction work, so it is charged as a percentage of that — not of the total above.`,
      formula: `${PERMIT_PCT_OF_BUILD}%  ×  ${formatUSDFull(budget.construction)}  ${eq}  ${formatUSDFull(budget.permit)}`,
    },
    {
      icon: <Plus className="size-4 text-brand-mid-grey" />,
      title: 'Add it all up',
      amount: total,
      pct: 100,
      body: null,
      formula: null,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c] shrink-0">
          <div>
            <p className="text-base font-bold text-brand-near-black dark:text-white">{t('project.overview.explain.budgetTitle')}</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">{t('project.overview.explain.budgetSub')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Intro card */}
          <div className="rounded-xl bg-brand-off-white dark:bg-[#252525] border border-brand-border-grey dark:border-[#333] px-4 py-3 text-xs text-brand-mid-grey leading-relaxed">
            {t('project.overview.explain.bucketsIntro')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.bMaterials')}</strong> {t('project.overview.explain.bMaterialsParen')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.bLabor')}</strong> {t('project.overview.explain.bLaborParen')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.bFees')}</strong> {t('project.overview.explain.bFeesParen')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.bPermits')}</strong> {t('project.overview.explain.bPermitsParen')}
          </div>

          {/* Steps 1–5 */}
          {STEPS.slice(0, 5).map((step, i) => (
            <div key={i} className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
                <div className="flex items-center gap-3">
                  <StepBadge n={i + 1} />
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center justify-center">{step.icon}</span>
                    <span className="text-sm font-semibold text-brand-near-black dark:text-white">{step.title}</span>
                  </div>
                </div>
                {step.amount != null && (
                  <span className="text-sm font-black text-brand-near-black dark:text-white tabular-nums shrink-0 ml-2">
                    {formatUSDFull(step.amount)}
                  </span>
                )}
              </div>
              <div className="px-4 py-3">
                {step.body && <p className="text-xs text-brand-mid-grey leading-relaxed">{step.body}</p>}
                {step.formula && <FormulaBox>→ {step.formula}</FormulaBox>}
              </div>
            </div>
          ))}

          {/* Step 6 — Summary table */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
              <StepBadge n={6} />
              <BarChart2 className="size-4 text-brand-mid-grey" />
              <span className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.overview.explain.addItUp')}</span>
            </div>
            <div className="px-4 py-3 text-xs">
              <p className="text-brand-mid-grey mb-3">{t('project.overview.explain.sumOfFour')}</p>
              <table className="w-full">
                <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
                  {[
                    { label: 'Construction',        amount: budget.construction },
                    { label: '+ Design',            amount: budget.design       },
                    { label: '+ Professional fee',  amount: budget.professional },
                    { label: '+ Permit',            amount: budget.permit       },
                  ].map(r => (
                    <tr key={r.label}>
                      <td className="py-1.5 text-brand-mid-grey">{r.label}</td>
                      <td className="py-1.5 text-right font-medium text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-brand-near-black dark:border-white">
                    <td className="pt-2 font-bold text-brand-near-black dark:text-white">{t('project.overview.explain.total')}</td>
                    <td className="pt-2 text-right font-black text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Plan vs Actual */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="size-4 text-brand-mid-grey" />
                <span className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.overview.explain.planVsActual')}</span>
              </div>
              <span className="text-[10px] text-brand-mid-grey">{t('project.overview.explain.basedOnRecorded')}</span>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'PLANNED',       value: formatUSDFull(total),       cls: '' },
                  { label: 'PAID SO FAR',   value: formatUSDFull(paidTotal),   cls: 'text-state-complete dark:text-state-complete' },
                  { label: outstanding > 0 ? 'OUTSTANDING' : 'UNDER BUDGET', value: formatUSDFull(outstanding), cls: 'text-state-held dark:text-state-held' },
                ].map(c => (
                  <div key={c.label} className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2 text-center">
                    <p className="text-[8px] font-semibold text-brand-mid-grey uppercase tracking-wider mb-1">{c.label}</p>
                    <p className={cn('text-sm font-black tabular-nums', c.cls || 'text-brand-near-black dark:text-white')}>{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-4">
                <motion.div className="h-full rounded-full bg-brand-near-black dark:bg-white" initial={{ width: 0 }} animate={{ width: `${Math.min(paidPct, 100)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
              </div>
              <p className="text-[10px] text-center text-brand-mid-grey mb-4">{paidPct}% of your project is funded so far</p>
              {[
                { label: 'Construction',      planned: budget.construction, paid: paidSplit.construction },
                { label: 'Design',            planned: budget.design,       paid: paidSplit.design       },
                { label: 'Professional fee',  planned: budget.professional, paid: paidSplit.professional },
                { label: 'Permit',            planned: budget.permit,       paid: paidSplit.permit       },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-3 mb-2">
                  <span className="w-32 shrink-0 text-[10px] text-brand-mid-grey">{r.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
                    <motion.div className="h-full rounded-full bg-state-complete" initial={{ width: 0 }} animate={{ width: `${r.planned > 0 ? Math.min(Math.round((r.paid / r.planned) * 100), 100) : 0}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                  </div>
                  <span className="text-[10px] font-medium text-brand-near-black dark:text-white tabular-nums shrink-0 w-28 text-right">{formatUSDFull(r.paid)} / {formatUSDFull(r.planned)}</span>
                </div>
              ))}
              <p className="text-[9px] text-brand-mid-grey mt-3 leading-relaxed">
                {t('project.overview.explain.splitNote')}
              </p>
            </div>
          </div>

          {/* Why these percentages */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-4">
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">{t('project.overview.explain.whyPercentages')}</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              {t('project.overview.explain.percentagesBody')}
            </p>
            {project.finish_level !== 'standard' && (
              <p className="text-xs text-brand-mid-grey leading-relaxed mt-2">
                {t('project.overview.explain.finishPrefix')} <strong className="text-brand-near-black dark:text-white">{project.finish_level}</strong> {t('project.overview.explain.finishSuffix')}
              </p>
            )}
            <p className="text-[9px] text-brand-border-grey mt-3">{t('project.overview.explain.deepDive')}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Payment status bar (horizontal, with axis) ────────────

function PaymentBar({
  paidTotal,
  outstanding,
  totalBudget,
  onHowCalculated,
}: {
  paidTotal: number;
  outstanding: number;
  totalBudget: number;
  onHowCalculated: () => void;
}) {
  const t = useT();
  const paidPct = totalBudget > 0 ? (paidTotal / totalBudget) * 100 : 0;
  const paidPctRounded = Math.round(paidPct);

  // Axis ticks at 0%, 25%, 50%, 75%, 100%
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    pct: f * 100,
    label: f === 0 ? '$0' : fmtCompact(Math.round(totalBudget * f)),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.overview.paymentStatus')}</p>
        <button
          type="button"
          onClick={onHowCalculated}
          className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
        >
          <Info className="size-3" /> {t('project.overview.explain.howCalculated')}
        </button>
      </div>

      <p className="text-xs text-brand-mid-grey mb-4">
        {t('project.overview.paidSummary', {
          paid: formatUSDFull(paidTotal),
          total: formatUSDFull(totalBudget),
          pct: paidPctRounded,
        })}{' '}
        <span className="font-medium text-brand-near-black dark:text-white">
          {t('project.overview.stillDue', { amount: formatUSDFull(outstanding) })}
        </span>
      </p>

      {/* 50% mid marker */}
      <div className="relative mb-1 h-4">
        <div className="absolute left-1/2 top-0 flex flex-col items-center -translate-x-1/2">
          <span className="text-[9px] text-brand-mid-grey">50%</span>
          <div className="w-px h-2 bg-brand-border-grey dark:bg-[#444] mt-0.5" />
        </div>
      </div>

      {/* The bar */}
      <div className="flex h-11 rounded-xl overflow-hidden relative">
        <motion.div
          className="bg-brand-near-black dark:bg-white flex items-center justify-center relative"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(paidPct, paidPct > 0 ? 5 : 0)}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          {paidPctRounded >= 10 && (
            <span className="text-xs font-bold text-white dark:text-brand-near-black tabular-nums">{paidPctRounded}%</span>
          )}
          {/* Tooltip at right edge of green */}
          {paidPctRounded > 0 && paidPctRounded < 90 && (
            <div className="absolute -right-px top-0 bottom-0 w-px bg-white/40 z-10" />
          )}
        </motion.div>
        <div className="flex-1 bg-brand-light-grey dark:bg-[#282828] flex items-center justify-center">
          {(100 - paidPctRounded) >= 10 && (
            <span className="text-xs font-bold text-brand-mid-grey tabular-nums">{100 - paidPctRounded}%</span>
          )}
        </div>
      </div>

      {/* Dollar axis */}
      <div className="relative h-6 mt-1">
        {ticks.map(tick => (
          <span
            key={tick.pct}
            className="absolute text-[9px] text-brand-mid-grey -translate-x-1/2"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-5 mt-1">
        <span className="flex items-center gap-1.5 text-xs text-brand-mid-grey">
          <span className="size-2.5 rounded-sm bg-brand-near-black dark:bg-white" />
          {t('project.overview.explain.paidLabel')} <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(paidTotal)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-brand-mid-grey">
          <span className="size-2.5 rounded-sm bg-brand-light-grey dark:bg-[#282828]" />
          {t('project.overview.explain.outstandingLabel')} <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(outstanding)}</span>
        </span>
      </div>
    </div>
  );
}

// ── Payment breakdown popup — detailed ───────────────────

function PaymentBreakdownModal({
  stages,
  totalBudget,
  paidTotal,
  outstanding,
  onClose,
}: {
  stages: ProjectStageRow[];
  totalBudget: number;
  paidTotal: number;
  outstanding: number;
  onClose: () => void;
}) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  const sorted  = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  const paidPct = totalBudget > 0 ? Math.round((paidTotal / totalBudget) * 100) : 0;

  const pill = (s: string) => {
    if (s === 'paid')    return 'bg-brand-off-white dark:bg-state-complete/30 text-state-complete dark:text-state-complete border border-state-complete/30 dark:border-state-complete';
    if (s === 'partial') return 'bg-brand-off-white dark:bg-state-held/30 text-state-held dark:text-state-held border border-state-held/30 dark:border-state-held';
    return 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-mid-grey';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c] shrink-0">
          <div>
            <p className="text-base font-bold text-brand-near-black dark:text-white">{t('project.overview.explain.paymentsTitle')}</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">{t('project.overview.explain.paymentsSub')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Where you are right now */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">{t('project.overview.explain.whereYouAre')}</p>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'TOTAL BUDGET',  value: formatUSDFull(totalBudget),  cls: '' },
                  { label: 'PAID',          value: formatUSDFull(paidTotal),    cls: 'text-state-complete dark:text-state-complete' },
                  { label: 'OUTSTANDING',   value: formatUSDFull(outstanding),  cls: 'text-state-held dark:text-state-held' },
                ].map(c => (
                  <div key={c.label} className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-2 py-2 text-center">
                    <p className="text-[8px] font-semibold text-brand-mid-grey uppercase tracking-wider mb-1">{c.label}</p>
                    <p className={cn('text-sm font-black tabular-nums', c.cls || 'text-brand-near-black dark:text-white')}>{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-2">
                <motion.div className="h-full rounded-full bg-brand-near-black dark:bg-white" initial={{ width: 0 }} animate={{ width: `${Math.min(paidPct, 100)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
              </div>
              <p className="text-[10px] text-center text-brand-mid-grey">{paidPct}% of your project is funded so far</p>
            </div>
          </div>

          {/* Three statuses explained */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">{t('project.overview.explain.threeStatuses')}</p>
            </div>
            <div className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {[
                {
                  icon: <span className="size-8 rounded-full border-2 border-brand-border-grey dark:border-[#444] flex items-center justify-center shrink-0"><Lock className="size-3 text-brand-mid-grey" /></span>,
                  label: 'Unpaid',
                  desc: 'No payment has been recorded for this stage yet. The full milestone amount is still owed.',
                },
                {
                  icon: <span className="size-8 rounded-full border-2 border-state-held flex items-center justify-center shrink-0"><CheckCircle2 className="size-3.5 text-state-held" /></span>,
                  label: 'Partial',
                  desc: "You've paid something towards this stage, but not the full milestone amount. The remainder is still outstanding.",
                },
                {
                  icon: <span className="size-8 rounded-full border-2 border-state-complete bg-brand-off-white dark:bg-state-complete/20 flex items-center justify-center shrink-0"><CheckCircle2 className="size-3.5 text-state-complete" /></span>,
                  label: 'Paid',
                  desc: 'The full stage milestone amount has been recorded as paid. Nothing more is owed for this stage.',
                },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-3 px-4 py-3">
                  {s.icon}
                  <div>
                    <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-0.5">{s.label}</p>
                    <p className="text-xs text-brand-mid-grey leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How payments get recorded */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-4">
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">{t('project.overview.explain.howRecorded')}</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed mb-2">
              {t('project.overview.explain.recordBody')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.recordPayment')}</strong>. {t('project.overview.explain.recordBodyEnd')}
            </p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              {t('project.overview.explain.partPayments')}
            </p>
            <div className="mt-3 rounded-lg bg-brand-off-white dark:bg-brand-rich-black border border-brand-border-grey dark:border-[#333] px-3 py-2 text-[10px] text-brand-mid-grey">
              {t('project.overview.explain.ledgerBody')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.paymentsTab')}</strong> {t('project.overview.explain.ledgerBodyEnd')}
            </div>
          </div>

          {/* Per-stage breakdown table */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525] flex items-center justify-between">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">{t('project.overview.explain.stageBreakdown')}</p>
              <p className="text-[10px] text-brand-mid-grey tabular-nums">{formatUSDFull(totalBudget)} total</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-off-white dark:bg-brand-rich-black border-b border-brand-border-grey dark:border-[#2c2c2c]">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">{t('project.overview.explain.colStage')}</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">{t('project.overview.explain.colMilestone')}</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">{t('project.overview.explain.colStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
                  {sorted.map(s => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 text-xs text-brand-near-black dark:text-white">
                        <span className="text-brand-mid-grey mr-2 tabular-nums">{s.stage_number}.</span>{stageLabel(s)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-brand-near-black dark:text-white tabular-nums">
                        {formatUSDFull(s.payment_milestone_usd ?? 0)}
                        <span className="text-[9px] font-normal text-brand-mid-grey ml-1">({s.budget_pct}%)</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', pill(s.payment_status))}>
                          {s.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Stage progress modal — detailed ──────────────────────

function StageProgressModal({
  stages,
  completedCount,
  completedPct,
  activeStage,
  onClose,
}: {
  stages: ProjectStageRow[];
  completedCount: number;
  completedPct: number;
  activeStage: ProjectStageRow | undefined;
  onClose: () => void;
}) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  const expectedStage = completedCount + 1;
  const actualStage   = activeStage?.stage_number ?? completedCount;
  const variance      = actualStage - expectedStage;
  const pace          = variance > 0 ? 'Ahead of schedule' : variance < 0 ? 'Behind schedule' : 'On track';
  const paceIcon      = variance > 0 ? '↗' : variance < 0 ? '↘' : '—';
  const paceColor     = variance > 0 ? 'text-state-complete dark:text-state-complete' : variance < 0 ? 'text-state-alert dark:text-state-alert' : 'text-brand-mid-grey';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c] shrink-0">
          <div>
            <p className="text-base font-bold text-brand-near-black dark:text-white">{t('project.overview.explain.paceTitle')}</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">{t('project.overview.explain.paceSub')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Current pace snapshot */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525] flex items-center justify-between">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">{t('project.overview.explain.paceNow')}</p>
              <p className="text-[10px] text-brand-mid-grey">{t('project.overview.completionUpper')}</p>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn('text-xl font-black', paceColor)}>{paceIcon}</span>
                <span className={cn('text-base font-black', paceColor)}>{pace}</span>
              </div>
              <span className="text-2xl font-black text-brand-near-black dark:text-white tabular-nums">{completedPct}%</span>
            </div>
          </div>

          {/* Steps */}
          {([
            {
              n: 1,
              icon: <CheckCircle2 className="size-4 text-brand-mid-grey" />,
              title: 'Count what\'s been signed off',
              badge: `${completedCount} of ${stages.length}`,
              body: 'We count every stage that has been approved and marked complete — either by you (self-verify) or after a Jalla site visit. Stages that are just "in progress" don\'t count yet.',
              formula: `Completed stages: ${completedCount}  •  Total stages: ${stages.length}`,
            },
            {
              n: 2,
              icon: <RefreshCw className="size-4 text-brand-mid-grey" />,
              title: 'Find the stage you\'re working on',
              badge: activeStage ? `${activeStage.stage_number}. ${stageLabel(activeStage)}` : completedCount === stages.length ? 'All done' : 'Not started',
              body: 'We look for the first stage with status In Progress or Awaiting Approval. That\'s your actual position in the build.',
              formula: null,
            },
            {
              n: 3,
              icon: <Scale className="size-4 text-brand-mid-grey" />,
              title: 'Compare actual vs expected',
              badge: variance === 0 ? 'Even' : variance > 0 ? `+${variance} ahead` : `${variance} behind`,
              body: `Expected position = the stage you'd be on if every previous stage were already done. So if ${completedCount} stages are complete, you're "expected" to be on stage ${expectedStage}.`,
              formula: `Variance = actual (${actualStage}) - expected (${expectedStage}) = ${variance}\n\n↗ Variance > 0 → Ahead of schedule  (you skipped or fast-tracked a stage)\n— Variance = 0 → On track\n↘ Variance < 0 → Behind schedule  (a stage is stuck or unstarted)`,
            },
            {
              n: 4,
              icon: <BarChart2 className="size-4 text-brand-mid-grey" />,
              title: 'The progress bar',
              badge: `${completedPct}%`,
              body: `The big bar at the top of the card is simply completed ÷ total stages. It only fills when a stage is fully signed off — so it's a conservative, honest read of progress (not a guess).`,
              formula: `${completedCount} ÷ ${stages.length} × 100 = ${completedPct}%`,
            },
          ] as { n: number; icon: React.ReactNode; title: string; badge: string; body: string; formula: string | null }[]).map(step => (
            <div key={step.n} className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
                <div className="flex items-center gap-3">
                  <StepBadge n={step.n} />
                  <span className="flex items-center justify-center">{step.icon}</span>
                  <span className="text-sm font-semibold text-brand-near-black dark:text-white">{step.title}</span>
                </div>
                <span className="text-xs font-bold text-brand-near-black dark:text-white shrink-0 ml-2">{step.badge}</span>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-brand-mid-grey leading-relaxed">{step.body}</p>
                {step.formula && <FormulaBox>→ {step.formula}</FormulaBox>}
              </div>
            </div>
          ))}

          {/* Why not time-based */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-4">
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">{t('project.overview.explain.whyNotTimeBased')}</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              {t('project.overview.explain.paceBody')} <strong className="text-brand-near-black dark:text-white">{t('project.overview.explain.stageProgression')}</strong> {t('project.overview.explain.paceBodyEnd')}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

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

// ── Stage status icon ─────────────────────────────────────

function StageIcon({ status }: { status: string }) {
  if (status === 'complete')       return <CheckCircle2 className="size-3.5 text-brand-near-black dark:text-white shrink-0" />;
  if (status === 'active')         return <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity }} className="size-3.5 rounded-full border-2 border-brand-near-black dark:border-white bg-transparent shrink-0 inline-block" />;
  if (status === 'pending_review') return <AlertCircle className="size-3.5 text-state-held shrink-0" />;
  return <Lock className="size-3 text-brand-border-grey shrink-0" />;
}

// ── Latest from Site ──────────────────────────────────────
// Returns null if no evidence images exist — no placeholder.

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

// ── Stage row with substage check-marks ──────────────────
// Design A gives the horizontal pipeline its visibility; Design B's vertical
// check-marks are what actually tell you how far through a stage the work is.
// Philip asked for both: the stage list keeps A's scannability, and each stage
// opens to B's ticked substage list rather than sending you to another tab.
//
// The active stage starts open — it is the only one where the answer changes
// day to day, and making the reader click to reach it defeats the purpose.

function SubstageChecks({ substages }: { substages: ProjectSubstageRow[] }) {
  const { substageLabel } = useStageLabels();
  const { t, tPlural } = useLanguage();

  if (substages.length === 0) {
    return <p className="py-2 pl-8 text-xs text-brand-mid-grey">{t('project.overview.noSubstages')}</p>;
  }

  return (
    <div className="flex flex-col pb-1 pl-8">
      {substages.map(sub => {
        const done = sub.status === 'complete';
        const review = sub.status === 'pending_review';
        return (
          <div key={sub.id} className="flex items-center gap-2.5 py-1.5">
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border-[1.5px]',
                done
                  ? 'border-brand-near-black bg-brand-near-black dark:border-white dark:bg-white'
                  : review
                    ? 'border-state-held bg-brand-off-white dark:bg-state-held/20'
                    : 'border-brand-border-grey dark:border-[#2c2c2c]',
              )}
            >
              {done && <Check className="size-2.5 stroke-3 text-white dark:text-brand-near-black" />}
              {review && <span className="size-1.5 rounded-full bg-state-held" />}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                done ? 'text-brand-mid-grey line-through' : 'text-brand-near-black dark:text-white',
              )}
            >
              {substageLabel(sub)}
            </span>
            {sub.evidence_urls.length > 0 && (
              <span className="shrink-0 text-[10px] tabular-nums text-brand-mid-grey">
                {tPlural('project.overview.evidenceCount', sub.evidence_urls.length)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StageWithSubstages({
  stage, substages, defaultOpen,
}: {
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  defaultOpen: boolean;
}) {
  const { stageLabel } = useStageLabels();
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  const mine = substages
    .filter(s => s.stage_id === stage.id)
    .sort((a, b) => a.substage_number - b.substage_number);
  const done = mine.filter(s => s.status === 'complete').length;

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <StageIcon status={stage.status} />
          <span className={cn('truncate text-sm', stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
            {stageLabel(stage)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {mine.length > 0 && (
            <span className="text-[10px] tabular-nums text-brand-mid-grey">{done}/{mine.length}</span>
          )}
          <span className={cn('text-[9px] font-medium uppercase tracking-wide', {
            'text-brand-mid-grey': stage.status === 'complete',
            'text-brand-near-black dark:text-white': stage.status === 'active',
            'text-state-held': stage.status === 'pending_review',
            'text-brand-border-grey': stage.status === 'locked',
          })}>
            {stage.status === 'complete' ? t('project.overview.statusDone')
              : stage.status === 'active' ? t('project.overview.statusProgress')
              : stage.status === 'pending_review' ? t('project.overview.statusReview')
              : t('project.overview.statusLocked')}
          </span>
          <ChevronDown className={cn('size-3.5 text-brand-mid-grey transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && <SubstageChecks substages={mine} />}
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
  const [showBudgetBreakdown, setShowBudgetBreakdown]   = useState(false);
  const [showPaymentBreakdown, setShowPaymentBreakdown] = useState(false);
  const [showStageProgress, setShowStageProgress]       = useState(false);

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);

  const daysActive = Math.max(0, Math.floor(
    (Date.now() - new Date(project.created_at).getTime()) / 86_400_000
  ));

  const completedCount = sortedStages.filter(s => s.status === 'complete').length;
  const completedPct   = sortedStages.length > 0 ? Math.round((completedCount / sortedStages.length) * 100) : 0;

  const activeStage = sortedStages.find(s => s.status === 'active' || s.status === 'pending_review');
  const nextStage   = sortedStages.find(s => s.status !== 'complete');

  const paidTotal   = sortedStages.filter(s => s.payment_status === 'paid').reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);
  // `budget` already resolves the owner's confirmed budget_usd (see projectBudget), so
  // the slices and this total are shares of one figure. Re-reading project.budget_usd
  // here is what used to make "41% × total = materials" a false statement.
  const totalBudget = budget.total;
  const outstanding = Math.max(0, totalBudget - paidTotal);

  const country     = findCountry(project.country);
  const projStart   = new Date(project.target_start ?? project.created_at);
  const projEnd     = addDays(projStart, PREDICTED_DAYS);
  const daysLeft    = Math.max(0, Math.ceil((projEnd.getTime() - Date.now()) / 86_400_000));

  return (
    <>
      <AnimatePresence>
        {showBudgetBreakdown && (
          <BudgetBreakdownModal
            total={totalBudget}
            project={project}
            budget={budget}
            paidTotal={paidTotal}
            outstanding={outstanding}
            onClose={() => setShowBudgetBreakdown(false)}
          />
        )}
        {showPaymentBreakdown && (
          <PaymentBreakdownModal
            stages={sortedStages}
            totalBudget={totalBudget}
            paidTotal={paidTotal}
            outstanding={outstanding}
            onClose={() => setShowPaymentBreakdown(false)}
          />
        )}
        {showStageProgress && (
          <StageProgressModal
            stages={sortedStages}
            completedCount={completedCount}
            completedPct={completedPct}
            activeStage={activeStage}
            onClose={() => setShowStageProgress(false)}
          />
        )}
      </AnimatePresence>

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
        <div className="flex flex-col gap-6">

          {/* Costing allocation donut */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <BudgetDonut total={totalBudget} budget={budget} onBreakdown={() => setShowBudgetBreakdown(true)} />
          </div>

          {/* Payment status bar */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <PaymentBar
              paidTotal={paidTotal}
              outstanding={outstanding}
              totalBudget={totalBudget}
              onHowCalculated={() => setShowPaymentBreakdown(true)}
            />
          </div>

          {/* Stage progress */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.overview.stageProgress')}</p>
              <button type="button" onClick={() => setShowStageProgress(true)} className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
                <Info className="size-3" /> {t('project.overview.explain.howCalculated')}
              </button>
            </div>
            <p className="text-xs text-brand-mid-grey mb-3">
              {t('project.overview.stagesComplete', { done: completedCount, total: sortedStages.length })}{activeStage ? <> — {t('project.overview.currentlyOn')} <span className="font-medium text-brand-near-black dark:text-white">{stageLabel(activeStage)}</span></> : ''}
            </p>

            <div className="h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-4">
              <motion.div className="h-full bg-brand-near-black dark:bg-white rounded-full" initial={{ width: 0 }} animate={{ width: `${completedPct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
            </div>

            {/* 10-circle stage tracker */}
            <div className="grid grid-cols-5 gap-3 mb-4">
              {sortedStages.map(stage => (
                <div key={stage.id} className="flex flex-col items-center gap-1.5">
                  <div className={cn(
                    'size-10 rounded-full border-2 flex items-center justify-center',
                    stage.status === 'complete'       ? 'bg-brand-near-black dark:bg-white border-brand-near-black dark:border-white' :
                    stage.status === 'active'         ? 'border-brand-near-black dark:border-white bg-transparent' :
                    stage.status === 'pending_review' ? 'border-state-held bg-brand-off-white dark:bg-state-held/20' :
                    'border-brand-border-grey dark:border-[#2c2c2c] bg-transparent',
                  )}>
                    {stage.status === 'complete' ? (
                      <CheckCircle2 className="size-4 text-white dark:text-brand-near-black" />
                    ) : stage.status === 'active' ? (
                      <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity }} className="size-2.5 rounded-full bg-brand-near-black dark:bg-white inline-block" />
                    ) : stage.status === 'pending_review' ? (
                      <AlertCircle className="size-4 text-state-held" />
                    ) : (
                      <Lock className="size-3 text-brand-border-grey" />
                    )}
                  </div>
                  <p className="text-[9px] text-center text-brand-mid-grey leading-tight line-clamp-2">{stage.name.split(' ')[0]}</p>
                </div>
              ))}
            </div>

            {/* Detailed list — each stage opens to its ticked substages */}
            <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {sortedStages.map(stage => (
                <StageWithSubstages
                  key={stage.id}
                  stage={stage}
                  substages={substages}
                  defaultOpen={stage.id === activeStage?.id}
                />
              ))}
            </div>
          </div>

          <RelatedGuides tab="overview" />
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
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{t('project.overview.approxDays', { days: PREDICTED_DAYS })}</span>
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
