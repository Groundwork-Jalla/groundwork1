import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Search, AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { loadFinanceLedger, type LedgerData } from '@/lib/supabase/finance-ledger';
import { matchesLine, totalsFor, purposeOf, type LedgerLine } from '@/lib/admin/finance-ledger';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { formatUSDFull } from '@/lib/budget';
import { formatDate } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Inflow and Disbursements (01 §3 FINANCE).
//
// One component, two directions, because the question is the same shape either way:
// where did this money go, when, and what was it for. The Budgets page answers what a
// build SHOULD cost; this answers what actually moved.
//
// Every figure is a row in `payments`. Nothing is derived from a budget, a projection or
// `project_stages.payment_status` — a number here is a movement of money or it is absent.
// =========================================================

/** What the operator is told, per state. The database's words are not the client's. */
const STATE_KEY: Record<string, TKey> = {
  expected:           'admin.finance.state.expected',
  funded:             'admin.finance.state.funded',
  reconciled:         'admin.finance.state.reconciled',
  release_authorised: 'admin.finance.state.authorised',
  initiated:          'admin.finance.state.initiated',
  disbursed:          'admin.finance.state.disbursed',
  failed:             'admin.finance.state.failed',
  reconciling:        'admin.finance.state.reconciling',
};
const TONE: Record<string, string> = {
  funded: 'text-state-complete', reconciled: 'text-state-complete', disbursed: 'text-state-complete',
  expected: 'text-state-held', release_authorised: 'text-state-held',
  initiated: 'text-state-held', reconciling: 'text-state-alert',
  failed: 'text-state-alert',
};

export function FinanceLedger({ direction }: { direction: 'in' | 'out' }) {
  const t = useT();
  const [data, setData] = useState<LedgerData | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /**
   * Inbound only. Expected money is a scheduled tranche, not a receipt — keeping the two
   * on one list is how a total that has not arrived starts being read as one that has.
   */
  const [tab, setTab] = useState<'received' | 'expected'>('received');

  const load = useCallback(async () => {
    try { setData(await loadFinanceLedger()); }
    catch { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = useMemo(
    () => (data?.lines ?? []).filter(l => l.direction === direction),
    [data, direction],
  );
  const inTab = useMemo(() => {
    if (direction !== 'in') return mine;
    return tab === 'received'
      ? mine.filter(l => l.state === 'funded' || l.state === 'reconciled')
      : mine.filter(l => l.state === 'expected');
  }, [mine, direction, tab]);
  const shown = useMemo(() => inTab.filter(l => matchesLine(l, query)), [inTab, query]);
  const totals = useMemo(() => totalsFor(data?.lines ?? [], direction), [data, direction]);

  const inbound = direction === 'in';

  if (data === undefined) {
    return <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
  }
  if (data === null || !data.available) {
    // Unreadable, which is not an empty ledger and must not become a row of zeroes.
    return <p className="rounded-2xl border border-brand-border-grey bg-brand-off-white px-5 py-6 text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{t('admin.finance.unavailable')}</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t(inbound ? 'admin.finance.inflowTitle' : 'admin.finance.outflowTitle')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">
          {t(inbound ? 'admin.finance.inflowSub' : 'admin.finance.outflowSub')}
        </p>
      </header>

      {/* A lookup that failed costs a name, never a row — said plainly rather than left
          to look like missing data. */}
      {data.degraded.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-state-held/40 bg-state-held/5 px-4 py-2.5 text-xs text-brand-near-black dark:text-white">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-state-held" aria-hidden />
          {t('admin.finance.degraded', { domains: data.degraded.join(', ') })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {inbound ? (
          <>
            <Figure label={t('admin.finance.received')} value={formatUSDFull(totals.settled)} tone="complete" />
            {/* Never added to the figure above it: expected is money that has not arrived. */}
            <Figure label={t('admin.finance.awaited')} value={formatUSDFull(totals.pending)} tone="held" />
            <Figure label={t('admin.finance.movements')} value={String(totals.count)} tone="neutral" />
          </>
        ) : (
          <>
            {/* Approved and Processing are separate because a decision is not a payment. */}
            <Figure label={t('admin.finance.state.authorised')} value={formatUSDFull(totals.approved)} tone="held" />
            <Figure label={t('admin.finance.state.initiated')} value={formatUSDFull(totals.processing)} tone="held" />
            <Figure label={t('admin.finance.paidOut')} value={formatUSDFull(totals.settled)} tone="complete" />
            <Figure label={t('admin.finance.state.failed')} value={formatUSDFull(totals.failed)} tone="alert" />
          </>
        )}
      </div>

      {inbound && (
        <div className="flex items-center gap-1.5">
          {(['received', 'expected'] as const).map(k => (
            <button
              key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                tab === k
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]'
                  : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black dark:border-[#2c2c2c]')}
            >
              {t(`admin.finance.tab.${k}` as TKey)}
            </button>
          ))}
        </div>
      )}

      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('admin.finance.search')} aria-label={t('admin.finance.search')}
          className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
        />
      </div>

      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-brand-mid-grey">
          {inTab.length === 0
            ? t(inbound ? (tab === 'expected' ? 'admin.finance.noExpected' : 'admin.finance.noInflow') : 'admin.finance.noOutflow')
            : t('admin.finance.noMatch')}
        </p>
      ) : (
        <ul className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-brand-border-grey lg:rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white lg:dark:border-[#2c2c2c] lg:dark:bg-[#1e1e1e]">
          {shown.map(l => (
            <li key={l.id} className="rounded-2xl border border-brand-border-grey bg-white lg:rounded-none lg:border-0 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <button
                type="button" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-off-white lg:px-5 dark:hover:bg-[#252525]"
              >
                {inbound
                  ? <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-state-complete" aria-hidden />
                  : <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />}

                <span className="min-w-0 flex-1">
                  {/* WHO. Never a raw id: an account we cannot read says so. */}
                  <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">
                    {l.partyName ?? t('admin.finance.unknownParty')}
                  </span>
                  {/* WHAT FOR. */}
                  <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">
                    {l.projectName ?? t('admin.finance.unknownProject')}
                    {' · '}
                    {/* Stage, then a written note, then nothing. Never inferred. */}
                    {l.stage
                      ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</>
                      : purposeOf(l) ?? t('admin.finance.noPurpose')}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
                    {formatUSDFull(l.amount)}
                  </span>
                  <span className={cn('block text-xs', TONE[l.state] ?? 'text-brand-mid-grey')}>
                    {t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}
                  </span>
                  {/* WHEN — labelled with what the date actually means. */}
                  <span className="block text-[11px] text-brand-mid-grey">
                    {t(`admin.finance.at.${l.atMeans}` as TKey, { date: formatDate(l.at) })}
                  </span>
                </span>
              </button>

              {open === l.id && (
                <dl className="border-t border-brand-border-grey/60 px-4 py-3 text-xs lg:px-5 dark:border-[#2c2c2c]">
                  {/* Only fields the ledger holds. Nothing is filled in. */}
                  {l.actorName && (
                    <Row label={t(inbound ? 'admin.finance.confirmedBy' : 'admin.finance.authorisedBy')} value={l.actorName} />
                  )}
                  {inbound && l.via && <Row label={t('admin.finance.via')} value={t(`admin.finance.source.${l.via}` as TKey)} />}
                  {l.providerRef && <Row label={t('admin.finance.providerRef')} value={l.providerRef} />}
                  {l.failureReason && <Row label={t('admin.finance.whyFailed')} value={l.failureReason} tone="text-state-alert" />}
                  {l.note && <Row label={t('admin.finance.note')} value={l.note} />}
                  <div className="pt-1.5">
                    <Link
                      to={workspaceHref(l.projectId, { tab: 'financials' })}
                      className="inline-flex items-center gap-1.5 font-semibold text-brand-near-black underline-offset-2 hover:underline dark:text-white"
                    >
                      {t('admin.finance.openProject')}<ExternalLink className="size-3" />
                    </Link>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone: 'complete' | 'held' | 'alert' | 'neutral' }) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[11px] font-medium text-brand-mid-grey">{label}</p>
      <p className={cn('mt-1 text-xl font-black tabular-nums',
        tone === 'complete' ? 'text-state-complete'
        : tone === 'alert' ? 'text-state-alert'
        : 'text-brand-near-black dark:text-white')}>
        {value}
      </p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="shrink-0 text-brand-mid-grey">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right', tone ?? 'text-brand-near-black dark:text-white')}>{value}</dd>
    </div>
  );
}
