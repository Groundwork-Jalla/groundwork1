import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, Clock, AlertTriangle, MinusCircle } from 'lucide-react';
import type { Payment } from '@/lib/supabase/payments';
import { stageFlow, providerConnected, type Leg, type LegState } from '@/lib/admin/stage-money-flow';
import { formatUSDFull } from '@/lib/budget';
import { formatDate } from '@/lib/format';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { useStageLabels } from '@/lib/stage-labels';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Where each stage's money actually is (01 §3 FINANCE).
//
// Four legs per stage: the client's money arriving, Groundwork authorising a release,
// the provider taking it, the contractor being paid. The admin's other financial panels
// are organised by DOMAIN — every tranche, every release, every reconciliation. This one
// is organised by JOURNEY, which is the question "where is the money for stage 3?".
//
// ── It does not pretend leg 3 is in progress ─────────────────────────────────────────
// `initiated` and `disbursed` are reachable only through `record_payment_event`, which
// nothing calls. So an authorised release does not move, and drawing it as "pending"
// would say the money is on its way when nothing is carrying it. Where no provider has
// ever written to the ledger, those legs say so and point at Integrations.
// =========================================================

const LEG_KEY: Record<Leg['key'], TKey> = {
  funding:      'admin.flow.leg.funding',
  authorised:   'admin.flow.leg.authorised',
  toProvider:   'admin.flow.leg.toProvider',
  toContractor: 'admin.flow.leg.toContractor',
};
const STATE_KEY: Record<LegState, TKey> = {
  waiting:      'admin.flow.state.waiting',
  inFlight:     'admin.flow.state.inFlight',
  done:         'admin.flow.state.done',
  failed:       'admin.flow.state.failed',
  review:       'admin.flow.state.review',
  noProvider:   'admin.flow.state.noProvider',
  notScheduled: 'admin.flow.state.notScheduled',
};

function Icon({ state }: { state: LegState }) {
  const cls = 'size-4 shrink-0';
  if (state === 'done')     return <CheckCircle2 className={cn(cls, 'text-state-complete')} />;
  if (state === 'inFlight') return <Clock className={cn(cls, 'text-state-held')} />;
  if (state === 'failed')   return <AlertTriangle className={cn(cls, 'text-state-alert')} />;
  if (state === 'review')   return <Clock className={cn(cls, 'text-state-alert')} />;
  if (state === 'noProvider' || state === 'notScheduled') return <MinusCircle className={cn(cls, 'text-brand-mid-grey')} />;
  return <Circle className={cn(cls, 'text-brand-mid-grey')} />;
}

export function MoneyFlow({ projectId, payments, stages, nameOf, local, lifecycleOf, actionOf }: {
  projectId: string;
  payments: Payment[];
  stages: { id: string; stage_number: number; name: string; stage_key: string | null; payment_milestone_usd: number | null }[];
  /** Resolve a person id to something readable, or null when the account is unknown. */
  nameOf: (id: string | null) => string | null;
  /** The amount in the project's own currency, when it has one other than USD. */
  local?: (usd: number) => string | null;
  /** The stage's lifecycle cell, rendered by the tab that owns the stage view. */
  lifecycleOf?: (stageId: string) => ReactNode;
  /** The stage's one act, rendered by the tab that owns the modal. */
  actionOf?: (stageId: string) => ReactNode;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();

  // Derived from the rows, so the day a provider writes one this corrects itself.
  const connected = useMemo(() => providerConnected(payments), [payments]);
  const flows = useMemo(
    () => [...stages].sort((a, b) => a.stage_number - b.stage_number)
      .map(s => ({ stage: s, flow: stageFlow(payments, s, connected) })),
    [stages, payments, connected],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-brand-near-black dark:text-white">{t('admin.flow.title')}</h3>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.flow.subtitle')}</p>
        </div>
      </header>

      {/* The reason nothing past "approved" ever moves, stated once rather than implied
          four times by a row of grey dots. */}
      {!connected && (
        <p className="flex items-start gap-2 border-b border-brand-border-grey bg-[#fbf8f2] px-5 py-2.5 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#231f17] dark:text-white">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-state-held" aria-hidden />
          <span>
            {t('admin.flow.noProviderNote')}{' '}
            <Link to="/admin/integrations" className="font-semibold underline underline-offset-2">
              {t('admin.flow.openIntegrations')}
            </Link>
          </span>
        </p>
      )}

      {/* One row per stage: milestone, the four-leg journey, then what the tab adds. Scrolls
          sideways on a phone rather than squashing the journey. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-xs">
          <thead className="border-b border-brand-border-grey bg-brand-off-white text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
            <tr>
              <th className="px-5 py-2.5 text-left">{t('admin.workspace.financials.colStage')}</th>
              <th className="px-3 py-2.5 text-left">{t('admin.workspace.stage.milestone')}</th>
              {(['funding', 'authorised', 'toProvider', 'toContractor'] as const).map(k => (
                <th key={k} className="px-2 py-2.5 text-left">{t(LEG_KEY[k])}</th>
              ))}
              {lifecycleOf && <th className="px-3 py-2.5 text-left">{t('admin.workspace.financials.colLifecycle')}</th>}
              {actionOf && <th className="px-5 py-2.5 text-left">{t('admin.workspace.financialsView.colAction')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {flows.map(({ stage, flow }) => (
              <tr key={stage.id} className="align-top">
                <td className="px-5 py-3">
                  <Link to={workspaceHref(projectId, { tab: 'stages', stageId: stage.id })} className="font-semibold text-brand-near-black hover:underline dark:text-white">
                    <span className="tabular-nums text-brand-mid-grey">{stage.stage_number}</span> {stageLabel(stage)}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  {(flow.milestone ?? 0) > 0 ? (
                    <>
                      <span className="block font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(flow.milestone!)}</span>
                      {local?.(flow.milestone!) && <span className="block text-[11px] tabular-nums text-brand-mid-grey">{local(flow.milestone!)}</span>}
                    </>
                  ) : <span className="text-brand-mid-grey">{t('admin.flow.noMilestone')}</span>}
                </td>
                {flow.legs.map((leg, i) => (
                  <td key={leg.key} className="px-2 py-3">
                    <span className="relative flex items-center">
                      <Icon state={leg.state} />
                      {i < flow.legs.length - 1 && (
                        <span aria-hidden className={cn('ml-1 h-0.5 flex-1', leg.state === 'done' ? 'bg-brand-green dark:bg-state-complete' : 'bg-brand-border-grey dark:bg-[#2c2c2c]')} />
                      )}
                    </span>
                    <span className={cn('mt-1 block text-[11px] font-semibold',
                      leg.state === 'done' ? 'text-state-complete'
                      : leg.state === 'failed' || leg.state === 'review' ? 'text-state-alert'
                      : leg.state === 'inFlight' ? 'text-state-held'
                      : 'text-brand-mid-grey')}>
                      {t(STATE_KEY[leg.state])}
                    </span>
                    {/* Only what the ledger holds. A leg with no timestamp shows none. */}
                    {leg.amount !== null && leg.state !== 'notScheduled' && (
                      <span className="block text-[11px] tabular-nums text-brand-mid-grey">{formatUSDFull(leg.amount)}</span>
                    )}
                    {leg.at && <span className="block text-[11px] text-brand-mid-grey">{formatDate(leg.at)}</span>}
                    {nameOf(leg.actorId) && <span className="block text-[11px] text-brand-mid-grey">{nameOf(leg.actorId)}</span>}
                  </td>
                ))}
                {lifecycleOf && <td className="px-3 py-3">{lifecycleOf(stage.id)}</td>}
                {actionOf && <td className="px-5 py-3">{actionOf(stage.id)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actionOf && <p className="border-t border-brand-border-grey px-5 py-3 text-[11px] text-brand-mid-grey dark:border-[#2c2c2c]">{t('admin.workspace.financialsView.actionNote')}</p>}
    </section>
  );
}
