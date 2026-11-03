import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
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
  const paidSplit = decomposeBudget(paidTotal, { builtAreaSqm: builtArea, floors: project.num_floors });
  const floorNote   = project.num_floors > 1
    ? `Your build has ${project.num_floors} floors. Adding floors costs less than doubling everything — foundation and roof are shared — so each extra floor adds proportionally less.`
    : 'Your build is a single storey. No floor multiplier applies.';

  // Itemised so the explainer can name each professional rather than showing one figure —
  // Philip's ask on 4 Sep was that a client should see who they are paying.
  const prof   = professionalParts(budget.construction, project.num_floors);
  const months = buildDurationMonths(project.num_floors);

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
      title: 'Add the professional fees',
      amount: budget.professional,
      pct: null,
      body: `The four people a build needs who are not on the tools: a site manager running the day, a quantity surveyor controlling materials, a lawyer for the contract, and a project manager coordinating the whole thing. The first two are paid monthly, so their fee follows the ${months}-month programme above rather than the size of your budget.`,
      formula: [
        `Site manager        ${SITE_MANAGER_XAF_PER_MONTH.toLocaleString()} XAF  ×  ${months} months  ${eq}  ${formatUSDFull(prof.siteManager)}`,
        `Quantity surveyor   ${QUANTITY_SURVEYOR_XAF_PER_MONTH.toLocaleString()} XAF  ×  ${months} months  ${eq}  ${formatUSDFull(prof.quantitySurveyor)}`,
        `Contract lawyer     ${CONTRACT_LAWYER_XAF.toLocaleString()} XAF  ×  1 contract  ${eq}  ${formatUSDFull(prof.contractLawyer)}`,
        `Project manager     ${PROJECT_MANAGER_PCT_OF_BUILD}%  ×  ${formatUSDFull(budget.construction)}  ${eq}  ${formatUSDFull(prof.projectManager)}`,
        `${eq}  ${formatUSDFull(budget.professional)}`,
      ].join('\n'),
    },
    // The verification step was here. Removed 29 October with the fee itself — it is
    // no longer charged, so there is nothing to explain, and a 0 line would raise the
    // question rather than answer it.
    {
      icon: <Landmark className="size-4 text-brand-mid-grey" />,
      title: 'Add the building permit',
      amount: budget.permit,
      pct: null,
      body: `Planning approval, building permit and lands registry in ${countryName}. Assessed against the value of the construction work, so it is charged as a percentage of that — not of the total above.`,
      formula: `${PERMIT_PCT_OF_BUILD}%  ×  ${formatUSDFull(budget.construction)}  ${eq}  ${formatUSDFull(budget.permit)}`,
    },
    {
      icon: <AlertTriangle className="size-4 text-brand-mid-grey" />,
      title: 'Add a contingency',
      amount: budget.contingency,
      pct: null,
      body: 'Council permit variations, ground conditions, water tables — the things that reliably happen on a site here and are never in the first estimate. Charged on everything above rather than on the construction alone, because an overrun rarely confines itself to one line. Whatever is not spent stays yours.',
      formula: `${CONTINGENCY_PCT}%  ×  everything above  ${eq}  ${formatUSDFull(budget.contingency)}`,
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

          {/* How far along, as a summary and nothing more. The ten circles, the
              per-stage substage list and the "how is this calculated" modal all lived
              here and all exist on the Stages tab, which is where somebody goes to act
              on them. */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <p className="text-sm font-medium text-brand-near-black dark:text-white">
              {t('project.overview.stageProgress')}
            </p>
            <p className="mt-1 text-xs text-brand-mid-grey">
              {t('project.overview.stagesComplete', { done: completedCount, total: sortedStages.length })}
              {activeStage ? <> — {t('project.overview.currentlyOn')} <span className="font-medium text-brand-near-black dark:text-white">{stageLabel(activeStage)}</span></> : ''}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-light-grey dark:bg-[#282828]">
              {/* A width, not a pulse. Philip: the flashing elements "are confusing and
                  create a poor user experience where clients do not know what actions
                  to take" — a thing that blinks reads as something demanding a click. */}
              <motion.div
                className="h-full rounded-full bg-brand-near-black dark:bg-white"
                initial={{ width: 0 }}
                animate={{ width: `${completedPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
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
