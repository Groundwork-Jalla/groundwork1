import { useMemo } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, Clock, AlertTriangle, MinusCircle, ArrowRight } from 'lucide-react';
import type { Payment } from '@/lib/supabase/payments';
import { stageFlow, providerConnected, type Leg, type LegState } from '@/lib/admin/stage-money-flow';
import { formatUSDFull } from '@/lib/budget';
import { formatDate } from '@/lib/format';
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
  const cls = 'size-3.5 shrink-0';
  if (state === 'done')     return <CheckCircle2 className={cn(cls, 'text-state-complete')} />;
  if (state === 'inFlight') return <Clock className={cn(cls, 'text-state-held')} />;
  if (state === 'failed')   return <AlertTriangle className={cn(cls, 'text-state-alert')} />;
  if (state === 'review')   return <Clock className={cn(cls, 'text-state-alert')} />;
  if (state === 'noProvider' || state === 'notScheduled') return <MinusCircle className={cn(cls, 'text-brand-mid-grey')} />;
  return <Circle className={cn(cls, 'text-brand-mid-grey')} />;
}

export function MoneyFlow({ projectId, payments, stages, nameOf }: {
  projectId: string;
  payments: Payment[];
  stages: { id: string; stage_number: number; name: string; stage_key: string | null; payment_milestone_usd: number | null }[];
  /** Resolve a person id to something readable, or null when the account is unknown. */
  nameOf: (id: string | null) => string | null;
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
    <section className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <h3 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.flow.title')}</h3>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.flow.subtitle')}</p>
      </header>

      {/* The reason nothing past "approved" ever moves, stated once rather than implied
          four times by a row of grey dots. */}
      {!connected && (
        <p className="flex items-start gap-2 border-b border-brand-border-grey bg-state-held/5 px-5 py-2.5 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-state-held" aria-hidden />
          <span>
            {t('admin.flow.noProviderNote')}{' '}
            <Link to="/admin/integrations" className="font-semibold underline-offset-2 hover:underline">
              {t('admin.flow.openIntegrations')}
            </Link>
          </span>
        </p>
      )}

      <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
        {flows.map(({ stage, flow }) => (
          <li key={stage.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-brand-near-black dark:text-white">
                <span className="tabular-nums text-brand-mid-grey">{stage.stage_number}</span> {stageLabel(stage)}
              </p>
              <p className="text-xs tabular-nums text-brand-mid-grey">
                {(flow.milestone ?? 0) > 0 ? formatUSDFull(flow.milestone!) : t('admin.flow.noMilestone')}
              </p>
            </div>

            {/* The journey. Wraps on narrow screens rather than scrolling sideways. */}
            <ol className="mt-2 flex flex-wrap items-stretch gap-x-2 gap-y-2">
              {flow.legs.map((leg, i) => (
                <li key={leg.key} className="flex items-stretch gap-2">
                  <div className="min-w-[8.5rem]">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-brand-near-black dark:text-white">
                      <Icon state={leg.state} />{t(LEG_KEY[leg.key])}
                    </p>
                    <p className={cn('mt-0.5 pl-5 text-[11px]',
                      leg.state === 'done' ? 'text-state-complete'
                      : leg.state === 'failed' || leg.state === 'review' ? 'text-state-alert'
                      : leg.state === 'inFlight' ? 'text-state-held'
                      : 'text-brand-mid-grey')}>
                      {t(STATE_KEY[leg.state])}
                    </p>
                    {/* Only what the ledger holds. A leg with no timestamp shows none. */}
                    {leg.amount !== null && leg.state !== 'notScheduled' && (
                      <p className="pl-5 text-[11px] tabular-nums text-brand-mid-grey">{formatUSDFull(leg.amount)}</p>
                    )}
                    {leg.at && <p className="pl-5 text-[11px] text-brand-mid-grey">{formatDate(leg.at)}</p>}
                    {nameOf(leg.actorId) && <p className="pl-5 text-[11px] text-brand-mid-grey">{nameOf(leg.actorId)}</p>}
                  </div>
                  {i < flow.legs.length - 1 && (
                    <ArrowRight className="mt-0.5 size-3 shrink-0 self-start text-brand-border-grey" aria-hidden />
                  )}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
