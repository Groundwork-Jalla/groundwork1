import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, Lock, AlertCircle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUSDFull, formatUSD } from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { WeatherWidget } from '@/components/ui/WeatherWidget';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
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

// ── Budget breakdown popup ────────────────────────────────

function BudgetBreakdownModal({
  total,
  onClose,
}: {
  total: number;
  onClose: () => void;
}) {
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
        className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-md shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c]">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">Cost Breakdown</p>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {BUDGET_SLICES.map(s => {
            const amount = Math.round(total * s.pct / 100);
            return (
              <div key={s.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-sm font-medium text-brand-near-black dark:text-white">{s.label}</span>
                    <span className="text-[10px] text-brand-mid-grey">({s.pct}%)</span>
                  </div>
                  <span className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(amount)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-brand-off-white dark:bg-[#282828] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: s.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${s.pct}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-[10px] text-brand-mid-grey mt-1 pl-4">{s.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t border-brand-off-white dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] rounded-b-2xl">
          <p className="text-[10px] text-brand-mid-grey leading-relaxed">
            Indicative estimate. Actual costs depend on local market conditions, contractor pricing, and site specifics.
            Always confirm with a certified quantity surveyor.
          </p>
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

// ── Payment breakdown popup ───────────────────────────────

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
  const sorted = [...stages].sort((a, b) => a.stage_number - b.stage_number);
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
        className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-lg shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c]">
          <div>
            <p className="text-sm font-semibold text-brand-near-black dark:text-white">How is this calculated?</p>
            <p className="text-[10px] text-brand-mid-grey mt-0.5">Payment status per stage — update in the Payments tab</p>
          </div>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Summary stat */}
        <div className="px-5 py-3 bg-brand-off-white dark:bg-[#1a1a1a] border-b border-brand-off-white dark:border-[#2c2c2c] flex gap-6">
          <div>
            <p className="text-[9px] text-brand-mid-grey uppercase tracking-wide mb-0.5">Paid</p>
            <p className="text-base font-black text-green-600 dark:text-green-500 tabular-nums">{formatUSDFull(paidTotal)} <span className="text-xs font-normal">({paidPct}%)</span></p>
          </div>
          <div>
            <p className="text-[9px] text-brand-mid-grey uppercase tracking-wide mb-0.5">Outstanding</p>
            <p className="text-base font-black text-amber-500 tabular-nums">{formatUSDFull(outstanding)} <span className="text-xs font-normal">({100 - paidPct}%)</span></p>
          </div>
        </div>

        <div className="overflow-y-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-brand-off-white dark:bg-[#1a1a1a] border-b border-brand-border-grey dark:border-[#2c2c2c]">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">Stage</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">Milestone</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-brand-mid-grey uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {sorted.map(s => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-sm text-brand-near-black dark:text-white">
                    <span className="text-brand-mid-grey mr-2 tabular-nums text-xs">{s.stage_number}.</span>{s.name}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-brand-near-black dark:text-white tabular-nums">
                    {formatUSDFull(s.payment_milestone_usd ?? 0)}
                    <span className="text-[10px] text-brand-mid-grey ml-1">({s.budget_pct}%)</span>
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

        <div className="px-5 py-3 border-t border-brand-off-white dark:border-[#2c2c2c] flex items-center justify-between">
          <p className="text-xs text-brand-mid-grey">Stage payments marked in the <span className="font-medium text-brand-near-black dark:text-white">Payments</span> tab.</p>
          <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(totalBudget)} total</p>
        </div>
      </motion.div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col gap-1">
      <p className="text-xs text-brand-mid-grey">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums leading-tight', accent ?? 'text-brand-near-black dark:text-white')}>{value}</p>
      {sub && <p className="text-[10px] text-brand-mid-grey">{sub}</p>}
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
  const [showBudgetBreakdown, setShowBudgetBreakdown] = useState(false);
  const [showPaymentBreakdown, setShowPaymentBreakdown] = useState(false);

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
          <BudgetBreakdownModal total={totalBudget} onClose={() => setShowBudgetBreakdown(false)} />
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
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── Left column ────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <button type="button" onClick={onViewStage} className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
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
