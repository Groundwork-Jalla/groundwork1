import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { Banknote, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ownerLookup } from '@/lib/supabase/admin-users';
import { isPaymentsUnavailable, listAllPayments, type Payment } from '@/lib/supabase/payments';
import { LedgerModal, type Contractor, type LedgerModalState as Modal, type StageRef } from '@/components/admin/ledger/LedgerModal';
import { formatUSDFull } from '@/lib/budget';
import { formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Funding & releases — the admin's view of the ledger (090), on the Payments & Budgets
// page (IA: /admin/budgets absorbs milestone state).
//
// Two acts live here, both admin-only, both decided in the database:
//   Confirm received   — an expected tranche was paid (staff confirmation, interim path)
//   Authorise release  — money out to the contractor; the RPC recomputes eligibility
//                        under a lock and refuses with a reason this panel translates
// Nothing here decides eligibility. "Authorise release" is offered on every approved
// stage with a contractor and no live release; the database's refusal is the answer.
// =========================================================

export default function LedgerPanel() {
  const t = useT();
  const [loading, setLoading]     = useState(true);
  const [available, setAvailable] = useState(true);
  const [payments, setPayments]   = useState<Payment[]>([]);
  const [projects, setProjects]   = useState<Map<string, string>>(new Map());
  const [stages, setStages]       = useState<StageRef[]>([]);
  const [contractors, setContractors] = useState<Map<string, Contractor[]>>(new Map());
  const [names, setNames]         = useState<Map<string, string>>(new Map());
  const [modal, setModal]         = useState<Modal>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ledger = await listAllPayments();
      setAvailable(ledger.available);
      setPayments(ledger.rows);
      if (!ledger.available) return;
      const [projRes, stageRes, inviteRes, owners] = await Promise.all([
        supabase.from('projects').select('id, name'),
        supabase.from('project_stages').select('id, project_id, stage_number, name, status, payment_milestone_usd'),
        supabase.from('contractor_invites').select('project_id, contractor_user_id, email').eq('status', 'accepted').not('contractor_user_id', 'is', null),
        ownerLookup(),
      ]);
      setProjects(new Map(((projRes.data ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name])));
      setStages(((stageRes.data ?? []) as Record<string, unknown>[]).map(s => ({
        id: s.id as string, projectId: s.project_id as string, stageNumber: Number(s.stage_number),
        name: (s.name as string) ?? '', status: s.status as string,
        milestone: s.payment_milestone_usd == null ? null : Number(s.payment_milestone_usd),
      })));
      const byProject = new Map<string, Contractor[]>();
      for (const r of (inviteRes.data ?? []) as Record<string, unknown>[]) {
        const list = byProject.get(r.project_id as string) ?? [];
        list.push({ userId: r.contractor_user_id as string, email: (r.email as string) ?? '' });
        byProject.set(r.project_id as string, list);
      }
      setContractors(byProject);
      setNames(new Map([...owners].map(([id, o]) => [id, o.name || o.email])));
    } catch (err) {
      if (isPaymentsUnavailable(err)) setAvailable(false); else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string | null) => (id ? (names.get(id) ?? id.slice(0, 8)) : '');
  const stageOf = (id: string | null) => stages.find(s => s.id === id) ?? null;
  const stateLabel = (state: Payment['state']) => t(`admin.ledger.state.${state}` as TKey);

  // Approved stages with a contractor and no live release: candidates for a release.
  const liveOut = new Set(payments.filter(p => p.direction === 'out' && p.state !== 'failed').map(p => p.stageId));
  const candidates = stages.filter(s => s.status === 'complete' && !liveOut.has(s.id));

  const inRows  = payments.filter(p => p.direction === 'in');
  const outRows = payments.filter(p => p.direction === 'out');

  return (
    <section className="mt-12 max-w-3xl">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-brand-near-black">{t('admin.ledger.title')}</h2>
        <p className="mt-1 text-xs text-brand-mid-grey">{t('admin.ledger.subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey"><Loader2 className="size-4 animate-spin" /> {t('common.loading')}</div>
      ) : !available ? (
        <p className="text-xs text-brand-mid-grey">{t('admin.ledger.unavailable')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Funding */}
          <div className="rounded-2xl border border-brand-border-grey bg-white">
            <h3 className="border-b border-brand-border-grey px-5 py-3 text-sm font-semibold text-brand-near-black">{t('admin.ledger.funding')}</h3>
            {inRows.length === 0 ? (
              <p className="px-5 py-6 text-xs text-brand-mid-grey">{t('admin.ledger.empty')}</p>
            ) : (
              <ul className="divide-y divide-brand-border-grey">
                {inRows.map(p => {
                  const st = stageOf(p.stageId);
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-brand-near-black">
                          <Link to={`/projects/${p.projectId}`} target="_blank" className="font-medium hover:underline">{projects.get(p.projectId) ?? p.projectId.slice(0, 8)}</Link>
                          {st && <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: st.stageNumber })} {st.name && `· ${st.name}`}</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                          {formatUSDFull(p.amount)} · {stateLabel(p.state)}
                          {p.fundingSource === 'staff_confirmed' && <> · {t('admin.ledger.source.staff_confirmed', { name: nameOf(p.confirmedBy), when: formatRelative(p.confirmedAt) })}</>}
                          {p.fundingSource === 'provider' && <> · {t('admin.ledger.source.provider', { when: formatRelative(p.settledAt ?? p.updatedAt) })}</>}
                          {p.note && <> · {p.note}</>}
                        </p>
                      </div>
                      {p.state === 'expected' && (
                        <button type="button" onClick={() => setModal({ kind: 'confirm', payment: p })}
                          className="shrink-0 rounded-xl border border-brand-near-black px-3 py-2 text-xs font-semibold text-brand-near-black hover:bg-brand-near-black hover:text-white transition-colors">
                          {t('admin.ledger.confirmFunding')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Releases */}
          <div className="rounded-2xl border border-brand-border-grey bg-white">
            <h3 className="border-b border-brand-border-grey px-5 py-3 text-sm font-semibold text-brand-near-black">{t('admin.ledger.releases')}</h3>
            <ul className="divide-y divide-brand-border-grey">
              {outRows.map(p => {
                const st = stageOf(p.stageId);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <Banknote className="size-4 shrink-0 text-brand-mid-grey" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-brand-near-black">
                        <span className="font-medium">{projects.get(p.projectId) ?? p.projectId.slice(0, 8)}</span>
                        {st && <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: st.stageNumber })}</span>}
                        <span className="text-brand-mid-grey"> · {t('admin.ledger.to', { name: nameOf(p.beneficiaryId) })}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                        {formatUSDFull(p.amount)} · <span className={cn(p.state === 'failed' && 'text-state-held', p.state === 'disbursed' && 'text-state-complete')}>{stateLabel(p.state)}</span>
                        {' · '}{t('admin.ledger.releasedBy', { name: nameOf(p.authorisedBy), when: formatRelative(p.authorisedAt) })}
                        {p.providerRef && <> · {p.provider} {p.providerRef}</>}
                        {p.failureReason && <> · {p.failureReason}</>}
                      </p>
                    </div>
                    {p.state === 'failed' && (
                      <button type="button" onClick={() => setModal({ kind: 'reconcile', payment: p })}
                        className="shrink-0 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold text-brand-near-black hover:border-brand-near-black transition-colors">
                        {t('admin.ledger.openReconciliation')}
                      </button>
                    )}
                  </li>
                );
              })}
              {candidates.map(s => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-brand-near-black">
                      <span className="font-medium">{projects.get(s.projectId) ?? s.projectId.slice(0, 8)}</span>
                      <span className="text-brand-mid-grey"> · {t('admin.ledger.stage', { n: s.stageNumber })} {s.name && `· ${s.name}`}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                      {s.milestone != null ? formatUSDFull(s.milestone) : '—'}
                      {(contractors.get(s.projectId) ?? []).length === 0 && <> · {t('admin.ledger.noContractor')}</>}
                    </p>
                  </div>
                  <button type="button" disabled={(contractors.get(s.projectId) ?? []).length === 0}
                    onClick={() => setModal({ kind: 'authorise', stage: s })}
                    className="shrink-0 rounded-xl bg-brand-near-black px-3 py-2 text-xs font-semibold text-white hover:bg-black transition-colors disabled:opacity-40">
                    {t('admin.ledger.authorise')}
                  </button>
                </li>
              ))}
              {outRows.length === 0 && candidates.length === 0 && (
                <li className="px-5 py-6 text-xs text-brand-mid-grey">{t('admin.ledger.empty')}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <LedgerModal
            modal={modal}
            projectName={projects.get(modal.kind === 'authorise' ? modal.stage.projectId : modal.payment.projectId) ?? ''}
            stage={modal.kind === 'authorise' ? modal.stage : stageOf(modal.payment.stageId)}
            contractors={modal.kind === 'authorise' ? (contractors.get(modal.stage.projectId) ?? []) : []}
            onClose={() => setModal(null)}
            onDone={() => { setModal(null); load(); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
