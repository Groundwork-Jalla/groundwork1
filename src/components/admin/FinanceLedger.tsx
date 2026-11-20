import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Search, AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink, RefreshCw } from 'lucide-react';
import { loadFinanceLedger, type LedgerData } from '@/lib/supabase/finance-ledger';
import { attachPayoutReference } from '@/lib/supabase/payout-attach';
import { attachRefusal } from '@/lib/payments/payout-reference';
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

// ── Filing the transaction that paid a release ────────────
//
// Groundwork does not move this money — SwyChr does, and their payout API publishes no
// webhook and cannot be asked which transactions exist. So the link between an
// authorised release and the transfer that settled it is a fact only a person holds.
//
// Once it is filed the row reaches `initiated` and the five-minute poll takes over,
// driving it to disbursed or failed on SwyChr's word. Nothing here decides an amount.
function AttachReference({ line, onFiled }: { line: LedgerLine; onFiled: () => void }) {
  const t = useT();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same rule the server enforces, so the field is absent rather than rejected.
  if (attachRefusal({ direction: line.direction, state: line.state, providerRef: line.providerRef }, 'x') !== null) {
    return null;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await attachPayoutReference(line.id, reference);
      setReference('');
      onFiled();
    } catch (err) {
      // The server's reason code, translated. An unknown one is shown as itself rather
      // than as a friendly sentence that might describe a different failure.
      const code = err instanceof Error ? err.message : 'unknown';
      setError(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border-[1.5px] border-brand-green p-3.5 dark:border-state-complete">
      <label htmlFor={`ref-${line.id}`} className="block text-sm font-bold text-brand-near-black dark:text-white">
        {t('admin.finance.attach.label')}
      </label>
      <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t('admin.finance.attach.hint')}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <input
          id={`ref-${line.id}`}
          value={reference}
          onChange={e => setReference(e.target.value)}
          placeholder={t('admin.finance.attach.placeholder')}
          className="min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs text-brand-near-black dark:border-[#3d3d3d] dark:bg-[#1e1e1e] dark:text-white"
        />
        <button
          type="submit"
          disabled={busy || reference.trim().length < 4}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-state-complete"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {t('admin.finance.attach.cta')}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-state-alert">
          {t(`admin.finance.attach.err.${error}` as TKey) === `admin.finance.attach.err.${error}`
            ? error
            : t(`admin.finance.attach.err.${error}` as TKey)}
        </p>
      )}
    </form>
  );
}

/** Wide screens show the selected movement beside the table; phones open it in place. */
function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return wide;
}

/** Outgoing status chips. `needs_ref` is the banner's filter: approved, no transaction filed. */
type OutChip = 'all' | 'release_authorised' | 'initiated' | 'disbursed' | 'failed' | 'reconciling' | 'needs_ref';
const OUT_CHIPS: Exclude<OutChip, 'needs_ref'>[] = ['all', 'release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling'];
const PILL: Record<string, string> = {
  funded: 'bg-state-complete/10 text-state-complete', reconciled: 'bg-state-complete/10 text-state-complete', disbursed: 'bg-state-complete/10 text-state-complete',
  expected: 'bg-state-held/10 text-state-held', release_authorised: 'bg-state-held/10 text-state-held', initiated: 'bg-state-held/10 text-state-held',
  reconciling: 'bg-state-alert/10 text-state-alert', failed: 'bg-state-alert/10 text-state-alert',
};
/** A filed reference can still be attached to this row — the server's own rule. */
const awaitsReference = (l: LedgerLine) =>
  attachRefusal({ direction: l.direction, state: l.state, providerRef: l.providerRef }, 'x') === null;

export function FinanceLedger({ direction }: { direction: 'in' | 'out' }) {
  const t = useT();
  const wide = useWide();
  const [data, setData] = useState<LedgerData | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Inbound only. Expected money is a scheduled tranche, not a receipt — keeping the two
   * on one list is how a total that has not arrived starts being read as one that has.
   */
  const [tab, setTab] = useState<'received' | 'expected'>('received');
  /** Outbound only: the status chip, or the banner's "needs a transaction ID". */
  const [chip, setChip] = useState<OutChip>('all');

  const load = useCallback(async () => {
    try { setData(await loadFinanceLedger()); }
    catch { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Refresh (Favour, 18 Nov): re-read the ledger now, rather than promising it in words.
  const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

  const mine = useMemo(
    () => (data?.lines ?? []).filter(l => l.direction === direction),
    [data, direction],
  );
  const inTab = useMemo(() => {
    if (direction !== 'in') {
      if (chip === 'all') return mine;
      if (chip === 'needs_ref') return mine.filter(awaitsReference);
      return mine.filter(l => l.state === chip);
    }
    return tab === 'received'
      ? mine.filter(l => l.state === 'funded' || l.state === 'reconciled')
      : mine.filter(l => l.state === 'expected');
  }, [mine, direction, tab, chip]);
  const shown = useMemo(() => inTab.filter(l => matchesLine(l, query)), [inTab, query]);
  const totals = useMemo(() => totalsFor(data?.lines ?? [], direction), [data, direction]);
  const count = (pred: (l: LedgerLine) => boolean) => mine.filter(pred).length;
  const needsRef = useMemo(() => mine.filter(awaitsReference).length, [mine]);

  const inbound = direction === 'in';
  // On a wide screen something is always selected, so the panel is never an empty box.
  const selectedId = open ?? (wide ? shown[0]?.id ?? null : null);
  const selected = shown.find(l => l.id === selectedId) ?? null;

  if (data === undefined) {
    return <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
  }
  if (data === null || !data.available) {
    // Unreadable, which is not an empty ledger and must not become a row of zeroes.
    return <p className="rounded-2xl border border-brand-border-grey bg-brand-off-white px-5 py-6 text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{t('admin.finance.unavailable')}</p>;
  }

  const detail = (l: LedgerLine) => (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', PILL[l.state] ?? 'bg-brand-light-grey text-brand-mid-grey')}>
          {t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}
        </span>
        <span className="text-xs text-brand-mid-grey">{t(`admin.finance.at.${l.atMeans}` as TKey, { date: formatDate(l.at) })}</span>
      </div>
      <div>
        <p className="text-3xl font-bold tabular-nums tracking-tight text-brand-near-black dark:text-white">{formatUSDFull(l.amount)}</p>
        {l.local && <p className="mt-0.5 text-sm tabular-nums text-brand-mid-grey">{l.local}</p>}
      </div>
      <div className="flex items-center gap-3">
        <Initials name={l.partyName} />
        <span className="min-w-0">
          {/* WHO. Never a raw id: an account we cannot read says so. */}
          <span className="block truncate text-sm font-semibold text-brand-near-black dark:text-white">{l.partyName ?? t('admin.finance.unknownParty')}</span>
          <span className="block text-xs text-brand-mid-grey">
            {l.projectName ?? t('admin.finance.unknownProject')}
            {' · '}
            {/* Stage, then a written note, then nothing. Never inferred. */}
            {l.stage
              ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</>
              : purposeOf(l) ?? t('admin.finance.noPurpose')}
          </span>
        </span>
      </div>
      <dl className="border-t border-brand-border-grey text-xs dark:border-[#2c2c2c]">
        {/* Only fields the ledger holds. Nothing is filled in. */}
        {l.actorName && (
          <Row label={t(inbound ? 'admin.finance.confirmedBy' : 'admin.finance.authorisedBy')} value={l.actorName} />
        )}
        {inbound && l.via && <Row label={t('admin.finance.via')} value={t(`admin.finance.source.${l.via}` as TKey)} />}
        {l.providerRef && <Row label={t('admin.finance.providerRef')} value={l.providerRef} />}
        {l.failureReason && <Row label={t('admin.finance.whyFailed')} value={l.failureReason} tone="text-state-alert" />}
        {l.note && <Row label={t('admin.finance.note')} value={l.note} />}
      </dl>
      {direction === 'out' && <AttachReference line={l} onFiled={load} />}
      <Link
        to={workspaceHref(l.projectId, { tab: 'financials' })}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-sm font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40"
      >
        {t('admin.finance.openProject')}<ExternalLink className="size-3.5" />
      </Link>
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-brand-mid-grey">
            <Link to="/admin/finance" className="hover:text-brand-near-black hover:underline dark:hover:text-white">{t('admin.finance.title')}</Link>
            {' · '}<span className="font-semibold text-brand-near-black dark:text-white">{t(inbound ? 'admin.finance.inflowTitle' : 'admin.finance.outflowTitle')}</span>
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-[28px]">
            {t(inbound ? 'admin.finance.inflowTitle' : 'admin.finance.outflowTitle')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">
            {t(inbound ? 'admin.finance.inflowSub' : 'admin.finance.outflowSub')}
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey bg-white px-3.5 py-2 text-sm font-semibold text-brand-near-black transition-colors hover:border-brand-near-black disabled:opacity-60 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
          {t('admin.finance.refresh')}
        </button>
      </header>

      {/* A lookup that failed costs a name, never a row — said plainly rather than left
          to look like missing data. */}
      {data.degraded.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-state-held/40 bg-state-held/5 px-4 py-2.5 text-xs text-brand-near-black dark:text-white">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-state-held" aria-hidden />
          {t('admin.finance.degraded', { domains: data.degraded.join(', ') })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {inbound ? (
          <>
            <Figure label={t('admin.finance.received')} value={formatUSDFull(totals.settled)} tone="complete" note={t('admin.finance.inflowsNote')}
              count={count(l => l.state === 'funded' || l.state === 'reconciled')} />
            {/* Never added to the figure above it: expected is money that has not arrived. */}
            <Figure label={t('admin.finance.awaited')} value={formatUSDFull(totals.pending)} tone="held" note={t('admin.finance.awaitedNote')}
              count={count(l => l.state === 'expected')} />
            <Figure label={t('admin.finance.movements')} value={String(totals.count)} tone="neutral" note={t('admin.finance.movementsNote')} />
          </>
        ) : (
          <>
            {/* Approved and Processing are separate because a decision is not a payment. */}
            <Figure label={t('admin.finance.state.authorised')} value={formatUSDFull(totals.approved)} tone="held" note={t('admin.finance.approvedDecision')}
              count={count(l => l.state === 'release_authorised')} />
            <Figure label={t('admin.finance.state.initiated')} value={formatUSDFull(totals.processing)} tone="held" note={t('admin.finance.processingNote')}
              count={count(l => l.state === 'initiated' || l.state === 'reconciling')} />
            <Figure label={t('admin.finance.paidOut')} value={formatUSDFull(totals.settled)} tone="complete" note={t('admin.finance.paidNote')}
              count={count(l => l.state === 'disbursed')} />
            <Figure label={t('admin.finance.state.failed')} value={formatUSDFull(totals.failed)} tone="alert" note={t('admin.finance.failedNote')}
              count={count(l => l.state === 'failed')} />
          </>
        )}
      </div>

      {!inbound && needsRef > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-state-held/40 bg-[#fbf8f2] px-4 py-3 text-sm dark:bg-[#231f17]">
          <p className="text-brand-near-black dark:text-white">
            <span className="font-semibold">{t('admin.finance.needsRef', { n: needsRef })}</span>
            <span className="text-brand-mid-grey"> · {t('admin.finance.needsRefNote')}</span>
          </p>
          <button type="button" onClick={() => { setChip('needs_ref'); setOpen(null); }} aria-pressed={chip === 'needs_ref'}
            className="font-semibold text-brand-green underline underline-offset-2 dark:text-state-complete">
            {t('admin.finance.showThem')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {inbound
            ? (['received', 'expected'] as const).map(k => (
              <Chip key={k} on={tab === k} onClick={() => { setTab(k); setOpen(null); }}
                label={t(`admin.finance.tab.${k}` as TKey)}
                count={count(k === 'received' ? (l => l.state === 'funded' || l.state === 'reconciled') : (l => l.state === 'expected'))} />
            ))
            : OUT_CHIPS.map(k => (
              <Chip key={k} on={chip === k} onClick={() => { setChip(k); setOpen(null); }}
                label={k === 'all' ? t('admin.finance.all') : t(STATE_KEY[k])}
                count={k === 'all' ? mine.length : count(l => l.state === k)} />
            ))}
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.finance.search')} aria-label={t('admin.finance.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-brand-border-grey bg-white py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {inTab.length === 0
            ? t(inbound ? (tab === 'expected' ? 'admin.finance.noExpected' : 'admin.finance.noInflow') : 'admin.finance.noOutflow')
            : t('admin.finance.noMatch')}
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="overflow-hidden rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white lg:dark:border-[#2c2c2c] lg:dark:bg-[#1e1e1e]">
            <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_7rem_9.5rem_9rem] gap-3 border-b border-brand-border-grey px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey lg:grid dark:border-[#2c2c2c]">
              <span>{t(inbound ? 'admin.finance.colHomeowner' : 'admin.finance.colContractor')}</span>
              <span>{t('admin.finance.colFor')}</span>
              <span className="text-right">{t('admin.finance.colAmount')}</span>
              <span>{t('admin.finance.colStatus')}</span>
              <span>{t('admin.finance.colWhen')}</span>
            </div>
            <ul className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-brand-border-grey lg:dark:divide-[#2c2c2c]">
              {shown.map(l => {
                const on = l.id === selectedId;
                return (
                  <li key={l.id} className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white lg:rounded-none lg:border-0 lg:bg-transparent dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                    <button
                      type="button" onClick={() => setOpen(on && !wide ? null : l.id)} aria-expanded={on}
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_7rem_9.5rem_9rem] lg:px-5',
                        on ? 'lg:bg-[#f3f6f4] lg:shadow-[inset_3px_0_0_var(--color-brand-green)] lg:dark:bg-[#1c2620]' : 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {inbound
                          ? <ArrowDownLeft className="size-3.5 shrink-0 text-state-complete lg:hidden" aria-hidden />
                          : <ArrowUpRight className="size-3.5 shrink-0 text-brand-mid-grey lg:hidden" aria-hidden />}
                        <span className="hidden lg:block"><Initials name={l.partyName} /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">{l.partyName ?? t('admin.finance.unknownParty')}</span>
                          {!inbound && (l.providerRef
                            ? <span className="block truncate font-mono text-xs text-brand-mid-grey">{l.providerRef}</span>
                            : awaitsReference(l) && <span className="block truncate text-xs font-semibold text-state-held">{t('admin.finance.noRef')}</span>)}
                          <span className="block truncate text-xs text-brand-mid-grey lg:hidden">
                            {l.projectName ?? t('admin.finance.unknownProject')} · {l.stage ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</> : purposeOf(l) ?? t('admin.finance.noPurpose')}
                          </span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 lg:block">
                        <span className="block truncate text-sm text-brand-near-black dark:text-white">{l.projectName ?? t('admin.finance.unknownProject')}</span>
                        <span className="block truncate text-xs text-brand-mid-grey">
                          {l.stage ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</> : purposeOf(l) ?? t('admin.finance.noPurpose')}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(l.amount)}</span>
                        {l.local && <span className="block text-[11px] tabular-nums text-brand-mid-grey">{l.local}</span>}
                        <span className={cn('block text-xs lg:hidden', TONE[l.state] ?? 'text-brand-mid-grey')}>{t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}</span>
                      </span>
                      <span className="hidden lg:block">
                        <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', PILL[l.state] ?? 'bg-brand-light-grey text-brand-mid-grey')}>
                          {t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}
                        </span>
                      </span>
                      {/* WHEN — labelled with what the date actually means. */}
                      <span className="col-span-2 text-[11px] text-brand-mid-grey lg:col-span-1 lg:text-xs">
                        {t(`admin.finance.at.${l.atMeans}` as TKey, { date: formatDate(l.at) })}
                      </span>
                    </button>
                    {on && !wide && <div className="border-t border-brand-border-grey px-4 py-4 dark:border-[#2c2c2c]">{detail(l)}</div>}
                  </li>
                );
              })}
            </ul>
            <p className="hidden border-t border-brand-border-grey px-5 py-3 text-xs text-brand-mid-grey lg:block dark:border-[#2c2c2c]">
              {t('admin.finance.rowCount', { n: shown.length })}
            </p>
          </div>

          {wide && selected && (
            <aside className="sticky top-4 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              {detail(selected)}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ on, label, count, onClick }: { on: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
        on
          ? 'border-brand-green bg-brand-green text-white'
          : 'border-brand-border-grey bg-white text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white')}>
      {label}<span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Initials({ name }: { name: string | null }) {
  const letters = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  return <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-light-grey text-[11px] font-semibold text-brand-mid-grey">{letters}</span>;
}

function Figure({ label, value, tone, note, count }: { label: string; value: string; tone: 'complete' | 'held' | 'alert' | 'neutral'; note?: string; count?: number }) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="flex items-center justify-between gap-2 text-xs font-medium text-brand-mid-grey">
        <span className="flex items-center gap-1.5">
          {tone !== 'neutral' && <span aria-hidden className={cn('size-2 rounded-full',
            tone === 'complete' ? 'bg-state-complete' : tone === 'alert' ? 'bg-state-alert' : 'bg-state-held')} />}
          {label}
        </span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </p>
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums tracking-tight',
        tone === 'complete' ? 'text-state-complete'
        : tone === 'alert' ? 'text-state-alert'
        : tone === 'held' ? 'text-state-held'
        : 'text-brand-near-black dark:text-white')}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-brand-mid-grey">{note}</p>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-brand-border-grey py-2 dark:border-[#2c2c2c]">
      <dt className="shrink-0 text-brand-mid-grey">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right', tone ?? 'text-brand-near-black dark:text-white')}>{value}</dd>
    </div>
  );
}
