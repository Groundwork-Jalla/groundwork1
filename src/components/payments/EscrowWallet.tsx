import { Check, Lock } from 'lucide-react';
import { formatUSD, formatUSDFull } from '@/lib/budget';
import { cn } from '@/lib/utils';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

type FundState = 'released' | 'transit' | 'held' | 'locked';

function fundState(s: ProjectStageRow): FundState {
  if (s.payment_status === 'paid') return 'released';
  if (s.payment_status === 'partial') return 'transit';
  if (s.status === 'active' || s.status === 'pending_review') return 'held';
  return 'locked';
}

const SEG_COLOR: Record<FundState, string> = {
  released: '#22c55e', transit: '#3b82f6', held: '#f59e0b', locked: 'var(--color-brand-border-grey)',
};
const BADGE: Record<FundState, { label: string; cls: string }> = {
  released: { label: 'Released', cls: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  transit:  { label: 'Transit',  cls: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  held:     { label: 'Held',     cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  locked:   { label: 'Locked',   cls: 'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey' },
};
const LEGEND: [FundState, string][] = [['released', 'Released'], ['transit', 'In Transit'], ['held', 'Held'], ['locked', 'Locked']];

export default function EscrowWallet({
  project, stages, onPay, onViewPayout,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  onPay: (stage: ProjectStageRow) => void;
  onViewPayout: (stage: ProjectStageRow) => void;
}) {
  const total    = project.budget_usd ?? 0;
  const released = stages.filter(s => s.payment_status === 'paid').reduce((a, s) => a + (s.payment_milestone_usd ?? 0), 0);
  const escrow   = Math.max(0, total - released);
  const remaining = stages.filter(s => s.payment_status !== 'paid').length;
  const releasedPct = total > 0 ? (released / total) * 100 : 0;

  const amountFor = (s: ProjectStageRow) => s.payment_milestone_usd ?? ((s.budget_pct ?? 0) / 100) * total;

  return (
    <div>
      {/* Dark escrow hero */}
      <div className="rounded-2xl bg-brand-near-black text-white text-center px-7 py-7 mb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Project escrow</p>
        <p className="text-4xl font-black mt-1 tabular-nums">{formatUSD(escrow)}</p>
        <p className="text-[13px] text-white/45 mt-1">held securely · {remaining} stage{remaining !== 1 ? 's' : ''} remaining</p>

        {/* Segmented allocation bar */}
        <div className="flex gap-0.5 mt-5 rounded-md overflow-hidden">
          {stages.map(s => (
            <div
              key={s.id}
              className="h-1.5"
              style={{ flex: Math.max(s.budget_pct ?? 1, 0.5), background: SEG_COLOR[fundState(s)] }}
              title={`Stage ${s.stage_number}: ${s.name}`}
            />
          ))}
        </div>
        <div className="flex justify-center gap-4 mt-3">
          {LEGEND.map(([st, label]) => (
            <span key={st} className="flex items-center gap-1.5 text-[10px] text-white/55">
              <span className="size-1.5 rounded-sm" style={{ background: SEG_COLOR[st] === 'var(--color-brand-border-grey)' ? '#666' : SEG_COLOR[st] }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Total / Released cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey">Total project</p>
          <p className="text-2xl font-extrabold text-brand-near-black dark:text-white mt-0.5 tabular-nums">{formatUSD(total)}</p>
        </div>
        <div className="rounded-2xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Released</p>
          <p className="text-2xl font-extrabold text-green-700 dark:text-green-400 mt-0.5 tabular-nums">{formatUSD(released)}</p>
          <p className="text-[10px] text-green-700/70 dark:text-green-400/70 mt-0.5">{releasedPct.toFixed(1)}% of total</p>
        </div>
      </div>

      {/* Stage list */}
      <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
        {stages.map((s, i) => {
          const state = fundState(s);
          const amount = amountFor(s);
          const canPay = state === 'held'; // active + unpaid → payable now
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3',
                i < stages.length - 1 && 'border-b border-brand-light-grey dark:border-[#252525]',
              )}
            >
              <div className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                state === 'released' ? 'bg-green-600 text-white'
                  : state === 'transit' ? 'bg-blue-600 text-white'
                  : state === 'held' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                  : 'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
              )}>
                {state === 'released' ? <Check className="size-3.5 stroke-[3]" />
                  : state === 'locked' ? <Lock className="size-3" />
                  : s.stage_number}
              </div>

              <div className="flex-1 min-w-0">
                <p className={cn('text-[13px] font-medium truncate',
                  state === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                  {s.name}
                </p>
              </div>

              <span className={cn('text-[13px] font-semibold tabular-nums shrink-0',
                state === 'locked' ? 'text-brand-soft-grey' : 'text-brand-near-black dark:text-white')}>
                {formatUSDFull(amount)}
              </span>

              <div className="w-[74px] flex justify-end shrink-0">
                {canPay ? (
                  <button
                    type="button"
                    onClick={() => onPay(s)}
                    className="rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-[11px] font-semibold px-3 py-1.5 hover:opacity-90 transition-opacity"
                  >
                    Pay
                  </button>
                ) : state === 'released' || state === 'transit' ? (
                  <button
                    type="button"
                    onClick={() => onViewPayout(s)}
                    className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold hover:opacity-80 transition-opacity', BADGE[state].cls)}
                  >
                    {BADGE[state].label}
                  </button>
                ) : (
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold', BADGE[state].cls)}>
                    {BADGE[state].label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-brand-soft-grey text-center mt-4 leading-relaxed">
        Preview — funds held via Stripe, released on verified completion and paid out through Switchr. Not yet live.
      </p>
    </div>
  );
}
