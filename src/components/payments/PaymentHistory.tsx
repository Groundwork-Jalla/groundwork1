import { formatUSD, formatUSDFull } from '@/lib/budget';
import { platformFee } from '@/lib/payments/config';
import { cn } from '@/lib/utils';
import type { ProjectRow, ProjectStageRow, ProjectTier, ConstructionRate } from '@/types/project';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PaymentHistory({
  project, stages, tier, rate, onViewPayout,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  tier: ProjectTier;
  rate: ConstructionRate | null;
  onViewPayout: (stage: ProjectStageRow) => void;
}) {
  const total     = project.budget_usd ?? 0;
  const paid      = stages.filter(s => s.payment_status === 'paid' || s.payment_status === 'partial');
  const totalPaid = paid.reduce((s, st) => s + (st.payment_milestone_usd ?? 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  const lockedCount = stages.filter(s => s.payment_status === 'unpaid').length;

  const ordered = [...paid].sort((a, b) => {
    const ta = a.completed_at ? +new Date(a.completed_at) : 0;
    const tb = b.completed_at ? +new Date(b.completed_at) : 0;
    return tb - ta || b.stage_number - a.stage_number;
  });

  return (
    <div>
      {/* Dark summary header */}
      <div className="rounded-2xl bg-brand-near-black text-white flex px-6 py-5 mb-6">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Total paid</p>
          <p className="text-2xl font-extrabold mt-1 tabular-nums">{formatUSD(totalPaid)}</p>
          <p className="text-[11px] text-white/35 mt-0.5">{paid.length} of {stages.length || 10} stages</p>
        </div>
        <div className="w-px bg-white/10 mx-5" />
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Remaining</p>
          <p className="text-2xl font-extrabold mt-1 tabular-nums">{formatUSD(remaining)}</p>
          <p className="text-[11px] text-white/35 mt-0.5">{lockedCount} stage{lockedCount !== 1 ? 's' : ''} unpaid</p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] px-6 py-12 text-center">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">No payments yet</p>
          <p className="text-xs text-brand-mid-grey mt-1">Payments appear here once you release a stage milestone.</p>
        </div>
      ) : (
        <div className="relative pl-6">
          {/* timeline spine */}
          <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-brand-border-grey dark:bg-[#2c2c2c]" />
          {ordered.map(p => {
            const isPaid = p.payment_status === 'paid';
            const amount = p.payment_milestone_usd ?? 0;
            const fee    = platformFee(amount, tier);
            return (
              <div key={p.id} className="relative mb-4">
                <span className={cn(
                  'absolute -left-[20px] top-3.5 size-4 rounded-full border-[3px] border-white dark:border-[#141414]',
                  isPaid ? 'bg-green-600' : 'bg-blue-600',
                )} style={{ boxShadow: '0 0 0 1px var(--color-brand-border-grey)' }} />
                <button
                  type="button"
                  onClick={() => onViewPayout(p)}
                  className="w-full text-left rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-4 hover:border-brand-near-black dark:hover:border-white transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="min-w-0">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold',
                        isPaid ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                               : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                      )}>
                        {isPaid ? 'Paid' : 'In Transit'}
                      </span>
                      <p className="text-sm font-bold text-brand-near-black dark:text-white mt-2 leading-snug">
                        Stage {p.stage_number}: {p.name}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-extrabold text-brand-near-black dark:text-white tabular-nums">{formatUSDFull(amount)}</p>
                      {fee > 0 && <p className="text-[10px] text-brand-soft-grey">fee: {formatUSDFull(fee)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-brand-mid-grey flex-wrap">
                    <span>{fmtDate(p.completed_at)}</span>
                    <span className="text-brand-border-grey">·</span>
                    <span>pawaPay MoMo</span>
                    <span className="text-brand-border-grey">·</span>
                    <span className="text-brand-near-black dark:text-white font-medium">View payout →</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
