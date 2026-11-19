import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Banknote } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { listPaymentEvents, type Payment, type PaymentEvent } from '@/lib/supabase/payments';
import { LedgerModal, type Contractor, type LedgerModalState, type StageRef } from '@/components/admin/ledger/LedgerModal';
import BudgetView from '@/components/project/BudgetView';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { MoneyFlow } from './MoneyFlow';
import { RepriceCard } from './RepriceCard';
import { StagePricingPanel } from '@/components/project/StagePricingPanel';
import { DomainNote } from './DomainNote';
import { useStageLabels } from '@/lib/stage-labels';
import { formatUSDFull } from '@/lib/budget';
import { projectMoneyBasis, projectMoneyPair } from '@/lib/budget/project-money';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Financials tab (05 §10), in the order that reads correctly before the provider exists:
//
//   summary · Funding (client → provider) · Milestone releases (provider → contractor)
//   · Disbursements (the releases as money movement) · Compensation (header + honest
//   empty: not modelled, its own design gate) · Reconciliation (provider events against
//   our rows) · Budget (fees read-only, costing as-is)
//
// CUSTODY RULE (13 Sep, binding): Groundwork records and governs; the provider holds and
// moves the money. Nothing here is a wallet, an escrow or a balance held by Groundwork.
//
// Every figure is `ws.financials` — the loader's sums over `listProjectPayments` — and
// every act is one of the three ledger RPCs through the extracted `LedgerModal`. The
// database recomputes eligibility under a lock and refuses with a reason; the modal
// translates it. This tab never decides eligibility: "Authorise release" is offered on
// every complete stage with no live release and the answer is the database's.
//
// `payment_status` APPEARS ONLY HERE, labelled the legacy projection it is (090: written
// by the ledger's trigger for older screens). It feeds nothing.
// =========================================================

/** The Funding list shows this many, then "Show all". */
const FUNDING_ROWS = 9;

export function FinancialsTab({ loaded, onChanged }: { loaded: LoadedWorkspace; onChanged: () => void }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const fin = ws.financials;
  const ledgerState = domainStateOf(ws, loaded.errors, 'ledger', fin.payments.length);
  const [modal, setModal] = useState<LedgerModalState>(null);
  const [allFunding, setAllFunding] = useState(false);
  // The amount in the project's own currency at its recorded rate (Favour, 18 Nov: USD
  // and XAF). The ledger stays in dollars; this is the line beside it.
  const local = (usd: number) => { const pair = projectMoneyPair(ws.project, usd); return pair && pair.usd ? pair.local : null; };

  if (ledgerState === 'unavailable' || ledgerState === 'error') {
    return (
      <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
        <DomainNote state={ledgerState} reason={loaded.errors.ledger} />
        <BudgetSection ws={ws} onChanged={onChanged} />
      </div>
    );
  }

  const nameOf = (id: string | null) => {
    if (!id) return '';
    if (ws.team.owner?.id === id) return ws.team.owner.name || ws.team.owner.email;
    const c = ws.team.contractors.find(x => x.contractor_user_id === id);
    if (c) return c.name;
    const v = ws.team.verifiers.find(x => x.userId === id);
    if (v) return v.name || v.email;
    const a = ws.activity.find(x => x.actorId === id && x.actorName);
    return a?.actorName ?? t('admin.workspace.header.unknownAccount');
  };
  const stageRef = (stageId: string | null): StageRef | null => {
    const v = stageId ? ws.stages.find(s => s.stage.id === stageId) : null;
    return v ? { id: v.stage.id, projectId: ws.project.id, stageNumber: v.stage.stage_number, name: stageLabel(v.stage), status: v.stage.status, milestone: v.stage.payment_milestone_usd } : null;
  };
  // The beneficiary list the modal offers: accepted contractors with an account (05 §7).
  const contractors: Contractor[] = ws.team.contractors
    .filter(c => c.status === 'accepted' && c.contractor_user_id)
    .map(c => ({ userId: c.contractor_user_id as string, email: c.email }));
  const stateLabel = (state: Payment['state']) => t(`admin.ledger.state.${state}` as TKey);

  const inRows  = fin.payments.filter(p => p.direction === 'in');
  const outRows = fin.payments.filter(p => p.direction === 'out');
  const shownIn = allFunding ? inRows : inRows.slice(0, FUNDING_ROWS);
  const receivedCount = inRows.filter(p => p.state === 'funded' || p.state === 'reconciled').length;

  // Where the money stands, as one bar of the budget. Every segment is a loader figure;
  // the bar only appears when there is a budget to measure against.
  const budget = ws.project.budget_usd == null ? 0 : fin.budgetUsd;
  const paid = fin.disbursed + fin.inFlight;
  const notFunded = Math.max(0, budget - fin.funded);
  const segments = [
    { key: 'paid',      label: t('admin.workspace.financialsView.paid'),   value: paid,               colour: 'bg-brand-green dark:bg-state-complete' },
    { key: 'authorised', label: t('admin.workspace.overview.authorised'),  value: fin.authorised,     colour: 'bg-[#2f6b4c]' },
    { key: 'available', label: t('admin.workspace.overview.available'),    value: fin.availableFunds, colour: 'bg-[#8fb39c]' },
    { key: 'notFunded', label: t('admin.workspace.financialsView.notFunded'), value: notFunded,       colour: 'bg-brand-light-grey' },
  ].filter(x => x.value > 0);
  const basis = projectMoneyBasis(ws.project);

  // The stage's lifecycle cell and its one act, for the per-stage table.
  const lifecycleOf = (stageId: string) => {
    const v = ws.stages.find(x => x.stage.id === stageId);
    if (!v) return null;
    return (
      <>
        <StageLifecycleBadge lifecycle={v.lifecycle} size="small" />
        {/* LEGACY PROJECTION: shown, labelled, never read by anything on this page. */}
        <span className="mt-1 block text-[11px] text-brand-muted-grey" title={t('admin.workspace.financials.legacyHint')}>
          {t('admin.workspace.financials.legacy')}: {t(`admin.workspace.financials.projection.${v.stage.payment_status}` as TKey)}
        </span>
      </>
    );
  };
  const actionOf = (stageId: string) => {
    const v = ws.stages.find(x => x.stage.id === stageId);
    if (!v) return null;
    const milestone = v.stage.payment_milestone_usd;
    const liveRelease = v.release && v.release.state !== 'failed';
    // Offered on every complete stage with no live release; the database answers.
    const offer = v.stage.status === 'complete' && !liveRelease && (milestone ?? 0) > 0;
    if (!offer) return <span className="text-brand-muted-grey">—</span>;
    return (
      <>
        <button type="button"
          disabled={contractors.length === 0}
          title={contractors.length === 0 ? t('admin.ledger.noContractor') : undefined}
          onClick={() => { const s = stageRef(v.stage.id); if (s) setModal({ kind: 'authorise', stage: s }); }}
          className="whitespace-nowrap rounded-xl bg-brand-green px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-green-hover disabled:opacity-40 dark:bg-state-complete">
          {t('admin.ledger.authorise')}
        </button>
        {contractors.length === 0 && (
          <p className="mt-1 text-[10px] text-brand-mid-grey">{t('admin.ledger.noContractor')}</p>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 2xl:p-8">
      {/* ── Where the money stands: one bar of the budget, then the six figures ───── */}
      <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-brand-near-black dark:text-white">{t('admin.workspace.financialsView.standsTitle')}</h2>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.workspace.overview.financialSub')}</p>
          </div>
          {basis.code !== 'USD' && (
            <p className="text-[11px] text-brand-mid-grey">
              {t(basis.locked ? 'admin.workspace.financialsView.rateLocked' : 'admin.workspace.financialsView.rateApprox',
                { code: basis.code, rate: `${basis.rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${basis.code}` })}
            </p>
          )}
        </header>
        {budget > 0 && (
          <div className="px-5 pt-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-brand-light-grey" aria-hidden>
              {segments.map(seg => <span key={seg.key} className={cn('block h-full', seg.colour)} style={{ width: `${Math.min(100, (seg.value / budget) * 100)}%` }} />)}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-mid-grey">
              {segments.map(seg => (
                <span key={seg.key} className="inline-flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-sm', seg.colour)} />{seg.label} <span className="tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(seg.value)}</span>
                </span>
              ))}
            </p>
          </div>
        )}
        <dl className="mt-4 grid grid-cols-2 border-t border-brand-border-grey sm:grid-cols-3 xl:grid-cols-6 dark:border-[#2c2c2c]">
          <Figure label={t('admin.workspace.overview.budget')}     value={ws.project.budget_usd == null ? null : fin.budgetUsd} local={local} />
          <Figure label={t('admin.workspace.overview.funded')}     value={fin.funded} local={local} />
          <Figure label={t('admin.workspace.overview.available')}  value={fin.availableFunds} emphasis local={local} />
          <Figure label={t('admin.workspace.overview.authorised')} value={fin.authorised} local={local} />
          <Figure label={t('admin.workspace.overview.inFlight')}   value={fin.inFlight} local={local} />
          <Figure label={t('admin.workspace.overview.disbursed')}  value={fin.disbursed} local={local} />
        </dl>
      </section>

      {/* ── Where each stage's money is: the journey, the lifecycle and the one act ─── */}
      {/* Organised by journey, which is how "where is stage 3's money?" is actually asked;
          the release decision sits on the same row as the money it would move. */}
      <MoneyFlow
        projectId={ws.project.id}
        payments={fin.payments}
        stages={ws.stages.map(v => v.stage)}
        nameOf={nameOf}
        local={local}
        lifecycleOf={lifecycleOf}
        actionOf={actionOf}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* ── Funding: homeowner → provider ───────────────────────────────────────── */}
      <Section title={t('admin.ledger.funding')} sub={t('admin.workspace.financials.fundingSub')}
        aside={inRows.length > 0 ? t('admin.workspace.financialsView.tranches', { n: inRows.length, received: receivedCount }) : undefined}>
        {inRows.length === 0 ? (
          <Empty>{t('admin.workspace.financials.fundingEmpty')}</Empty>
        ) : (
          <>
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {shownIn.map(p => {
              const st = stageRef(p.stageId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span aria-hidden className={cn('size-2 shrink-0 rounded-full', p.state === 'expected' ? 'bg-state-held' : 'bg-state-complete')} />
                  <span className="w-24 shrink-0">
                    <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(p.amount)}</span>
                    {local(p.amount) && <span className="block text-[11px] tabular-nums text-brand-mid-grey">{local(p.amount)}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-near-black dark:text-white">
                      {st && <span>{t('admin.ledger.stage', { n: st.stageNumber })} · {st.name}</span>}
                      <span className="text-brand-mid-grey"> · {stateLabel(p.state)}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                      {p.fundingSource === 'staff_confirmed' && t('admin.ledger.source.staff_confirmed', { name: nameOf(p.confirmedBy), when: formatRelative(p.confirmedAt) })}
                      {p.fundingSource === 'provider' && t('admin.ledger.source.provider', { when: formatRelative(p.settledAt ?? p.updatedAt) })}
                      {!p.fundingSource && t('admin.workspace.financials.notReceived')}
                      {p.note && <> · {p.note}</>}
                    </p>
                  </div>
                  {p.state === 'expected' && (
                    <button type="button" onClick={() => setModal({ kind: 'confirm', payment: p })}
                      className="shrink-0 rounded-xl border border-brand-near-black px-3 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:bg-brand-near-black hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-brand-near-black">
                      {t('admin.ledger.confirmFunding')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {inRows.length > FUNDING_ROWS && !allFunding && (
            <button type="button" onClick={() => setAllFunding(true)}
              className="w-full border-t border-brand-border-grey py-2.5 text-xs font-semibold text-brand-near-black underline underline-offset-2 dark:border-[#2c2c2c] dark:text-white">
              {t('admin.workspace.financialsView.showAll', { n: inRows.length })}
            </button>
          )}
          </>
        )}
      </Section>

      {/* ── Disbursements: the releases as money movement ────────────────────── */}
      <Section title={t('admin.workspace.financials.disbursements')} sub={t('admin.workspace.financials.disbursementsSub')}
        aside={outRows.length > 0 ? String(outRows.length) : undefined}>
        {outRows.length === 0 ? (
          <Empty>{t('admin.workspace.financials.disbursementsEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {outRows.map(p => {
              const st = stageRef(p.stageId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Banknote className="size-4 shrink-0 text-brand-mid-grey" />
                  <span className="w-24 shrink-0">
                    <span className="block text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(p.amount)}</span>
                    {local(p.amount) && <span className="block text-[11px] tabular-nums text-brand-mid-grey">{local(p.amount)}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-near-black dark:text-white">
                      <span className={cn(p.state === 'failed' ? 'text-state-alert' : p.state === 'disbursed' ? 'text-state-complete' : 'text-brand-near-black dark:text-white')}>{stateLabel(p.state)}</span>
                      {st && <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: st.stageNumber })}</span>}
                      <span className="text-brand-mid-grey"> · {t('admin.ledger.to', { name: nameOf(p.beneficiaryId) })}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                      {t('admin.ledger.releasedBy', { name: nameOf(p.authorisedBy), when: formatRelative(p.authorisedAt) })}
                      {p.provider && p.providerRef && <> · {p.provider} {p.providerRef}</>}
                      {p.failureReason && <span className="text-state-alert"> · {p.failureReason}</span>}
                      {p.note && <> · {p.note}</>}
                    </p>
                  </div>
                  {p.state === 'failed' && (
                    <button type="button" onClick={() => setModal({ kind: 'reconcile', payment: p })}
                      className="shrink-0 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white">
                      {t('admin.ledger.openReconciliation')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      </div>

      {/* ── Fees · Compensation · Reconciliation, side by side ───────────────────── */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <BudgetSection ws={ws} onChanged={onChanged} part="fees" />

        {/* Compensation: header + honest empty. Not modelled; its own design gate. */}
        <Section title={t('admin.workspace.financials.compensation')} sub={t('admin.workspace.financials.compensationSub')}>
          <Empty>{t('admin.workspace.financials.compensationEmpty')}</Empty>
        </Section>

        {/* Reconciliation: what the provider said, against our rows */}
        <Section title={t('admin.workspace.financials.reconciliation')} sub={t('admin.workspace.financials.reconciliationSub')}>
          <ReconciliationList payments={fin.payments} stageRef={stageRef} />
        </Section>
      </div>

      {/* ── Costing, as-is ──────────────────────────────────────────────────────── */}
      <BudgetSection ws={ws} onChanged={onChanged} part="costing" />

      <AnimatePresence>
        {modal && (
          <LedgerModal
            modal={modal}
            projectName={ws.project.name}
            stage={modal.kind === 'authorise' ? modal.stage : stageRef(modal.payment.stageId)}
            contractors={modal.kind === 'authorise' ? contractors : []}
            onClose={() => setModal(null)}
            onDone={() => { setModal(null); onChanged(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Provider events for this project's rows, read on demand; the loader does not carry them. */
function ReconciliationList({ payments, stageRef }: { payments: Payment[]; stageRef: (id: string | null) => StageRef | null }) {
  const t = useT();
  const [events, setEvents] = useState<{ rows: PaymentEvent[]; available: boolean } | null | undefined>(undefined);
  const ids = payments.map(p => p.id).join(',');
  useEffect(() => {
    let alive = true;
    setEvents(undefined);
    listPaymentEvents(ids ? ids.split(',') : [])
      .then(r => { if (alive) setEvents(r); })
      .catch(() => { if (alive) setEvents(null); });
    return () => { alive = false; };
  }, [ids]);

  if (events === undefined) return <Empty>{t('common.loading')}</Empty>;
  if (events === null) return <DomainNote state="error" reason={t('admin.workspace.financials.eventsFailed')} />;
  if (!events.available) return <DomainNote state="unavailable" />;
  if (events.rows.length === 0) return <Empty>{t('admin.workspace.financials.reconciliationEmpty')}</Empty>;

  const byId = new Map(payments.map(p => [p.id, p]));
  return (
    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {events.rows.map(e => {
        const p = e.paymentId ? byId.get(e.paymentId) : undefined;
        const st = p ? stageRef(p.stageId) : null;
        const outcomeKey = e.outcome ? (`admin.workspace.financials.outcome.${e.outcome}` as TKey) : null;
        return (
          <li key={e.id} className="px-5 py-3">
            <p className="text-sm text-brand-near-black dark:text-white">
              <span className="font-medium">{e.provider}</span> · {e.eventType}
              {p && <span className="text-brand-mid-grey"> · {formatUSDFull(p.amount)}{st && ` · ${t('admin.ledger.stage', { n: st.stageNumber })}`}</span>}
            </p>
            <p className="mt-0.5 text-[11px] text-brand-mid-grey">
              <span title={formatDateTime(e.receivedAt)}>{formatRelative(e.receivedAt)}</span> · {e.providerEventId}
              {' · '}
              {outcomeKey
                ? <span className="text-state-alert">{t(outcomeKey) === outcomeKey ? e.outcome : t(outcomeKey)}</span>
                : <span className="text-state-complete">{t('admin.workspace.financials.outcome.applied')}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function BudgetSection({ ws, onChanged, part = 'all' }: { ws: LoadedWorkspace['workspace']; onChanged: () => void; part?: 'all' | 'fees' | 'costing' }) {
  const t = useT();
  const fees = ws.financials.fees;
  return (
    <>
      {part !== 'costing' && (
      <Section title={t('admin.workspace.financials.fees')} sub={t('admin.workspace.financials.feesSub')}>
        {fees.length === 0 ? (
          <Empty>{t('admin.workspace.financials.feesEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {fees.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="text-brand-near-black dark:text-white">{t(`admin.workspace.financials.feeKind.${f.kind}` as TKey)}</span>
                <span className="text-brand-mid-grey">
                  <span className="font-semibold tabular-nums text-brand-near-black dark:text-white">{formatUSDFull(Number(f.amount_usd))}</span>
                  {' · '}{t(`admin.workspace.financials.projection.${f.payment_status}` as TKey)}
                  {f.paid_at && ` · ${formatRelative(f.paid_at)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      )}
      {part !== 'fees' && (
      <Section title={t('admin.workspace.financials.costing')} sub={t('admin.workspace.financials.costingSub')}>
        {/* Above the costing it changes, and separated from it, because this is a write
            and everything below is a read. */}
        <div className="border-b border-brand-border-grey dark:border-[#2c2c2c]">
          <StagePricingPanel project={ws.project} onChanged={onChanged} />
          {!(ws.project.pricing_revision ?? 0) && <RepriceCard projectId={ws.project.id} onChanged={onChanged} />}
        </div>
        <div className="px-5 py-4">
          {/* Costing only. BudgetView's Released/Held/Remaining are stage-status buckets — the
              client's estimate — and the ledger above is the record; one "released" per screen. */}
          <BudgetView project={ws.project} stages={ws.stages.map(s => s.stage)} showMilestoneBuckets={false} />
        </div>
      </Section>
      )}
    </>
  );
}

function Section({ title, sub, aside, children }: { title: string; sub?: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <h2 className="flex items-baseline justify-between gap-2 text-[15px] font-bold text-brand-near-black dark:text-white">
          {title}{aside && <span className="text-xs font-normal text-brand-mid-grey">{aside}</span>}
        </h2>
        {sub && <p className="mt-0.5 text-xs text-brand-mid-grey">{sub}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{children}</p>;
}

/** `null` is "not recorded" and renders as a dash — a real $0 is a number and renders as one. */
function Figure({ label, value, emphasis, local }: { label: string; value: number | null; emphasis?: boolean; local?: (usd: number) => string | null }) {
  return (
    <div className={cn('border-b border-r border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]',
      emphasis && 'm-1 rounded-xl border-[1.5px] border-brand-green bg-[#f3f6f4] dark:border-state-complete dark:bg-[#1c2620]')}>
      <dt className="text-xs text-brand-mid-grey">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-lg font-bold tabular-nums', value === null ? 'text-brand-muted-grey' : emphasis ? 'text-brand-green dark:text-state-complete' : 'text-brand-near-black dark:text-white')}>
        {value === null ? '—' : formatUSDFull(value)}
      </dd>
      {value !== null && value > 0 && local?.(value) && <dd className="truncate text-[11px] tabular-nums text-brand-mid-grey">{local(value)}</dd>}
    </div>
  );
}
