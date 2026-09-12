import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, ExternalLink, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ownerLookup } from '@/lib/supabase/admin-users';
import {
  authoriseRelease, confirmFunding, ineligibilityReason, isPaymentsUnavailable,
  listAllPayments, openReconciliation, type Payment,
} from '@/lib/supabase/payments';
import { formatUSDFull } from '@/lib/budget';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
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

interface StageRef { id: string; projectId: string; stageNumber: number; name: string; status: string; milestone: number | null }
interface Contractor { userId: string; email: string }

type Modal =
  | { kind: 'confirm'; payment: Payment }
  | { kind: 'authorise'; stage: StageRef }
  | { kind: 'reconcile'; payment: Payment }
  | null;

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

function LedgerModal({ modal, projectName, stage, contractors, onClose, onDone }: {
  modal: NonNullable<Modal>;
  projectName: string;
  stage: StageRef | null;
  contractors: Contractor[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [note, setNote]   = useState('');
  const [amount, setAmount] = useState(String(stage?.milestone ?? ''));
  const [beneficiary, setBeneficiary] = useState(contractors[0]?.userId ?? '');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = stage?.stageNumber ?? 0;
  const title = modal.kind === 'confirm' ? t('admin.ledger.confirmTitle') : modal.kind === 'authorise' ? t('admin.ledger.authoriseTitle') : t('admin.ledger.openReconciliation');
  const body  = modal.kind === 'confirm'
    ? t('admin.ledger.confirmBody', { amount: formatUSDFull(modal.payment.amount), n, project: projectName })
    : modal.kind === 'authorise'
      ? t('admin.ledger.authoriseBody', { n, project: projectName })
      : t('admin.ledger.reconcileBody');

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (modal.kind === 'confirm') await confirmFunding(modal.payment.id, note || undefined);
      else if (modal.kind === 'reconcile') await openReconciliation(modal.payment.id, note || undefined);
      else await authoriseRelease(modal.stage.id, Number(amount), beneficiary, note || undefined);
      onDone();
    } catch (err) {
      // The database's reason, in the reader's language; anything else verbatim.
      const reason = ineligibilityReason(err) ?? /^(bad_beneficiary|already_authorised):/.exec((err as { message?: string })?.message ?? '')?.[1] ?? null;
      const key = reason ? (`admin.ledger.refusal.${reason}` as TKey) : null;
      setError(key && t(key) !== key ? t(key) : errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div initial={{ y: 12 }} animate={{ y: 0 }} exit={{ y: 12 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-brand-near-black">{title}</h3>
          <button type="button" onClick={onClose} className="text-brand-mid-grey hover:text-brand-near-black"><X className="size-4" /></button>
        </div>
        <p className="text-xs text-brand-mid-grey">{body}</p>

        {modal.kind === 'authorise' && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="text-xs text-brand-near-black">
              {t('admin.ledger.amount')}
              <input type="number" min={1} step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm tabular-nums" />
            </label>
            <label className="text-xs text-brand-near-black">
              {t('admin.ledger.beneficiary')}
              <select value={beneficiary} onChange={e => setBeneficiary(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm">
                {contractors.map(c => <option key={c.userId} value={c.userId}>{c.email}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className="mt-4 block text-xs text-brand-near-black">
          {t('admin.ledger.note')}
          <input value={note} onChange={e => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-border-grey px-3 py-2 text-sm" />
        </label>

        {error && <p className="mt-3 text-xs text-state-held">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-semibold text-brand-near-black">{t('common.cancel')}</button>
          <button type="button" onClick={submit} disabled={busy || (modal.kind === 'authorise' && (!beneficiary || !(Number(amount) > 0)))}
            className="flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {modal.kind === 'confirm' ? t('admin.ledger.confirm') : modal.kind === 'authorise' ? t('admin.ledger.authorise') : t('admin.ledger.openReconciliation')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
