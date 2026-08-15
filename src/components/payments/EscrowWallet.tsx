import { Check, Lock } from 'lucide-react';
import { formatUSD, formatUSDFull, projectBudget } from '@/lib/budget';
import { cn } from '@/lib/utils';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';

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
const BADGE: Record<FundState, { labelKey: TKey; cls: string }> = {
  released: { labelKey: 'project.payments.stateReleased', cls: 'bg-brand-off-white dark:bg-state-complete/30 text-state-complete dark:text-state-complete' },
  transit:  { labelKey: 'project.payments.stateTransit',  cls: 'bg-brand-off-white dark:bg-state-active/30 text-state-active dark:text-state-active' },
  held:     { labelKey: 'project.payments.stateHeld',     cls: 'bg-brand-off-white dark:bg-state-held/30 text-state-held dark:text-state-held' },
  locked:   { labelKey: 'project.payments.stateLocked',   cls: 'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey' },
};
const LEGEND: [FundState, TKey][] = [
  ['released', 'project.payments.legendReleased'],
  ['transit',  'project.payments.legendTransit'],
  ['held',     'project.payments.legendHeld'],
  ['locked',   'project.payments.legendLocked'],
];

export default function EscrowWallet({
  project, stages, onPay, onViewPayout,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  onPay: (stage: ProjectStageRow) => void;
  onViewPayout: (stage: ProjectStageRow) => void;
}) {
  const { stageLabel } = useStageLabels();
  const { t, tPlural } = useLanguage();
  const total    = project.budget_usd ?? 0;
  const released = stages.filter(s => s.payment_status === 'paid').reduce((a, s) => a + (s.payment_milestone_usd ?? 0), 0);
  const escrow   = Math.max(0, total - released);
  const remaining = stages.filter(s => s.payment_status !== 'paid').length;
  const releasedPct = total > 0 ? (released / total) * 100 : 0;

  // Fallback for rows predating stored milestones. `budget_pct` is a share of the
  // CONSTRUCTION fee, not of the total — the total also carries design, permit and
  // professional, none of which are stage work.
  const construction = projectBudget(project).construction;
  const amountFor = (s: ProjectStageRow) =>
    s.payment_milestone_usd ?? ((s.budget_pct ?? 0) / 100) * construction;

  return (
    <div>
      {/* Dark escrow hero */}
      <div className="rounded-2xl bg-brand-near-black text-white text-center px-7 py-7 mb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{t('project.payments.escrowLabel')}</p>
        <p className="text-4xl font-black mt-1 tabular-nums">{formatUSD(escrow)}</p>
        <p className="text-[13px] text-white/45 mt-1">{tPlural('project.payments.heldSecurely', remaining)}</p>

        {/* Segmented allocation bar */}
        <div className="flex gap-0.5 mt-5 rounded-md overflow-hidden">
          {stages.map(s => (
            <div
              key={s.id}
              className="h-1.5"
              style={{ flex: Math.max(s.budget_pct ?? 1, 0.5), background: SEG_COLOR[fundState(s)] }}
              title={`${s.stage_number}. ${stageLabel(s)}`}
            />
          ))}
        </div>
        <div className="flex justify-center gap-4 mt-3">
          {LEGEND.map(([st, labelKey]) => (
            <span key={st} className="flex items-center gap-1.5 text-[10px] text-white/55">
              <span className="size-1.5 rounded-sm" style={{ background: SEG_COLOR[st] === 'var(--color-brand-border-grey)' ? '#666' : SEG_COLOR[st] }} />
              {t(labelKey)}
            </span>
          ))}
        </div>
      </div>

      {/* Total / Released cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t('project.payments.totalProject')}</p>
          <p className="text-2xl font-extrabold text-brand-near-black dark:text-white mt-0.5 tabular-nums">{formatUSD(total)}</p>
        </div>
        <div className="rounded-2xl border border-state-complete/30 dark:border-state-complete/40 bg-brand-off-white dark:bg-state-complete/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-state-complete dark:text-state-complete">{t('project.payments.released')}</p>
          <p className="text-2xl font-extrabold text-state-complete dark:text-state-complete mt-0.5 tabular-nums">{formatUSD(released)}</p>
          <p className="text-[10px] text-state-complete/70 dark:text-state-complete/70 mt-0.5">{t('project.payments.ofTotal', { pct: releasedPct.toFixed(1) })}</p>
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
                state === 'released' ? 'bg-state-complete text-white'
                  : state === 'transit' ? 'bg-state-active text-white'
                  : state === 'held' ? 'bg-brand-off-white dark:bg-state-held/30 text-state-held dark:text-state-held'
                  : 'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
              )}>
                {state === 'released' ? <Check className="size-3.5 stroke-[3]" />
                  : state === 'locked' ? <Lock className="size-3" />
                  : s.stage_number}
              </div>

              <div className="flex-1 min-w-0">
                <p className={cn('text-[13px] font-medium truncate',
                  state === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white')}>
                  {stageLabel(s)}
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
                    {t('project.payments.pay')}
                  </button>
                ) : state === 'released' || state === 'transit' ? (
                  <button
                    type="button"
                    onClick={() => onViewPayout(s)}
                    className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold hover:opacity-80 transition-opacity', BADGE[state].cls)}
                  >
                    {t(BADGE[state].labelKey)}
                  </button>
                ) : (
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold', BADGE[state].cls)}>
                    {t(BADGE[state].labelKey)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-brand-soft-grey text-center mt-4 leading-relaxed">
        {t('project.payments.previewNote')}
      </p>
    </div>
  );
}
