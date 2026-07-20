import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, Lock, AlertCircle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUSDFull } from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { WeatherWidget } from '@/components/ui/WeatherWidget';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, BudgetBreakdown } from '@/types/project';

// Total predicted build duration (sum of STAGE_DAYS per stage type)
const PREDICTED_DAYS = 196; // 14+21+7+14+70+14+14+21+14+7

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Payment Donut ────────────────────────────────────────

function PaymentDonut({
  paidTotal,
  outstanding,
  totalBudget,
}: {
  paidTotal: number;
  outstanding: number;
  totalBudget: number;
}) {
  const size = 140;
  const cx   = size / 2;
  const cy   = size / 2;
  const r    = 50;
  const sw   = 20;
  const circ = 2 * Math.PI * r;

  const paidPct = totalBudget > 0 ? paidTotal / totalBudget : 0;
  const outPct  = 1 - paidPct;

  const paidDash = paidPct * circ;
  const outDash  = outPct  * circ;
  const pct      = Math.round(paidPct * 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Outstanding (background ring) */}
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke="#f59e0b"
          strokeWidth={sw}
          strokeDasharray={`${outDash} ${circ - outDash}`}
          strokeDashoffset={-paidDash}
          className="dark:opacity-80"
        />
        {/* Paid */}
        {paidDash > 0 && (
          <circle
            cx={cx} cy={cy} r={r} fill="none"
            stroke="#16a34a"
            strokeWidth={sw}
            strokeDasharray={`${paidDash} ${circ - paidDash}`}
            strokeDashoffset={0}
            className="dark:opacity-90"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-xl font-black text-brand-near-black dark:text-white tabular-nums leading-none">{pct}%</p>
        <p className="text-[9px] text-brand-mid-grey mt-0.5">paid</p>
      </div>
    </div>
  );
}

// ── Payment breakdown modal ──────────────────────────────

function PaymentBreakdownModal({
  stages,
  totalBudget,
  onClose,
}: {
  stages: ProjectStageRow[];
  totalBudget: number;
  onClose: () => void;
}) {
  const sorted = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  const pillClass = (s: string) => {
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
        className="bg-white dark:bg-brand-rich-black rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-lg shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c]">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">Payment Breakdown</p>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Stage rows */}
        <div className="overflow-y-auto max-h-96">
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
                    <span className="text-brand-mid-grey mr-2 tabular-nums">{s.stage_number}.</span>
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-brand-near-black dark:text-white tabular-nums">
                    {formatUSDFull(s.payment_milestone_usd ?? 0)}
                    <span className="text-[10px] text-brand-mid-grey ml-1">({s.budget_pct}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', pillClass(s.payment_status))}>
                      {s.payment_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        <div className="px-5 py-4 border-t border-brand-off-white dark:border-[#2c2c2c] flex items-center justify-between">
          <p className="text-xs text-brand-mid-grey">
            Payment status is recorded per stage. Update it in the <span className="font-medium text-brand-near-black dark:text-white">Payments</span> tab.
          </p>
          <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(totalBudget)}</p>
        </div>
      </motion.div>
    </div>
  );
}

// ── Budget Allocation Donut ─────────────────────────────

const DONUT_SLICES = [
  { label: 'Materials',  pct: 41, color: '#0a0a0a' },
  { label: 'Labor',      pct: 23, color: '#3d3d3d' },
  { label: 'Fees',       pct: 27, color: '#7a7a7a' },
  { label: 'Permits',    pct: 9,  color: '#c0c0c0' },
] as const;

function BudgetDonut({ total }: { total: number }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const r  = 50;
  const sw = 20;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = DONUT_SLICES.map(slice => {
    const dash = (slice.pct / 100) * circ;
    const gap  = circ - dash;
    const arc  = { ...slice, dash, gap, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {arcs.map(arc => (
            <circle
              key={arc.label}
              cx={cx} cy={cy} r={r} fill="none"
              stroke={arc.color}
              strokeWidth={sw}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={-arc.offset}
              className="dark:opacity-80"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-base font-black text-brand-near-black dark:text-white tabular-nums leading-none">{formatUSDFull(total)}</p>
          <p className="text-[9px] text-brand-mid-grey mt-0.5">Total budget</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {DONUT_SLICES.map(slice => (
          <div key={slice.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: slice.color }} />
            <span className="text-[10px] text-brand-mid-grey">{slice.label}</span>
            <span className="text-[10px] font-medium text-brand-near-black dark:text-white ml-auto">{slice.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col gap-1">
      <p className="text-xs text-brand-mid-grey">{label}</p>
      <p className="text-xl font-bold text-brand-near-black dark:text-white tabular-nums leading-tight">{value}</p>
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
// Only renders if there are actual uploaded evidence images.
// Evidence URLs are Supabase storage paths — we sign them before display.

const IMAGE_PATH_RE = /\.(jpe?g|png|webp|gif)$/i;

function LatestFromSite({ substages }: { substages: ProjectSubstageRow[] }) {
  const [signedUrls, setSignedUrls] = useState<string[]>([]);

  // Collect up to 4 image paths from evidence_urls
  const imagePaths = useMemo(() => {
    const paths: string[] = [];
    for (const sub of substages) {
      for (const url of sub.evidence_urls ?? []) {
        if (IMAGE_PATH_RE.test(url.split('?')[0])) {
          paths.push(url);
          if (paths.length === 4) return paths;
        }
      }
    }
    return paths;
  }, [substages]);

  useEffect(() => {
    if (imagePaths.length === 0) {
      setSignedUrls([]);
      return;
    }
    let cancelled = false;
    Promise.all(imagePaths.map(p => getSignedEvidenceUrl(p)))
      .then(results => {
        if (!cancelled) setSignedUrls(results.filter(Boolean) as string[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [imagePaths]);

  // Nothing to show — don't render the section at all
  if (imagePaths.length === 0) return null;

  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
      <p className="text-xs font-medium text-brand-near-black dark:text-white mb-3">Latest from Site</p>
      {signedUrls.length > 0 ? (
        <div className={cn('gap-1.5', signedUrls.length === 1 ? 'block' : 'grid grid-cols-2')}>
          {signedUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Site photo ${i + 1}`}
                className="w-full aspect-square object-cover rounded-lg bg-brand-light-grey dark:bg-[#282828]"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : (
        // Paths found but still signing — show skeleton placeholders matching the count
        <div className={cn('gap-1.5', imagePaths.length === 1 ? 'block' : 'grid grid-cols-2')}>
          {imagePaths.map((_, i) => (
            <div key={i} className="w-full aspect-square rounded-lg bg-brand-light-grey dark:bg-[#282828] animate-pulse" />
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
  const [showPaymentBreakdown, setShowPaymentBreakdown] = useState(false);

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);

  const daysActive = Math.max(0, Math.floor(
    (Date.now() - new Date(project.created_at).getTime()) / 86_400_000
  ));

  const completedCount = sortedStages.filter(s => s.status === 'complete').length;
  const completedPct   = sortedStages.length > 0
    ? Math.round((completedCount / sortedStages.length) * 100)
    : 0;

  const nextStage = sortedStages.find(s => s.status !== 'complete');

  const paidTotal   = sortedStages.filter(s => s.payment_status === 'paid').reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);
  const totalBudget = project.budget_usd ?? budget.total;
  const outstanding = Math.max(0, totalBudget - paidTotal);
  const paidPct     = totalBudget > 0 ? Math.round((paidTotal / totalBudget) * 100) : 0;

  const country = findCountry(project.country);

  // Projected completion = project start + 196 days (total of all STAGE_DAYS)
  const projStart       = new Date(project.target_start ?? project.created_at);
  const projectedEnd    = addDays(projStart, PREDICTED_DAYS);
  const projectedEndStr = fmtDate(projectedEnd);
  const daysRemaining   = Math.max(0, Math.ceil((projectedEnd.getTime() - Date.now()) / 86_400_000));

  return (
    <>
      <AnimatePresence>
        {showPaymentBreakdown && (
          <PaymentBreakdownModal
            stages={sortedStages}
            totalBudget={totalBudget}
            onClose={() => setShowPaymentBreakdown(false)}
          />
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

        {/* ── Left column ────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Stat cards — 4 up */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Days Active"
              value={String(daysActive)}
              sub="since project created"
            />
            <StatCard
              label="Complete"
              value={`${completedPct}%`}
              sub={`${completedCount} of ${sortedStages.length} stages`}
            />
            <StatCard
              label="Days Remaining"
              value={daysActive > PREDICTED_DAYS ? 'Overdue' : String(daysRemaining)}
              sub={`of ~${PREDICTED_DAYS} day build`}
            />
            <StatCard
              label="Projected End"
              value={projectedEndStr}
              sub={`started ${fmtDate(projStart)}`}
            />
          </div>

          {/* Budget allocation donut */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">Costing Allocation</p>
              <button
                type="button"
                onClick={onViewCosting}
                className="text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors flex items-center gap-1"
              >
                <Info className="size-3" /> Full breakdown
              </button>
            </div>
            <BudgetDonut total={totalBudget} />
          </div>

          {/* Payment status donut */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">Payment Status</p>
              <button
                type="button"
                onClick={() => setShowPaymentBreakdown(true)}
                className="text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors flex items-center gap-1"
              >
                <Info className="size-3" /> How is this calculated?
              </button>
            </div>

            <div className="flex items-center gap-6">
              <PaymentDonut paidTotal={paidTotal} outstanding={outstanding} totalBudget={totalBudget} />

              <div className="flex flex-col gap-3 flex-1">
                <div>
                  <p className="text-[10px] text-brand-mid-grey mb-0.5">Paid</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-500 tabular-nums">{formatUSDFull(paidTotal)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-brand-mid-grey mb-0.5">Outstanding</p>
                  <p className="text-lg font-bold text-amber-500 tabular-nums">{formatUSDFull(outstanding)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-brand-mid-grey mb-0.5">Total Budget</p>
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(totalBudget)}</p>
                </div>
              </div>
            </div>

            {/* Legend dots */}
            <div className="flex gap-4 mt-4 pt-4 border-t border-brand-off-white dark:border-[#2c2c2c]">
              <span className="flex items-center gap-1.5 text-[10px] text-brand-mid-grey">
                <span className="size-2 rounded-full bg-green-600" /> Paid ({paidPct}%)
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-brand-mid-grey">
                <span className="size-2 rounded-full bg-amber-500" /> Outstanding ({100 - paidPct}%)
              </span>
            </div>
          </div>

          {/* Stage progress */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">Stage Progress</p>
              <button
                type="button"
                onClick={onViewStage}
                className="text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors flex items-center gap-1"
              >
                <Info className="size-3" /> View all stages
              </button>
            </div>
            <p className="text-xs text-brand-mid-grey mb-3">
              {completedCount} of {sortedStages.length} stages complete
              {nextStage ? (
                <> — currently <span className="font-medium text-brand-near-black dark:text-white">{nextStage.name}</span></>
              ) : ' — all stages done'}
            </p>

            <div className="h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden mb-4">
              <motion.div
                className="h-full bg-brand-near-black dark:bg-white rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${completedPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>

            <div className="flex flex-col divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
              {sortedStages.map(stage => (
                <div key={stage.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <StageIcon status={stage.status} />
                    <span className={cn(
                      'text-sm truncate',
                      stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white',
                    )}>
                      {stage.name}
                    </span>
                  </div>
                  <span className={cn('text-[9px] font-medium uppercase tracking-wide shrink-0', {
                    'text-brand-mid-grey':           stage.status === 'complete',
                    'text-brand-near-black dark:text-white': stage.status === 'active',
                    'text-amber-600':                stage.status === 'pending_review',
                    'text-brand-border-grey':        stage.status === 'locked',
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

          {/* Latest from Site — only shows when evidence images exist */}
          <LatestFromSite substages={substages} />

          {/* Weather */}
          <WeatherWidget countryCode={project.country} />

          {/* Days active */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3 flex items-center gap-3">
            <Clock className="size-4 text-brand-mid-grey shrink-0" />
            <div>
              <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{daysActive} days active</p>
              <p className="text-[10px] text-brand-mid-grey">
                since {new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Country */}
          {country && (
            <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
              <p className="text-[10px] text-brand-mid-grey mb-1">Build location</p>
              <p className="text-sm font-medium text-brand-near-black dark:text-white">
                {country.flag} {country.name}
              </p>
            </div>
          )}

          {/* Projected timeline */}
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-4 py-3">
            <p className="text-[10px] text-brand-mid-grey mb-2">Predicted Timeline</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Start</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{fmtDate(projStart)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Projected end</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{projectedEndStr}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-brand-mid-grey">Total duration</span>
                <span className="text-xs font-medium text-brand-near-black dark:text-white">{PREDICTED_DAYS} days</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
