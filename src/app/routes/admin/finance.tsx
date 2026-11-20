import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { loadFinanceLedger, type LedgerData } from '@/lib/supabase/finance-ledger';
import { totalsFor, projectTotals, purposeOf, needsAttention, type LedgerLine } from '@/lib/admin/finance-ledger';
import { monthlyFlows, shares } from '@/lib/admin/finance-trend';
import { availableFunds } from '@/lib/lifecycle/stage';
import { listAllPayments } from '@/lib/supabase/payments';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { formatUSDFull } from '@/lib/budget';
import { formatDate } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/finance — what happened to the money (01 §3 FINANCE).
//
// Budgets & Fees answers what a build SHOULD cost. This answers what actually moved, and
// the two are deliberately different pages: a plan and a ledger disagree all the time,
// and a screen that mixes them makes the disagreement invisible.
//
// Every figure is a sum of `payments` rows. Nothing comes from `budget_usd`, from
// `project_stages.payment_status`, or from a provider state nobody reported.
// =========================================================

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
/** State pills for the movement table: settled green, waiting amber, trouble red. */
const PILL: Record<string, string> = {
  funded: 'bg-state-complete/10 text-state-complete', reconciled: 'bg-state-complete/10 text-state-complete', disbursed: 'bg-state-complete/10 text-state-complete',
  expected: 'bg-state-held/10 text-state-held', release_authorised: 'bg-state-held/10 text-state-held', initiated: 'bg-state-held/10 text-state-held',
  reconciling: 'bg-state-alert/10 text-state-alert', failed: 'bg-state-alert/10 text-state-alert',
};
const PERIODS = [3, 6, 12] as const;
const IN_COLOUR = 'bg-brand-green dark:bg-state-complete';
const OUT_COLOUR = 'bg-[#d9b46a]';
const AVAILABLE_COLOUR = 'bg-[#cfe0d5] dark:bg-[#2f4a3b]';

const TONE: Record<string, string> = {
  funded: 'text-state-complete', reconciled: 'text-state-complete', disbursed: 'text-state-complete',
  expected: 'text-state-held', release_authorised: 'text-state-held', initiated: 'text-state-held',
  reconciling: 'text-state-alert', failed: 'text-state-alert',
};

export default function AdminFinance() {
  const t = useT();
  const [data, setData] = useState<LedgerData | null | undefined>(undefined);
  /** The raw rows, so `availableFunds` sees exactly what the admin ledger sees. */
  const [available, setAvailable] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [shaped, raw] = await Promise.all([loadFinanceLedger(), listAllPayments().catch(() => ({ rows: [], available: false }))]);
      setData(shaped);
      setAvailable(raw.available ? availableFunds(raw.rows) : null);
    } catch { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lines = data?.lines ?? [];
  const inflow  = useMemo(() => totalsFor(lines, 'in'),  [lines]);
  const outflow = useMemo(() => totalsFor(lines, 'out'), [lines]);
  const attention = useMemo(() => needsAttention(lines), [lines]);
  const byProject = useMemo(() => projectTotals(lines), [lines]);
  const recent = useMemo(() => lines.slice(0, 12), [lines]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(6);
  const [now] = useState(() => new Date());
  const months = useMemo(() => monthlyFlows(lines, period, now), [lines, period, now]);

  if (data === undefined) {
    return <div className="p-6 sm:p-8"><p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p></div>;
  }
  if (data === null || !data.available) {
    return (
      <div className="p-6 sm:p-8">
        <p className="rounded-2xl border border-brand-border-grey bg-brand-off-white px-5 py-6 text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('admin.finance.unavailable')}
        </p>
      </div>
    );
  }

  const approved = outflow.approved + outflow.processing;
  const peak = Math.max(1, ...months.map(m => Math.max(m.inflow, m.disbursed)));
  const standing = [
    { key: 'disbursed', label: t('admin.finance.disbursed'), value: outflow.settled, colour: IN_COLOUR },
    { key: 'approved',  label: t('admin.finance.approvedForRelease'), value: approved, colour: OUT_COLOUR },
    ...(available === null ? [] : [{ key: 'available', label: t('admin.finance.availableFunding'), value: available, colour: AVAILABLE_COLOUR }]),
  ];
  const widths = shares(standing.map(s => s.value));
  const monthName = (key: string) => new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-[28px]">{t('admin.finance.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.finance.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label={t('admin.finance.confirmedInflows')} value={formatUSDFull(inflow.settled)} note={t('admin.finance.inflowsNote')} tone="complete" to="/admin/finance/inflows" />
        {/* A decision, not a payment — its own card for exactly that reason. */}
        <Card label={t('admin.finance.approvedForRelease')} value={formatUSDFull(approved)} note={t('admin.finance.approvedNote')} tone="held" to="/admin/finance/disbursements" />
        <Card label={t('admin.finance.disbursed')} value={formatUSDFull(outflow.settled)} note={t('admin.finance.disbursedNote')} tone="complete" to="/admin/finance/disbursements" />
        {/* Confirmed in, minus everything out that has not failed. The same helper the
            project ledger uses, so the two surfaces cannot disagree. */}
        <Card label={t('admin.finance.availableFunding')}
              value={available === null ? t('admin.finance.notAvailable') : formatUSDFull(available)}
              note={t('admin.finance.availableNote')} tone="neutral" />
      </div>

      {attention.length > 0 && (
        <Link to="/admin/finance/disbursements"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[1.5px] border-state-alert bg-[#fbf6f7] px-4 py-3 text-sm text-brand-near-black transition-colors hover:bg-[#f7eef0] dark:bg-[#231a1c] dark:text-white">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-state-alert" aria-hidden />
            <span><span className="font-semibold">{t('admin.finance.needsAttention', { n: attention.length })}</span> <span className="text-brand-mid-grey">· {t('admin.finance.attentionNote')}</span></span>
          </span>
          <span className="font-semibold text-brand-green dark:text-state-complete">{t('admin.finance.openDisbursements')}</span>
        </Link>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <h2 className="text-sm font-bold text-brand-near-black dark:text-white">{t('admin.finance.flowTitle')}</h2>
            <div role="group" aria-label={t('admin.finance.flowTitle')} className="flex rounded-lg border border-brand-border-grey p-0.5 dark:border-[#2c2c2c]">
              {PERIODS.map(n => (
                <button key={n} type="button" onClick={() => setPeriod(n)} aria-pressed={period === n}
                  className={cn('rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                    period === n ? 'bg-brand-green text-white' : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
                  {t('admin.finance.months', { n })}
                </button>
              ))}
            </div>
          </div>
          <p className="px-5 pt-1 text-xs text-brand-mid-grey">{t('admin.finance.flowSub')}</p>
          {months.every(m => m.inflow === 0 && m.disbursed === 0) ? (
            <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">{t('admin.finance.noFlow')}</p>
          ) : (
            <div className="flex h-44 items-end gap-3 px-5 pb-1 pt-4 sm:gap-5">
              {months.map(m => (
                <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
                  role="img" aria-label={`${monthName(m.key)}: ${t('admin.finance.confirmedInflows')} ${formatUSDFull(m.inflow)}, ${t('admin.finance.disbursed')} ${formatUSDFull(m.disbursed)}`}>
                  <div className="flex w-full flex-1 items-end gap-1 border-b border-brand-border-grey dark:border-[#2c2c2c]">
                    <span title={formatUSDFull(m.inflow)} className={cn('block flex-1 rounded-t', IN_COLOUR)} style={{ height: `${(m.inflow / peak) * 100}%` }} />
                    <span title={formatUSDFull(m.disbursed)} className={cn('block flex-1 rounded-t', OUT_COLOUR)} style={{ height: `${(m.disbursed / peak) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-brand-mid-grey">{monthName(m.key)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="flex gap-4 px-5 pb-4 pt-2 text-xs text-brand-mid-grey">
            <span className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-full', IN_COLOUR)} />{t('admin.finance.confirmedInflows')}</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-full', OUT_COLOUR)} />{t('admin.finance.disbursed')}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="px-5 pt-4 text-sm font-bold text-brand-near-black dark:text-white">{t('admin.finance.standsTitle')}</h2>
          <p className="px-5 pt-1 text-xs text-brand-mid-grey">{t('admin.finance.standsSub')}</p>
          <div className="mx-5 mt-3 flex h-4 overflow-hidden rounded-full bg-brand-light-grey" aria-hidden>
            {standing.map((s, i) => <span key={s.key} className={cn('block h-full', s.colour)} style={{ width: `${widths[i]}%` }} />)}
          </div>
          <dl className="px-5 pb-3 pt-2">
            {standing.map(s => (
              <div key={s.key} className="flex items-center justify-between gap-3 border-t border-brand-border-grey py-2 text-[13px] first:border-t-0 dark:border-[#2c2c2c]">
                <dt className="flex items-center gap-2 text-brand-near-black dark:text-white"><span className={cn('size-2 rounded-full', s.colour)} />{s.label}</dt>
                <dd className="font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(s.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {byProject.length > 0 && (
        <section data-finance-by-project className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-3 pt-4">
            <div>
              <h2 className="text-sm font-bold text-brand-near-black dark:text-white">{t('admin.finance.byProjectTitle')}</h2>
              <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.finance.byProjectSub')}</p>
            </div>
            <span className="text-xs text-brand-mid-grey">{t('admin.finance.byProjectCount', { n: byProject.length })}</span>
          </div>
          <div className="overflow-x-auto border-t border-brand-border-grey dark:border-[#2c2c2c]">
            <table className="w-full text-left text-xs">
              <thead className="bg-brand-off-white text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey dark:bg-[#141414]">
                <tr>
                  <th className="px-5 py-2.5">{t('admin.finance.colProject')}</th>
                  <th className="px-4 py-2.5 text-right">{t('admin.finance.confirmedInflows')}</th>
                  <th className="px-4 py-2.5 text-right">{t('admin.finance.colExpected')}</th>
                  <th className="px-4 py-2.5 text-right">{t('admin.finance.disbursed')}</th>
                  <th className="px-5 py-2.5 text-right">{t('admin.finance.colAvailable')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                {byProject.map(p => (
                  <tr key={p.projectId} className="transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                    <td className="px-5 py-3 font-semibold text-brand-near-black dark:text-white">
                      <Link to={workspaceHref(p.projectId, { tab: 'financials' })} className="hover:text-brand-green hover:underline dark:hover:text-state-complete">
                        {p.projectName ?? t('admin.finance.unknownProject')}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-state-complete">{formatUSDFull(p.confirmedIn)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-state-held">{formatUSDFull(p.expectedIn)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(p.disbursedOut)}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(p.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white lg:dark:border-[#2c2c2c] lg:dark:bg-[#1e1e1e]">
        <div className="flex items-center justify-between gap-2 pb-2 lg:px-5 lg:pb-3 lg:pt-4">
          <h2 className="text-sm font-bold text-brand-near-black dark:text-white">{t('admin.finance.recentTitle')}</h2>
          {recent.length > 0 && <span className="text-xs text-brand-mid-grey">{t('admin.finance.latest', { n: recent.length })}</span>}
        </div>
        {recent.length === 0 ? (
          <p className="pb-4 text-sm text-brand-mid-grey lg:px-5">{t('admin.finance.noMovement')}</p>
        ) : (
          <ul className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-brand-border-grey lg:border-t lg:border-brand-border-grey lg:dark:divide-[#2c2c2c] lg:dark:border-[#2c2c2c]">
            {recent.map(l => <Movement key={l.id} line={l} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One movement: what, when, which project, why, who, how much, where it stands. */
function Movement({ line: l }: { line: LedgerLine }) {
  const t = useT();
  const inbound = l.direction === 'in';
  const purpose = l.stage
    ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</>
    : purposeOf(l) ?? t('admin.finance.noPurpose');
  return (
    <li className="rounded-2xl border border-brand-border-grey bg-white lg:rounded-none lg:border-0 lg:bg-transparent dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <Link to={workspaceHref(l.projectId, { tab: 'financials' })}
        className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-brand-off-white lg:grid-cols-[1.75rem_minmax(0,1.2fr)_minmax(0,1.6fr)_7.5rem_9rem_5.5rem] lg:px-5 dark:hover:bg-[#252525]">
        <span className={cn('grid size-7 place-items-center rounded-full',
          inbound ? 'bg-state-complete/10 text-state-complete' : 'bg-state-held/10 text-state-held')}>
          {inbound ? <ArrowDownLeft className="size-3.5" aria-hidden /> : <ArrowUpRight className="size-3.5" aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-brand-near-black dark:text-white">
            {t(inbound ? 'admin.finance.typeInflow' : 'admin.finance.typeDisbursement')}
          </span>
          {/* Never a raw id: an account we cannot read says so. */}
          <span className="block truncate text-xs text-brand-mid-grey">{l.partyName ?? t('admin.finance.unknownParty')}</span>
          {/* On a phone the project and purpose sit here, under the party. */}
          <span className="block truncate text-xs text-brand-mid-grey lg:hidden">{l.projectName ?? t('admin.finance.unknownProject')} · {purpose}</span>
        </span>
        <span className="hidden min-w-0 lg:block">
          <span className="block truncate text-[13px] text-brand-near-black dark:text-white">{l.projectName ?? t('admin.finance.unknownProject')}</span>
          <span className="block truncate text-xs text-brand-mid-grey">{purpose}</span>
        </span>
        <span className="text-right lg:text-left">
          <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(l.amount)}</span>
          {l.local && <span className="block text-[11px] tabular-nums text-brand-mid-grey">{l.local}</span>}
          <span className={cn('mt-0.5 block text-xs lg:hidden', TONE[l.state] ?? 'text-brand-mid-grey')}>{t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}</span>
          <span className="block text-[11px] text-brand-mid-grey lg:hidden">{formatDate(l.at)}</span>
        </span>
        <span className={cn('hidden justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold lg:inline-block', PILL[l.state] ?? 'bg-brand-light-grey text-brand-mid-grey')}>
          {t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}
        </span>
        <span className="hidden text-xs text-brand-mid-grey lg:block">{formatDate(l.at)}</span>
      </Link>
    </li>
  );
}

function Card({ label, value, note, tone, to }: {
  label: string; value: string; note?: string; tone: 'complete' | 'held' | 'neutral'; to?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey">
        {tone !== 'neutral' && <span aria-hidden className={cn('size-2 rounded-full', tone === 'complete' ? 'bg-state-complete' : 'bg-state-held')} />}
        {label}
      </p>
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums tracking-tight',
        tone === 'complete' ? 'text-state-complete' : tone === 'held' ? 'text-state-held' : 'text-brand-near-black dark:text-white')}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] text-brand-mid-grey">{note}</p>}
    </>
  );
  const cls = 'block rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return to
    ? <Link to={to} className={cn(cls, 'transition-colors hover:border-brand-near-black dark:hover:border-white/40')}>{body}</Link>
    : <div className={cls}>{body}</div>;
}
