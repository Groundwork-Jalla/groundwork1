import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronRight, CheckCircle2, Clock, AlertTriangle, Circle } from 'lucide-react';
import { listProjectPayments, type Payment } from '@/lib/supabase/payments';
import { fetchProjectFees } from '@/lib/supabase/projects';
import { notifyAdmins } from '@/lib/supabase/notifications';
import {
  totals, fundingRow, releaseRows, fundingLabel, releaseLabel, nextPayment, activity,
  type FundingLabel, type ReleaseLabel,
} from '@/lib/payments/client-view';
import type { ProjectRow, ProjectStageRow, ProjectFeeRow } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { formatUSD } from '@/lib/budget';
import { formatDate } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The project owner's Payments tab, read from the ledger (090).
//
// ── What this replaces ───────────────────────────────────────────────────────────────
// `EscrowWallet` showed `budget_usd − milestones marked paid` under the heading "escrow
// balance": a subtraction presented as money Groundwork holds. Groundwork records and
// governs; it does not hold funds. Every figure here is a sum of real ledger rows, and
// the word escrow does not appear.
//
// ── Approved is not paid, and the screen has to make that obvious ───────────────────
// An authorised release is a decision. Until the provider reports movement the money has
// not moved, so it has its own card, its own colour, and its own words — and it is
// subtracted from what is available, or the same money reads as spendable twice.
//
// ── Nothing here writes ──────────────────────────────────────────────────────────────
// 090 has SELECT policies and no others: the ledger changes only through its RPCs, and
// none of them are reachable from a client. "I've made this payment" tells staff, exactly
// as it did before; an admin confirms receipt and the ledger follows.
// =========================================================

const FUNDING_KEY: Record<FundingLabel, TKey> = {
  awaiting:     'project.pay.fundingAwaiting',
  confirmed:    'project.pay.fundingConfirmed',
  notScheduled: 'project.pay.notScheduled',
};
const RELEASE_KEY: Record<ReleaseLabel, TKey> = {
  none:       'project.pay.releaseNone',
  approved:   'project.pay.releaseApproved',
  processing: 'project.pay.releaseProcessing',
  paid:       'project.pay.releasePaid',
  issue:      'project.pay.releaseIssue',
  review:     'project.pay.releaseReview',
};
/** Colour supplements the words; it never replaces them. */
const TONE: Record<FundingLabel | ReleaseLabel, string> = {
  confirmed:    'text-state-complete',
  paid:         'text-state-complete',
  awaiting:     'text-state-held',
  approved:     'text-state-held',
  processing:   'text-state-held',
  review:       'text-state-held',
  issue:        'text-state-alert',
  none:         'text-brand-mid-grey',
  notScheduled: 'text-brand-mid-grey',
};

export default function ProjectPaymentsLedger({ project, stages }: {
  project: ProjectRow;
  stages: ProjectStageRow[];
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();

  const [rows, setRows] = useState<Payment[] | null | undefined>(undefined);
  const [fees, setFees] = useState<ProjectFeeRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    const r = await listProjectPayments(project.id).catch(() => ({ rows: [], available: false }));
    // `available: false` means the ledger could not be read. It is not an empty ledger,
    // and it must not become a column of zeroes.
    setRows(r.available ? r.rows : null);
    setFees(await fetchProjectFees(project.id).catch(() => []));
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const ordered = useMemo(() => [...stages].sort((a, b) => a.stage_number - b.stage_number), [stages]);
  const sums = useMemo(() => totals(rows ?? null), [rows]);
  const next = useMemo(() => (rows ? nextPayment(rows, ordered) : null), [rows, ordered]);
  const feed = useMemo(() => (rows ? activity(rows) : []), [rows]);
  const stageName = useCallback(
    (id: string | null) => {
      const s = id ? ordered.find(x => x.id === id) : null;
      return s ? stageLabel(s) : t('project.pay.noStage');
    }, [ordered, stageLabel, t],
  );

  async function report() {
    if (!next || next.kind !== 'due') return;
    setReporting(true);
    try {
      // Tells Groundwork. Touches no financial state — staff confirm receipt, and only
      // `confirm_funding()` moves the row to funded.
      await notifyAdmins(
        'funding_reported',
        'Client reports a payment',
        `${project.name}: the client reports paying stage ${next.stage.stage_number}`,
        { project_id: project.id, stage_id: next.stage.id, amount_usd: next.amount },
      );
      setReported(true);
    } finally {
      setReporting(false);
    }
  }

  if (rows === undefined) {
    return <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</p>;
  }
  if (rows === null || !sums) {
    return (
      <p className="rounded-2xl border border-brand-border-grey bg-brand-off-white px-5 py-6 text-sm text-brand-mid-grey">
        {t('project.pay.unavailable')}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-bold text-brand-near-black">{t('project.pay.title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('project.pay.subtitle')}</p>
      </header>

      {/* ── The four figures ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={t('project.pay.cardFunding')}   value={formatUSD(sums.funded)}    note={t('project.pay.cardFundingNote')} tone="complete" />
        <Card label={t('project.pay.cardPaid')}      value={formatUSD(sums.disbursed)} note={t('project.pay.cardPaidNote')}    tone="complete" />
        <Card label={t('project.pay.cardApproved')}  value={formatUSD(sums.approved)}  note={t('project.pay.cardApprovedNote')} tone="held" />
        <Card label={t('project.pay.cardAvailable')} value={formatUSD(sums.available)} note={t('project.pay.cardAvailableNote')} tone="neutral" />
      </div>

      {/* ── What to pay next ────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-brand-border-grey bg-white p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">{t('project.pay.nextTitle')}</h3>
        {next === null || next.kind === 'noMilestones' ? (
          <p className="mt-2 text-sm text-brand-mid-grey">{t('project.pay.noMilestones')}</p>
        ) : next.kind === 'allFunded' ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-state-complete">
            <CheckCircle2 className="size-4 shrink-0" />{t('project.pay.allFunded')}
          </p>
        ) : (
          <>
            <p className="mt-2 text-lg font-bold text-brand-near-black">
              {t('project.pay.stageN', { n: next.stage.stage_number })} · {stageName(next.stage.id)}
            </p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 border-t border-brand-border-grey/60 pt-3">
              <span className="text-sm text-brand-mid-grey">{t('project.pay.amountRequired')}</span>
              <span className="text-2xl font-black tabular-nums text-brand-near-black">{formatUSD(next.amount)}</span>
            </div>
            <p className={cn('mt-1 text-sm font-semibold', TONE.awaiting)}>{t('project.pay.fundingAwaiting')}</p>
            <p className="mt-2 text-xs leading-relaxed text-brand-mid-grey">{t('project.pay.nextExplain', { amount: formatUSD(next.amount) })}</p>
            {reported ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-state-complete">
                <CheckCircle2 className="size-4 shrink-0" />{t('project.pay.reportedThanks')}
              </p>
            ) : (
              <button
                type="button" onClick={report} disabled={reporting}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reporting && <Loader2 className="size-4 animate-spin" />}
                {t('project.pay.reportAction')}
              </button>
            )}
          </>
        )}
      </section>

      {/* ── The schedule ────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">{t('project.pay.scheduleTitle')}</h3>
        <ul className="mt-3 space-y-2 lg:space-y-0 lg:divide-y lg:divide-brand-border-grey lg:rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white">
          {ordered.map(s => {
            const fr = fundingRow(rows, s.id);
            const rr = releaseRows(rows, s.id);
            const f = fundingLabel(fr, s);
            const r = releaseLabel(rr);
            const expanded = open === s.id;
            return (
              <li key={s.id} className="rounded-2xl border border-brand-border-grey bg-white lg:rounded-none lg:border-0">
                <button
                  type="button" onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-off-white lg:px-5"
                >
                  <ChevronRight className={cn('size-3.5 shrink-0 text-brand-mid-grey transition-transform', expanded && 'rotate-90')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-brand-near-black">{stageLabel(s)}</span>
                    {/* Mobile: the two statuses stack under the name instead of being
                        squeezed into columns that do not fit. */}
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs lg:hidden">
                      <span className={TONE[f]}>{t(FUNDING_KEY[f])}</span>
                      <span className={TONE[r]}>{t(RELEASE_KEY[r])}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-near-black">
                    {(s.payment_milestone_usd ?? 0) > 0 ? formatUSD(s.payment_milestone_usd!) : '—'}
                  </span>
                  <span className={cn('hidden w-40 shrink-0 text-xs lg:block', TONE[f])}>{t(FUNDING_KEY[f])}</span>
                  <span className={cn('hidden w-40 shrink-0 text-xs lg:block', TONE[r])}>{t(RELEASE_KEY[r])}</span>
                </button>

                {expanded && (
                  <dl className="border-t border-brand-border-grey/60 px-4 py-3 text-xs lg:px-5">
                    {/* Only fields the rows actually carry. A missing timestamp is left
                        out rather than filled in. */}
                    <Fact label={t('project.pay.detailFunding')} value={t(FUNDING_KEY[f])} tone={TONE[f]} />
                    {fr?.confirmedAt && <Fact label={t('project.pay.detailFundedOn')} value={formatDate(fr.confirmedAt)} />}
                    {rr.length === 0 ? (
                      <Fact label={t('project.pay.detailRelease')} value={t('project.pay.releaseNone')} tone={TONE.none} />
                    ) : rr.map(row => (
                      <div key={row.id}>
                        <Fact label={t('project.pay.detailRelease')} value={`${formatUSD(row.amount)} · ${t(RELEASE_KEY[releaseLabel([row])])}`} tone={TONE[releaseLabel([row])]} />
                        {row.authorisedAt && <Fact label={t('project.pay.detailApprovedOn')} value={formatDate(row.authorisedAt)} />}
                        {row.settledAt && <Fact label={t('project.pay.detailPaidOn')} value={formatDate(row.settledAt)} />}
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── What has happened ───────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">{t('project.pay.activityTitle')}</h3>
        {feed.length === 0 ? (
          <p className="mt-3 text-sm text-brand-mid-grey">{t('project.pay.activityEmpty')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {feed.map(item => (
              <li key={item.key} className="flex gap-3">
                <span className="mt-1 shrink-0">
                  {item.kind === 'issue' ? <AlertTriangle className="size-3.5 text-state-alert" />
                    : item.kind === 'paid' || item.kind === 'funded' ? <CheckCircle2 className="size-3.5 text-state-complete" />
                    : <Clock className="size-3.5 text-state-held" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-brand-near-black">{t(`project.pay.event.${item.kind}` as TKey)}</span>
                  <span className="block text-xs text-brand-mid-grey">
                    {stageName(item.stageId)} · {formatUSD(item.amount)}
                    {item.at && <> · {formatDate(item.at)}</>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Fees: a separate financial domain, never summed into the above ── */}
      {fees.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">{t('project.pay.feesTitle')}</h3>
          <dl className="mt-3 divide-y divide-brand-border-grey rounded-2xl border border-brand-border-grey bg-white text-sm">
            {fees.map(f => (
              <div key={f.id} className="flex items-baseline justify-between gap-4 px-5 py-3">
                <dt className="text-brand-mid-grey">{t(`project.pay.fee.${f.kind}` as TKey)}</dt>
                <dd className="font-semibold tabular-nums text-brand-near-black">{formatUSD(f.amount_usd)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-brand-mid-grey">{t('project.pay.feesNote')}</p>
        </section>
      )}
    </div>
  );
}

function Card({ label, value, note, tone }: {
  label: string; value: string; note: string; tone: 'complete' | 'held' | 'neutral';
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-4">
      <p className="text-[11px] font-medium text-brand-mid-grey">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-brand-near-black">{value}</p>
      <p className={cn('mt-0.5 text-[11px]',
        tone === 'complete' ? 'text-state-complete' : tone === 'held' ? 'text-state-held' : 'text-brand-mid-grey')}>
        {note}
      </p>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-brand-mid-grey">{label}</dt>
      <dd className={cn('text-right font-medium', tone ?? 'text-brand-near-black')}>{value}</dd>
    </div>
  );
}
