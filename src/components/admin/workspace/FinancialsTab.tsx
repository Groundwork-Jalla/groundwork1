import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { Banknote } from 'lucide-react';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { listPaymentEvents, type Payment, type PaymentEvent } from '@/lib/supabase/payments';
import { LedgerModal, type Contractor, type LedgerModalState, type StageRef } from '@/components/admin/ledger/LedgerModal';
import BudgetView from '@/components/project/BudgetView';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { StageLifecycleBadge } from './StageLifecycleBadge';
import { DomainNote } from './DomainNote';
import { useStageLabels } from '@/lib/stage-labels';
import { formatUSDFull } from '@/lib/budget';
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

export function FinancialsTab({ loaded, onChanged }: { loaded: LoadedWorkspace; onChanged: () => void }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const fin = ws.financials;
  const ledgerState = domainStateOf(ws, loaded.errors, 'ledger', fin.payments.length);
  const [modal, setModal] = useState<LedgerModalState>(null);

  if (ledgerState === 'unavailable' || ledgerState === 'error') {
    return (
      <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
        <DomainNote state={ledgerState} reason={loaded.errors.ledger} />
        <BudgetSection ws={ws} />
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

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
      {/* ── Summary ─────────────────────────────────────────────────────────────── */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Figure label={t('admin.workspace.overview.budget')}     value={fin.budgetUsd} />
        <Figure label={t('admin.workspace.overview.funded')}     value={fin.funded} />
        <Figure label={t('admin.workspace.overview.available')}  value={fin.availableFunds} emphasis />
        <Figure label={t('admin.workspace.overview.authorised')} value={fin.authorised} />
        <Figure label={t('admin.workspace.overview.inFlight')}   value={fin.inFlight} />
        <Figure label={t('admin.workspace.overview.disbursed')}  value={fin.disbursed} />
      </dl>

      {/* ── 1. Funding: client → provider ───────────────────────────────────────── */}
      <Section title={t('admin.ledger.funding')} sub={t('admin.workspace.financials.fundingSub')}>
        {inRows.length === 0 ? (
          <Empty>{t('admin.workspace.financials.fundingEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {inRows.map(p => {
              const st = stageRef(p.stageId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-near-black dark:text-white">
                      <span className="font-semibold tabular-nums">{formatUSDFull(p.amount)}</span>
                      <span className="text-brand-mid-grey"> · {stateLabel(p.state)}</span>
                      {st && <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: st.stageNumber })} · {st.name}</span>}
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
        )}
      </Section>

      {/* ── 2. Milestone releases: per stage, provider → contractor ────────────── */}
      <Section title={t('admin.ledger.releases')} sub={t('admin.workspace.financials.releasesSub')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-xs">
            <thead className="border-b border-brand-border-grey bg-brand-off-white text-[10px] font-semibold uppercase tracking-wide text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
              <tr>
                <th className="px-5 py-2.5 text-left">{t('admin.workspace.financials.colStage')}</th>
                <th className="px-3 py-2.5 text-right">{t('admin.workspace.stage.milestone')}</th>
                <th className="px-3 py-2.5 text-left">{t('admin.workspace.stage.tranche')}</th>
                <th className="px-3 py-2.5 text-left" title={t('admin.workspace.financials.legacyHint')}>{t('admin.workspace.financials.legacy')}</th>
                <th className="px-3 py-2.5 text-left">{t('admin.workspace.financials.colLifecycle')}</th>
                <th className="px-3 py-2.5 text-left">{t('admin.workspace.stage.release')}</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {ws.stages.map(v => {
                const milestone = v.stage.payment_milestone_usd;
                const liveRelease = v.release && v.release.state !== 'failed';
                // Offered on every complete stage with no live release; the database answers.
                const offer = v.stage.status === 'complete' && !liveRelease && (milestone ?? 0) > 0;
                return (
                  <tr key={v.stage.id}>
                    <td className="px-5 py-2.5 text-brand-near-black dark:text-white">
                      <Link to={workspaceHref(ws.project.id, { tab: 'stages', stageId: v.stage.id })} className="hover:underline">
                        <span className="tabular-nums text-brand-mid-grey">{v.stage.stage_number}</span> {stageLabel(v.stage)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-brand-near-black dark:text-white">
                      {milestone != null && milestone > 0 ? formatUSDFull(milestone) : <span className="text-brand-muted-grey">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-brand-mid-grey">{v.tranche ? stateLabel(v.tranche.state) : '—'}</td>
                    {/* LEGACY PROJECTION: shown, labelled, never read by anything on this page. */}
                    <td className="px-3 py-2.5 text-brand-muted-grey">{t(`admin.workspace.financials.projection.${v.stage.payment_status}` as TKey)}</td>
                    <td className="px-3 py-2.5"><StageLifecycleBadge lifecycle={v.lifecycle} size="small" /></td>
                    <td className="px-3 py-2.5 text-brand-mid-grey">
                      {v.release ? `${stateLabel(v.release.state)} · ${formatUSDFull(v.release.amount)}` : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {offer && (
                        <button type="button"
                          disabled={contractors.length === 0}
                          title={contractors.length === 0 ? t('admin.ledger.noContractor') : undefined}
                          onClick={() => { const s = stageRef(v.stage.id); if (s) setModal({ kind: 'authorise', stage: s }); }}
                          className="rounded-xl bg-brand-near-black px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40 dark:bg-white dark:text-brand-near-black dark:hover:bg-white/90">
                          {t('admin.ledger.authorise')}
                        </button>
                      )}
                      {offer && contractors.length === 0 && (
                        <p className="mt-1 text-[10px] text-brand-mid-grey">{t('admin.ledger.noContractor')}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 3. Disbursements: the releases as money movement ────────────────────── */}
      <Section title={t('admin.workspace.financials.disbursements')} sub={t('admin.workspace.financials.disbursementsSub')}>
        {outRows.length === 0 ? (
          <Empty>{t('admin.workspace.financials.disbursementsEmpty')}</Empty>
        ) : (
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {outRows.map(p => {
              const st = stageRef(p.stageId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Banknote className="size-4 shrink-0 text-brand-mid-grey" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-near-black dark:text-white">
                      <span className="font-semibold tabular-nums">{formatUSDFull(p.amount)}</span>
                      <span className={cn(' · ', p.state === 'failed' ? 'text-state-alert' : p.state === 'disbursed' ? 'text-state-complete' : 'text-brand-mid-grey')}> · {stateLabel(p.state)}</span>
                      {st && <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: st.stageNumber })}</span>}
                      <span className="text-brand-mid-grey"> · {t('admin.ledger.to', { name: nameOf(p.beneficiaryId) })}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                      {t('admin.ledger.releasedBy', { name: nameOf(p.authorisedBy), when: formatRelative(p.authorisedAt) })}
                      {p.provider && p.providerRef && <> · {p.provider} {p.providerRef}</>}
                      {p.failureReason && <> · {p.failureReason}</>}
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

      {/* ── 4. Compensation: header + honest empty. Not modelled; its own design gate. ─ */}
      <Section title={t('admin.workspace.financials.compensation')} sub={t('admin.workspace.financials.compensationSub')}>
        <Empty>{t('admin.workspace.financials.compensationEmpty')}</Empty>
      </Section>

      {/* ── 5. Reconciliation: what the provider said, against our rows ───────────── */}
      <Section title={t('admin.workspace.financials.reconciliation')} sub={t('admin.workspace.financials.reconciliationSub')}>
        <ReconciliationList payments={fin.payments} stageRef={stageRef} />
      </Section>

      {/* ── 6. Budget: fees read-only, costing as-is ─────────────────────────────── */}
      <BudgetSection ws={ws} />

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

function BudgetSection({ ws }: { ws: LoadedWorkspace['workspace'] }) {
  const t = useT();
  const fees = ws.financials.fees;
  return (
    <>
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
      <Section title={t('admin.workspace.financials.costing')} sub={t('admin.workspace.financials.costingSub')}>
        <div className="px-5 py-4">
          {/* Costing only. BudgetView's Released/Held/Remaining are stage-status buckets — the
              client's estimate — and the ledger above is the record; one "released" per screen. */}
          <BudgetView project={ws.project} stages={ws.stages.map(s => s.stage)} showMilestoneBuckets={false} />
        </div>
      </Section>
    </>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-brand-mid-grey">{sub}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{children}</p>;
}

function Figure({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <dt className="text-[11px] text-brand-mid-grey">{label}</dt>
      <dd className={cn('mt-0.5 truncate tabular-nums text-brand-near-black dark:text-white', emphasis ? 'text-lg font-bold' : 'text-base font-semibold')}>
        {formatUSDFull(value)}
      </dd>
    </div>
  );
}
