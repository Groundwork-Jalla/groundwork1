import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Clock, Lock, AlertCircle, X, Info,
  Maximize2, Package, Users, Briefcase, Landmark, BarChart2, Scale, RefreshCw, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUSDFull, formatUSD } from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { WeatherWidget } from '@/components/ui/WeatherWidget';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import RelatedGuides from '@/components/project/RelatedGuides';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, BudgetBreakdown } from '@/types/project';

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

// ── Budget allocation donut (colorful) ───────────────────

const BUDGET_SLICES = [
  { label: 'Materials',        pct: 41, color: '#3b82f6', desc: 'Cement, blocks, rebar, fittings' },
  { label: 'Labor',            pct: 23, color: '#22c55e', desc: 'Site workers and supervision'    },
  { label: 'Professional Fees',pct: 27, color: '#f59e0b', desc: 'Architects, engineers, project mgmt' },
  { label: 'Permits',          pct: 9,  color: '#a855f7', desc: 'Government approvals and filings' },
] as const;

function BudgetDonut({
  total,
  onBreakdown,
}: {
  total: number;
  onBreakdown: () => void;
}) {
  const size  = 180;
  const cx    = size / 2;
  const cy    = size / 2;
  const r     = 64;
  const sw    = 22;
  const circ  = 2 * Math.PI * r;

  let offset = 0;
  const arcs = BUDGET_SLICES.map(s => {
    const dash = (s.pct / 100) * circ;
    const arc  = { ...s, dash, gap: circ - dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-brand-near-black dark:text-white">Costing Allocation</p>
        <button
          type="button"
          onClick={onBreakdown}
          className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
        >
          <Info className="size-3" /> How is this calculated?
        </button>
      </div>

      <p className="text-xs text-brand-mid-grey -mt-3">
        Your biggest cost is{' '}
        <span className="font-semibold text-brand-near-black dark:text-white">Materials</span>{' '}
        at <span className="font-semibold text-brand-near-black dark:text-white">41%</span> of total budget.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            {arcs.map(arc => (
              <circle
                key={arc.label}
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
            <p className="text-[9px] text-brand-mid-grey mt-1">Total budget</p>
          </div>
        </div>

        {/* Legend with descriptions */}
        <div className="flex flex-col gap-3 flex-1 w-full">
          {BUDGET_SLICES.map(s => (
            <div key={s.label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs font-medium text-brand-near-black dark:text-white">{s.label}</span>
                </div>
                <span className="text-xs font-bold text-brand-near-black dark:text-white tabular-nums">{s.pct}%</span>
              </div>
              <p className="text-[10px] text-brand-mid-grey pl-4">{s.desc}</p>
            </div>
          ))}
          <p className="text-[10px] text-brand-mid-grey border-t border-brand-off-white dark:border-[#2c2c2c] pt-2">
            Total estimated cost: <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(total)}</span>
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
  const countryName = findCountry(project.country)?.name ?? project.country;
  const profFees    = budget.engineering + budget.management;
  const permCont    = budget.permits + budget.contingency;
  const paidPct     = total > 0 ? Math.round((paidTotal / total) * 100) : 0;
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
      title: 'Work out the material cost',
      amount: budget.materials,
      pct: 41,
      body: `Everything physical on site — cement, blocks, steel rebar, roofing, doors, windows, tiles, paint, pipes, electrical wiring. This is calibrated from real quantity surveyor (BQ) data for ${countryName}.`,
      formula: `41%  ×  ${formatUSDFull(total)}  =  ${formatUSDFull(budget.materials)}`,
    },
    {
      icon: <Users className="size-4 text-brand-mid-grey" />,
      title: 'Add labor',
      amount: budget.labor,
      pct: 23,
      body: `Site workers: masons, carpenters, plumbers, electricians, helpers and their supervisors. In ${countryName}, skilled labor scales proportionally with materials — more material volume means more workers are needed.`,
      formula: `23%  ×  ${formatUSDFull(total)}  =  ${formatUSDFull(budget.labor)}`,
    },
    {
      icon: <Briefcase className="size-4 text-brand-mid-grey" />,
      title: 'Add professional fees',
      amount: profFees,
      pct: 26,
      body: 'Architect (technical drawings and planning), structural engineer (load calculations and safety sign-off), quantity surveyor (your BQ), and project manager (site visits, contractor coordination). You typically pay these partly upfront and in stages throughout the build.',
      formula: `Engineering (16%)  +  Management (10%)  =  26%\n→  ${formatUSDFull(budget.engineering)}  +  ${formatUSDFull(budget.management)}  =  ${formatUSDFull(profFees)}`,
    },
    {
      icon: <Landmark className="size-4 text-brand-mid-grey" />,
      title: 'Add government permits & contingency',
      amount: permCont,
      pct: 10,
      body: `Planning approval, building permit, lands registry, and where required, environmental clearances. Plus a contingency buffer — material prices and exchange rates shift, especially for diaspora builders in ${countryName}. The contingency is yours to keep if not used.`,
      formula: `Permits (2%)  +  Contingency (8%)  =  10%\n→  ${formatUSDFull(budget.permits)}  +  ${formatUSDFull(budget.contingency)}  =  ${formatUSDFull(permCont)}`,
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
            <p className="text-base font-bold text-brand-near-black dark:text-white">How is my budget calculated?</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">A plain-English walkthrough of every number — no jargon.</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Intro card */}
          <div className="rounded-xl bg-brand-off-white dark:bg-[#252525] border border-brand-border-grey dark:border-[#333] px-4 py-3 text-xs text-brand-mid-grey leading-relaxed">
            Building a house involves four big buckets of cost: <strong className="text-brand-near-black dark:text-white">materials</strong> (the stuff), <strong className="text-brand-near-black dark:text-white">labor</strong> (the people), <strong className="text-brand-near-black dark:text-white">professional fees</strong> (the experts who plan &amp; supervise), and <strong className="text-brand-near-black dark:text-white">permits</strong> (the government approvals). Here's exactly how we worked yours out.
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
              <span className="text-sm font-semibold text-brand-near-black dark:text-white">Add it all up</span>
            </div>
            <div className="px-4 py-3 text-xs">
              <p className="text-brand-mid-grey mb-3">Your total project cost is the sum of all four buckets:</p>
              <table className="w-full">
                <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
                  {[
                    { label: 'Materials',                   amount: budget.materials },
                    { label: '+ Labor',                     amount: budget.labor     },
                    { label: '+ Professional fees',         amount: profFees         },
                    { label: '+ Permits & contingency',     amount: permCont         },
                  ].map(r => (
                    <tr key={r.label}>
                      <td className="py-1.5 text-brand-mid-grey">{r.label}</td>
                      <td className="py-1.5 text-right font-medium text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-brand-near-black dark:border-white">
                    <td className="pt-2 font-bold text-brand-near-black dark:text-white">Total</td>
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
                <span className="text-sm font-semibold text-brand-near-black dark:text-white">Plan vs Actual — where you really are</span>
              </div>
              <span className="text-[10px] text-brand-mid-grey">Based on payments you've recorded so far</span>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'PLANNED',       value: formatUSDFull(total),       cls: '' },
                  { label: 'PAID SO FAR',   value: formatUSDFull(paidTotal),   cls: 'text-green-600 dark:text-green-400' },
                  { label: outstanding > 0 ? 'OUTSTANDING' : 'UNDER BUDGET', value: formatUSDFull(outstanding), cls: 'text-amber-600 dark:text-amber-400' },
                ].map(c => (
                  <div key={c.label} className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2 text-center">
                    <p className="text-[8px] font-semibold text-brand-mid-grey uppercase tracking-wider mb-1">{c.label}</p>
                    <p className={cn('text-sm font-black tabular-nums', c.cls || 'text-brand-near-black dark:text-white')}>{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-4">
                <motion.div className="h-full rounded-full bg-green-500" initial={{ width: 0 }} animate={{ width: `${Math.min(paidPct, 100)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
              </div>
              <p className="text-[10px] text-center text-brand-mid-grey mb-4">{paidPct}% of your project is funded so far</p>
              {[
                { label: 'Materials',           planned: budget.materials, paid: Math.round(paidTotal * 0.41) },
                { label: 'Labor',               planned: budget.labor,     paid: Math.round(paidTotal * 0.23) },
                { label: 'Professional fees',   planned: profFees,         paid: Math.round(paidTotal * 0.26) },
                { label: 'Permits',             planned: permCont,         paid: Math.round(paidTotal * 0.10) },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-3 mb-2">
                  <span className="w-32 shrink-0 text-[10px] text-brand-mid-grey">{r.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
                    <motion.div className="h-full rounded-full bg-green-400" initial={{ width: 0 }} animate={{ width: `${r.planned > 0 ? Math.min(Math.round((r.paid / r.planned) * 100), 100) : 0}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                  </div>
                  <span className="text-[10px] font-medium text-brand-near-black dark:text-white tabular-nums shrink-0 w-28 text-right">{formatUSDFull(r.paid)} / {formatUSDFull(r.planned)}</span>
                </div>
              ))}
              <p className="text-[9px] text-brand-mid-grey mt-3 leading-relaxed">
                Note: Payments are tracked per stage, not per cost bucket. We split your total paid amount across the four categories using the same ratio as your plan, so you can see roughly how much of each bucket has been funded.
              </p>
            </div>
          </div>

          {/* Why these percentages */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-4">
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">Why these percentages?</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              The labor, professional fees, and permit percentages aren't guesses — they're regional averages we calibrate from real quantity surveyor Bills of Quantities and local market rates. They get reviewed when the market shifts (currency moves, fuel prices, new permit rules). Your actual costs may vary based on your contractor's rates, where you source materials, and site conditions — that's why we also track every real payment you make, so you can see plan vs. actual at any time.
            </p>
            {project.finish_level !== 'standard' && (
              <p className="text-xs text-brand-mid-grey leading-relaxed mt-2">
                Your <strong className="text-brand-near-black dark:text-white">{project.finish_level}</strong> finish level adds a multiplier to the base rate — higher-grade materials, fittings and fixtures cost more per sqm.
              </p>
            )}
            <p className="text-[9px] text-brand-border-grey mt-3">Want a per-category deep-dive? Click any of the four cost cards on the costing page to see exactly what that money is spent on.</p>
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
        <p className="text-sm font-medium text-brand-near-black dark:text-white">Payment Status</p>
        <button
          type="button"
          onClick={onHowCalculated}
          className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
        >
          <Info className="size-3" /> How is this calculated?
        </button>
      </div>

      <p className="text-xs text-brand-mid-grey mb-4">
        You've paid{' '}
        <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(paidTotal)}</span>
        {' '}of{' '}
        <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(totalBudget)}</span>
        {' '}({paidPctRounded}%).{' '}
        <span className="text-amber-600 dark:text-amber-400 font-medium">{formatUSDFull(outstanding)} still due.</span>
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
          className="bg-green-500 flex items-center justify-center relative"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(paidPct, paidPct > 0 ? 5 : 0)}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          {paidPctRounded >= 10 && (
            <span className="text-xs font-bold text-white tabular-nums">{paidPctRounded}%</span>
          )}
          {/* Tooltip at right edge of green */}
          {paidPctRounded > 0 && paidPctRounded < 90 && (
            <div className="absolute -right-px top-0 bottom-0 w-px bg-white/40 z-10" />
          )}
        </motion.div>
        <div className="flex-1 bg-amber-400 dark:bg-amber-500 flex items-center justify-center">
          {(100 - paidPctRounded) >= 10 && (
            <span className="text-xs font-bold text-white tabular-nums">{100 - paidPctRounded}%</span>
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
          <span className="size-2.5 rounded-sm bg-green-500" />
          Paid · <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(paidTotal)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-brand-mid-grey">
          <span className="size-2.5 rounded-sm bg-amber-400" />
          Outstanding · <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(outstanding)}</span>
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
  const sorted  = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  const paidPct = totalBudget > 0 ? Math.round((paidTotal / totalBudget) * 100) : 0;

  const pill = (s: string) => {
    if (s === 'paid')    return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800';
    if (s === 'partial') return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800';
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
            <p className="text-base font-bold text-brand-near-black dark:text-white">How payments are tracked</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">What "Paid" and "Outstanding" mean — and how each stage is marked.</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Where you are right now */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">Where you are right now</p>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'TOTAL BUDGET',  value: formatUSDFull(totalBudget),  cls: '' },
                  { label: 'PAID',          value: formatUSDFull(paidTotal),    cls: 'text-green-600 dark:text-green-400' },
                  { label: 'OUTSTANDING',   value: formatUSDFull(outstanding),  cls: 'text-amber-600 dark:text-amber-400' },
                ].map(c => (
                  <div key={c.label} className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-2 py-2 text-center">
                    <p className="text-[8px] font-semibold text-brand-mid-grey uppercase tracking-wider mb-1">{c.label}</p>
                    <p className={cn('text-sm font-black tabular-nums', c.cls || 'text-brand-near-black dark:text-white')}>{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-2">
                <motion.div className="h-full rounded-full bg-green-500" initial={{ width: 0 }} animate={{ width: `${Math.min(paidPct, 100)}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
              </div>
              <p className="text-[10px] text-center text-brand-mid-grey">{paidPct}% of your project is funded so far</p>
            </div>
          </div>

          {/* Three statuses explained */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525]">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">Each stage falls into one of three statuses</p>
            </div>
            <div className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {[
                {
                  icon: <span className="size-8 rounded-full border-2 border-brand-border-grey dark:border-[#444] flex items-center justify-center shrink-0"><Lock className="size-3 text-brand-mid-grey" /></span>,
                  label: 'Unpaid',
                  desc: 'No payment has been recorded for this stage yet. The full milestone amount is still owed.',
                },
                {
                  icon: <span className="size-8 rounded-full border-2 border-amber-400 flex items-center justify-center shrink-0"><CheckCircle2 className="size-3.5 text-amber-400" /></span>,
                  label: 'Partial',
                  desc: "You've paid something towards this stage, but not the full milestone amount. The remainder is still outstanding.",
                },
                {
                  icon: <span className="size-8 rounded-full border-2 border-green-500 bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0"><CheckCircle2 className="size-3.5 text-green-500" /></span>,
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
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">How payments get recorded</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed mb-2">
              Whenever you transfer money to your contractor or supplier, open the matching stage and click <strong className="text-brand-near-black dark:text-white">Record Payment</strong>. Enter the amount and (optionally) attach a receipt. Your dashboard instantly updates the stage status, the chart above, and your overall paid percentage.
            </p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              You can record multiple part-payments for a single stage — they add up automatically. If you over-pay or your contractor renegotiates, an admin can adjust the total stage cost so your records stay clean.
            </p>
            <div className="mt-3 rounded-lg bg-brand-off-white dark:bg-brand-rich-black border border-brand-border-grey dark:border-[#333] px-3 py-2 text-[10px] text-brand-mid-grey">
              Want to see all your payments in one place? Open the <strong className="text-brand-near-black dark:text-white">Payments</strong> tab for a full ledger with CSV export.
            </div>
          </div>

          {/* Per-stage breakdown table */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525] flex items-center justify-between">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">Stage-by-stage breakdown</p>
              <p className="text-[10px] text-brand-mid-grey tabular-nums">{formatUSDFull(totalBudget)} total</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-off-white dark:bg-brand-rich-black border-b border-brand-border-grey dark:border-[#2c2c2c]">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">Stage</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">Milestone</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
                  {sorted.map(s => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 text-xs text-brand-near-black dark:text-white">
                        <span className="text-brand-mid-grey mr-2 tabular-nums">{s.stage_number}.</span>{s.name}
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
  const expectedStage = completedCount + 1;
  const actualStage   = activeStage?.stage_number ?? completedCount;
  const variance      = actualStage - expectedStage;
  const pace          = variance > 0 ? 'Ahead of schedule' : variance < 0 ? 'Behind schedule' : 'On track';
  const paceIcon      = variance > 0 ? '↗' : variance < 0 ? '↘' : '—';
  const paceColor     = variance > 0 ? 'text-green-600 dark:text-green-400' : variance < 0 ? 'text-red-500 dark:text-red-400' : 'text-brand-mid-grey';

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
            <p className="text-base font-bold text-brand-near-black dark:text-white">How is my pace calculated?</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">Plain-English on what "Ahead", "On track" and "Behind" mean — and how your number is worked out.</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors ml-4 shrink-0 mt-0.5">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Current pace snapshot */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
            <div className="px-4 py-3 bg-brand-off-white dark:bg-[#252525] flex items-center justify-between">
              <p className="text-[10px] font-bold text-brand-mid-grey uppercase tracking-widest">Your pace right now</p>
              <p className="text-[10px] text-brand-mid-grey">COMPLETION</p>
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
              badge: activeStage ? `Stage ${activeStage.stage_number}: ${activeStage.name}` : completedCount === stages.length ? 'All done' : 'Not started',
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
            <p className="text-[10px] font-bold text-brand-near-black dark:text-white uppercase tracking-widest mb-2">Why this isn't time-based</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed">
              Most construction tools measure pace in days vs. estimated days — but real builds get delayed by weather, permit offices, material shortages, and labour availability in ways nobody can predict. We measure pace by <strong className="text-brand-near-black dark:text-white">stage progression</strong> instead, because a completed, verified stage is an objective fact. It's also what your bank, insurer, or financier cares about — not whether you're "on time" by some calendar estimate.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5 flex flex-col gap-2">
      <p className="text-xs text-brand-mid-grey">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums leading-tight', accent ?? 'text-brand-near-black dark:text-white')}>{value}</p>
      {sub && <p className="text-[11px] text-brand-mid-grey">{sub}</p>}
    </div>
  );
}

// ── Stage status icon ─────────────────────────────────────

function StageIcon({ status }: { status: string }) {
  if (status === 'complete')       return <CheckCircle2 className="size-3.5 text-brand-near-black dark:text-white shrink-0" />;
  if (status === 'active')         return <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity }} className="size-3.5 rounded-full border-2 border-brand-near-black dark:border-white bg-transparent shrink-0 inline-block" />;
  if (status === 'pending_review') return <AlertCircle className="size-3.5 text-amber-500 shrink-0" />;
  return <Lock className="size-3 text-brand-border-grey shrink-0" />;
}

// ── Latest from Site ──────────────────────────────────────
// Returns null if no evidence images exist — no placeholder.

const IMG_RE = /\.(jpe?g|png|webp|gif)$/i;

function LatestFromSite({ substages }: { substages: ProjectSubstageRow[] }) {
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

  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-brand-near-black dark:text-white">Latest from Site</p>
        <span className="text-[10px] text-brand-mid-grey">{imagePaths.length} photo{imagePaths.length !== 1 ? 's' : ''}</span>
      </div>
      {signing ? (
        <div className={cn('gap-1.5', imagePaths.length === 1 ? 'block' : 'grid grid-cols-2')}>
          {imagePaths.map((_, i) => (
            <div key={i} className="w-full aspect-square rounded-lg bg-brand-light-grey dark:bg-[#282828] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={cn('gap-1.5', signedUrls.length === 1 ? 'block' : 'grid grid-cols-2')}>
          {signedUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Site photo ${i + 1}`}
                className="w-full aspect-square object-cover rounded-lg"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
      {signedUrls.length > 0 && (
        <p className="text-[10px] text-brand-mid-grey mt-2">{signedUrls.length} new site photo{signedUrls.length !== 1 ? 's' : ''} above.</p>
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
  const totalBudget = project.budget_usd ?? budget.total;
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── Left column ────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Stat cards — flex so they stretch equally across the full width */}
          <div className="flex flex-col sm:flex-row gap-3">
            <StatCard label="Days Active"    value={String(daysActive)}    sub="since project created" />
            <StatCard label="Complete"        value={`${completedPct}%`}   sub={`${completedCount} of ${sortedStages.length} stages`} />
            <StatCard
              label="Now"
              value={activeStage ? 'In Progress' : completedCount === sortedStages.length ? 'Complete' : 'Starting'}
              sub={activeStage?.name ?? nextStage?.name ?? ''}
            />
            <StatCard
              label="Next Milestone"
              value={nextStage ? formatUSDFull(nextStage.payment_milestone_usd ?? 0) : '—'}
              sub={nextStage ? `starts ~${fmtDate(projStart)}` : 'All done'}
            />
          </div>

          {/* Costing allocation donut */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <BudgetDonut total={totalBudget} onBreakdown={() => setShowBudgetBreakdown(true)} />
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
              <p className="text-sm font-medium text-brand-near-black dark:text-white">Stage Progress</p>
              <button type="button" onClick={() => setShowStageProgress(true)} className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
                <Info className="size-3" /> How is this calculated?
              </button>
            </div>
            <p className="text-xs text-brand-mid-grey mb-3">
              {completedCount} of {sortedStages.length} stages complete{activeStage ? <> — currently working on <span className="font-medium text-brand-near-black dark:text-white">{activeStage.name}</span></> : ''}
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
                    stage.status === 'pending_review' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' :
                    'border-brand-border-grey dark:border-[#2c2c2c] bg-transparent',
                  )}>
                    {stage.status === 'complete' ? (
                      <CheckCircle2 className="size-4 text-white dark:text-brand-near-black" />
                    ) : stage.status === 'active' ? (
                      <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity }} className="size-2.5 rounded-full bg-brand-near-black dark:bg-white inline-block" />
                    ) : stage.status === 'pending_review' ? (
                      <AlertCircle className="size-4 text-amber-500" />
                    ) : (
                      <Lock className="size-3 text-brand-border-grey" />
                    )}
                  </div>
                  <p className="text-[9px] text-center text-brand-mid-grey leading-tight line-clamp-2">{stage.name.split(' ')[0]}</p>
                </div>
              ))}
            </div>

            {/* Detailed list */}
            <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {sortedStages.map(stage => (
                <div key={stage.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <StageIcon status={stage.status} />
                    <span className={cn('text-sm truncate', stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                      {stage.name}
                    </span>
                  </div>
                  <span className={cn('text-[9px] font-medium uppercase tracking-wide shrink-0', {
                    'text-brand-mid-grey': stage.status === 'complete',
                    'text-brand-near-black dark:text-white': stage.status === 'active',
                    'text-amber-600': stage.status === 'pending_review',
                    'text-brand-border-grey': stage.status === 'locked',
                  })}>
                    {stage.status === 'complete' ? 'Done' : stage.status === 'active' ? 'In Progress' : stage.status === 'pending_review' ? 'In Review' : 'Locked'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <RelatedGuides tab="overview" />
        </div>

        {/* ── Right sidebar ─────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Latest from Site — hidden when no images */}
          <LatestFromSite substages={substages} />

          {/* Stage Progress circles (compact) */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
            <p className="text-xs font-medium text-brand-near-black dark:text-white mb-3">Stage Progress</p>
            <div className="grid grid-cols-5 gap-2">
              {sortedStages.map(stage => (
                <div key={stage.id} className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'size-8 rounded-full border flex items-center justify-center',
                    stage.status === 'complete'       ? 'bg-brand-near-black dark:bg-white border-brand-near-black dark:border-white' :
                    stage.status === 'active'         ? 'border-brand-near-black dark:border-white' :
                    stage.status === 'pending_review' ? 'border-amber-400' :
                    'border-brand-border-grey dark:border-[#2c2c2c]',
                  )}>
                    {stage.status === 'complete'
                      ? <CheckCircle2 className="size-3.5 text-white dark:text-brand-near-black" />
                      : stage.status === 'pending_review'
                        ? <AlertCircle className="size-3 text-amber-400" />
                        : <span className="text-[9px] text-brand-mid-grey font-medium">{stage.stage_number}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weather */}
          <WeatherWidget countryCode={project.country} />

          {/* Days active + location */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3 flex items-center gap-3">
            <Clock className="size-4 text-brand-mid-grey shrink-0" />
            <div>
              <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{daysActive} days active</p>
              <p className="text-[10px] text-brand-mid-grey">
                since {new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Predicted timeline */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey mb-2">Predicted Timeline</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Start</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{fmtDate(projStart)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Projected end</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{fmtDate(projEnd)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Days remaining</span>
                <span className={cn('text-xs font-medium tabular-nums', daysLeft === 0 ? 'text-red-500' : 'text-brand-near-black dark:text-white')}>{daysLeft === 0 ? 'Overdue' : `${daysLeft}d`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Total duration</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">~{PREDICTED_DAYS} days</span>
              </div>
            </div>
          </div>

          {/* Build location */}
          {country && (
            <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
              <p className="text-[10px] text-brand-mid-grey mb-1">Build location</p>
              <p className="text-sm font-medium text-brand-near-black dark:text-white">{country.flag} {country.name}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
