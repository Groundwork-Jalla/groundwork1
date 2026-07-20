import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CircleDashed, CircleDot, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { updatePaymentStatus } from '@/lib/supabase/projects';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import { useEffect } from 'react';
import type { ProjectRow, ProjectStageRow, PaymentStatus, ConstructionRate } from '@/types/project';

// ── Payment status pill ──────────────────────────────────

function PayPill({ status }: { status: PaymentStatus }) {
  if (status === 'paid')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
        <CheckCircle2 className="size-2.5" /> Paid
      </span>
    );
  if (status === 'partial')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <CircleDot className="size-2.5" /> Partial
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-border-grey dark:border-[#2c2c2c] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-mid-grey">
      <CircleDashed className="size-2.5" /> Unpaid
    </span>
  );
}

// ── Stage payment row ────────────────────────────────────

function StagePayRow({
  stage,
  rate,
  onUpdate,
}: {
  stage: ProjectStageRow;
  rate: ConstructionRate | null;
  onUpdate: (id: string, s: PaymentStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const amount = stage.payment_milestone_usd ?? 0;
  const localAmount = rate ? amount * rate.approx_fx_rate : null;
  const barPct = stage.payment_status === 'paid' ? 100 : stage.payment_status === 'partial' ? 50 : 0;

  async function cycle() {
    const next: PaymentStatus =
      stage.payment_status === 'unpaid' ? 'partial'
      : stage.payment_status === 'partial' ? 'paid'
      : 'unpaid';
    setBusy(true);
    try { await onUpdate(stage.id, next); } finally { setBusy(false); }
  }

  return (
    <div className="py-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(
            'text-sm font-medium',
            stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white',
          )}>
            {stage.name}
          </p>
          <p className="text-xs text-brand-mid-grey tabular-nums mt-0.5">
            {formatUSDFull(amount)}
            {localAmount !== null && rate && (
              <span className="ml-1 text-brand-border-grey">
                (~{formatLocalCurrency(localAmount, rate.currency_code)})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PayPill status={stage.payment_status} />
          <button
            type="button"
            onClick={cycle}
            disabled={busy}
            className="text-[10px] font-medium text-brand-near-black dark:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg px-2 py-1 hover:bg-brand-off-white dark:hover:bg-[#282828] transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? '…' : stage.payment_status === 'paid' ? 'Mark unpaid' : 'Record payment'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-brand-light-grey dark:bg-[#282828] overflow-hidden">
        <motion.div
          className={cn(
            'h-full rounded-full',
            stage.payment_status === 'paid' ? 'bg-green-600 dark:bg-green-500' : 'bg-amber-500',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${barPct}%` }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
      </div>

      {/* Dates if available */}
      {stage.payment_status === 'paid' && stage.completed_at && (
        <p className="text-[10px] text-green-600 dark:text-green-400">
          Paid · stage completed{' '}
          {new Date(stage.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────

interface PaymentsTabProps {
  project: ProjectRow;
  stages: ProjectStageRow[];
  onPaymentUpdated: (stageId: string, status: PaymentStatus) => void;
}

export default function PaymentsTab({ project, stages, onPaymentUpdated }: PaymentsTabProps) {
  const [rate, setRate] = useState<ConstructionRate | null>(null);

  useEffect(() => {
    if (!project.country) return;
    getConstructionRate(project.country).then(r => setRate(r)).catch(() => {});
  }, [project.country]);

  const sorted = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  const totalBudget = project.budget_usd ?? 0;

  const paidTotal = sorted
    .filter(s => s.payment_status === 'paid')
    .reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);
  const outstanding = Math.max(0, totalBudget - paidTotal);
  const paidPct = totalBudget > 0 ? Math.round((paidTotal / totalBudget) * 100) : 0;

  async function handleUpdate(stageId: string, status: PaymentStatus) {
    await updatePaymentStatus(stageId, status);
    onPaymentUpdated(stageId, status);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-brand-near-black dark:text-white">Payment Tracking</h2>
        {rate && (
          <span className="text-[10px] text-brand-mid-grey border border-brand-border-grey dark:border-[#2c2c2c] rounded-full px-2 py-0.5">
            1 USD = {rate.currency_code} {rate.approx_fx_rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Summary bar */}
      <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
        <p className="text-xs text-brand-mid-grey mb-1">
          You've paid{' '}
          <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(paidTotal)}</span>
          {' '}of{' '}
          <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(totalBudget)}</span>
          {' '}({paidPct}%).{' '}
          <span className="text-amber-600 dark:text-amber-400">{formatUSDFull(outstanding)} still due.</span>
        </p>

        <div className="flex mt-3 h-8 rounded-lg overflow-hidden">
          <motion.div
            className="bg-green-600 dark:bg-green-500 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(paidPct > 0 ? 6 : 0, paidPct)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            {paidPct >= 12 && (
              <span className="text-[10px] font-bold text-white">{paidPct}%</span>
            )}
          </motion.div>
          <div className="flex-1 bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-center justify-center rounded-r-lg">
            {(100 - paidPct) >= 12 && (
              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">{100 - paidPct}%</span>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[10px] text-brand-mid-grey">
            <span className="size-2 rounded-full bg-green-600" />
            Paid · {formatUSDFull(paidTotal)}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-brand-mid-grey">
            <span className="size-2 rounded-full bg-amber-400" />
            Outstanding · {formatUSDFull(outstanding)}
          </span>
        </div>
      </div>

      {/* Per-stage rows */}
      <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-5 divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
        {sorted.map(stage => (
          <StagePayRow
            key={stage.id}
            stage={stage}
            rate={rate}
            onUpdate={handleUpdate}
          />
        ))}
      </div>

      {/* Stripe notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] px-4 py-3">
        <Info className="size-3.5 text-brand-mid-grey mt-0.5 shrink-0" />
        <p className="text-xs text-brand-mid-grey leading-relaxed">
          <span className="font-semibold text-brand-near-black dark:text-white">Recording only.</span>{' '}
          Full Stripe payment processing and contractor payouts via pawaPay are coming soon. Use this tab to track what you've paid until then.
        </p>
      </div>
    </motion.div>
  );
}
