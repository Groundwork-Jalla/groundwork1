import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { loadFinanceLedger, type LedgerData } from '@/lib/supabase/finance-ledger';
import { totalsFor, purposeOf, needsAttention, type LedgerLine } from '@/lib/admin/finance-ledger';
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
  const recent = useMemo(() => lines.slice(0, 12), [lines]);

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

  return (
    <div className="space-y-5 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('admin.finance.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.finance.subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={t('admin.finance.confirmedInflows')} value={formatUSDFull(inflow.settled)} tone="complete" to="/admin/finance/inflows" />
        {/* A decision, not a payment — its own card for exactly that reason. */}
        <Card label={t('admin.finance.approvedForRelease')} value={formatUSDFull(outflow.approved + outflow.processing)} tone="held" to="/admin/finance/disbursements" />
        <Card label={t('admin.finance.disbursed')} value={formatUSDFull(outflow.settled)} tone="complete" to="/admin/finance/disbursements" />
        {/* Confirmed in, minus everything out that has not failed. The same helper the
            project ledger uses, so the two surfaces cannot disagree. */}
        <Card label={t('admin.finance.availableFunding')}
              value={available === null ? t('admin.finance.notAvailable') : formatUSDFull(available)}
              note={t('admin.finance.availableNote')} tone="neutral" />
      </div>

      {attention.length > 0 && (
        <Link to="/admin/finance/disbursements"
          className="flex items-start gap-2 rounded-xl border border-state-alert/40 bg-state-alert/5 px-4 py-3 text-sm text-brand-near-black transition-colors hover:border-state-alert dark:text-white">
          <AlertTriangle className="mt-px size-4 shrink-0 text-state-alert" aria-hidden />
          {t('admin.finance.needsAttention', { n: attention.length })}
        </Link>
      )}

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">{t('admin.finance.recentTitle')}</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-brand-mid-grey">{t('admin.finance.noMovement')}</p>
        ) : (
          <ul className="mt-3 space-y-2 lg:space-y-0 lg:divide-y lg:divide-brand-border-grey lg:rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white lg:dark:border-[#2c2c2c] lg:dark:bg-[#1e1e1e]">
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
  return (
    <li className="rounded-2xl border border-brand-border-grey bg-white lg:rounded-none lg:border-0 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <Link to={workspaceHref(l.projectId, { tab: 'financials' })}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-brand-off-white lg:px-5 dark:hover:bg-[#252525]">
        {inbound
          ? <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-state-complete" aria-hidden />
          : <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">
            {t(inbound ? 'admin.finance.typeInflow' : 'admin.finance.typeDisbursement')}
            {' · '}
            {/* Never a raw id: an account we cannot read says so. */}
            {l.partyName ?? t('admin.finance.unknownParty')}
          </span>
          <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">
            {l.projectName ?? t('admin.finance.unknownProject')}
            {' · '}
            {l.stage
              ? <>{t('admin.finance.stageN', { n: l.stage.number })} {l.stage.name}</>
              : purposeOf(l) ?? t('admin.finance.noPurpose')}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(l.amount)}</span>
          <span className={cn('block text-xs', TONE[l.state] ?? 'text-brand-mid-grey')}>{t(STATE_KEY[l.state] ?? 'admin.finance.state.expected')}</span>
          <span className="block text-[11px] text-brand-mid-grey">{formatDate(l.at)}</span>
        </span>
      </Link>
    </li>
  );
}

function Card({ label, value, note, tone, to }: {
  label: string; value: string; note?: string; tone: 'complete' | 'held' | 'neutral'; to?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium text-brand-mid-grey">{label}</p>
      <p className={cn('mt-1 text-2xl font-black tabular-nums',
        tone === 'complete' ? 'text-state-complete' : tone === 'held' ? 'text-state-held' : 'text-brand-near-black dark:text-white')}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] text-brand-mid-grey">{note}</p>}
    </>
  );
  const cls = 'block rounded-2xl border border-brand-border-grey bg-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return to
    ? <Link to={to} className={cn(cls, 'transition-colors hover:border-brand-near-black dark:hover:border-white/40')}>{body}</Link>
    : <div className={cls}>{body}</div>;
}
