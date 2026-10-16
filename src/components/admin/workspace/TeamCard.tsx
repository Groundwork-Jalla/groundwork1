import { useState } from 'react';
import { HardHat, Landmark, Loader2, ShieldCheck, Star, UserRound, X } from 'lucide-react';
import type { Workspace } from '@/lib/admin/workspace';
import { assignContractor, removeVerifier } from '@/lib/supabase/verifiers';
import { setPrimaryContractor } from '@/lib/supabase/payout-destinations';
import { AssignVerifierModal } from '@/components/admin/team/AssignVerifierModal';
import { ContractorPayoutCheck } from '@/components/admin/team/ContractorPayoutCheck';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Who is on this project — client, contractors, verifiers (06 §21).
//
// ── An ADMINISTRATIVE view, not the contractor's or the verifier's ──────────────────
// /admin, /contractors and /verifiers are separate surfaces over one model. This card
// shows the assignments and lets an admin change them; it is never where a contractor
// uploads evidence or a verifier records a visit. Those live on their own surfaces and
// read these same rows — `contractor_invites` (029/030) and `project_verifiers` (086) —
// so nothing here is an admin-only copy of assignment state.
//
// Every act is the existing RPC: `admin_assign_contractor` (the same call the projects
// list has always made) and `assign_verifier`. After either, the workspace reloads.
// =========================================================

export function TeamCard({ ws, available, onChanged, onNotice }: {
  ws: Workspace;
  /** 086 applied — the verifier rows could be read. */
  available: boolean;
  onChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const t = useT();
  const { owner, contractors, verifiers } = ws.team;
  const primary = contractors.find(c => c.is_primary) ?? null;
  const [assigning, setAssigning] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignVerifier, setAssignVerifier] = useState(false);
  /** The assignment being taken off, while the RPC runs. */
  const [removing, setRemoving] = useState<string | null>(null);

  /**
   * Take a verifier off this project.
   *
   * Confirmed first, because it is not reversible from the client's side of the story:
   * the assignment stops being `active`, which is what makes somebody a project member
   * (086), so they immediately lose the thread, the evidence and any stage they were
   * part-way through checking.
   */
  async function takeOff(assignmentId: string, name: string) {
    if (!window.confirm(t('admin.verifier.removeConfirm', { name }))) return;
    setRemoving(assignmentId);
    try {
      await removeVerifier(assignmentId);
      onNotice(t('admin.verifier.removed', { name }));
      onChanged();
    } catch (err) {
      onNotice(err instanceof Error && err.message.includes('not_admin')
        ? t('admin.verifier.removeNotAdmin')
        : t('admin.verifier.removeFailed'));
    } finally {
      setRemoving(null);
    }
  }
  const [verifierAvailable, setVerifierAvailable] = useState(available);

  async function assign() {
    const address = email.trim();
    if (!address) return;
    setBusy(true); setError(null);
    try {
      await assignContractor(ws.project.id, address);
      setAssigning(false); setEmail('');
      onNotice(t('admin.workspace.team.assigned', { email: address }));
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Name the contractor this project's stage releases go to. Oversight, not execution: the
   * admin says who is paid, and `authorise_release` still refuses if that person has no
   * checked account on file.
   */
  async function makePrimary(inviteId: string) {
    setBusy(true); setError(null);
    try {
      await setPrimaryContractor(inviteId);
      onNotice(t('admin.workspace.team.primarySet'));
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <div>
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.workspace.team.title')}</h2>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.workspace.team.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setAssigning(v => !v); setError(null); }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40">
            <HardHat className="size-3.5" />{t('admin.workspace.team.assignContractor')}
          </button>
          {verifierAvailable && (
            <button type="button" onClick={() => setAssignVerifier(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40">
              <ShieldCheck className="size-3.5" />{t('admin.verifier.assign')}
            </button>
          )}
        </div>
      </header>

      {assigning && (
        <div className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
          <label className="block text-[11px] text-brand-mid-grey" htmlFor="assign-contractor-email">{t('admin.workspace.team.contractorEmail')}</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input id="assign-contractor-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={t('admin.workspace.team.contractorEmailHint')}
              className="min-w-0 flex-1 rounded-lg border border-brand-border-grey bg-white px-3 py-1.5 text-sm text-brand-near-black focus:border-brand-near-black focus:outline-none dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
            <button type="button" onClick={assign} disabled={busy || !email.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black">
              {busy && <Loader2 className="size-3.5 animate-spin" />}{t('admin.workspace.team.assign')}
            </button>
          </div>
          {/* The contractor must already have a Groundwork account; the RPC says so itself. */}
          <p className="mt-1 text-[11px] text-brand-mid-grey">{t('admin.workspace.team.assignHint')}</p>
          {error && <p role="alert" className="mt-1 text-xs text-state-alert">{error}</p>}
        </div>
      )}

      <dl className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
        <Row icon={<UserRound className="size-3.5" />} label={t('admin.workspace.team.client')}>
          {owner ? (
            <span className="text-brand-near-black dark:text-white">{owner.name || owner.email}
              {owner.name && owner.email && <span className="text-brand-mid-grey"> · {owner.email}</span>}
            </span>
          ) : <span className="text-brand-mid-grey">{t('admin.workspace.header.unknownAccount')}</span>}
        </Row>

        <Row icon={<HardHat className="size-3.5" />} label={t('admin.workspace.team.contractors')}>
          {contractors.length === 0 ? (
            <span className="text-brand-mid-grey">{t('admin.workspace.team.noContractor')}</span>
          ) : (
            <ul className="space-y-1">
              {contractors.map(c => (
                <li key={c.id} className="text-brand-near-black dark:text-white">
                  {c.name}
                  <span className="text-brand-mid-grey">
                    {' · '}{t(`admin.workspace.team.inviteStatus.${c.status}` as TKey)}
                    {c.accepted_at && ` · ${formatRelative(c.accepted_at)}`}
                  </span>
                  {c.is_primary ? (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-brand-off-white px-1.5 py-0.5 text-[10px] font-semibold text-brand-mid-grey dark:bg-[#252525]">
                      <Star className="size-2.5" aria-hidden />{t('admin.workspace.team.primary')}
                    </span>
                  ) : (
                    // Only an accepted assignment whose holder has an account can be paid;
                    // 101 refuses the rest, so the control is not offered for them.
                    c.status === 'accepted' && c.contractor_user_id && (
                      <button
                        type="button" disabled={busy}
                        onClick={() => void makePrimary(c.id)}
                        className="ml-1.5 text-[11px] font-semibold text-brand-mid-grey underline underline-offset-2 disabled:opacity-40"
                      >
                        {t('admin.workspace.team.makePrimary')}
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Row>

        {/* Where the contractor this project pays actually gets the money, and the staff
            check that makes a release possible. Only for the primary — the others are
            assigned to work, not to be paid for this project. */}
        {primary?.contractor_user_id && (
          <Row icon={<Landmark className="size-3.5" />} label={t('admin.workspace.team.payout.title')}>
            <ContractorPayoutCheck contractorUserId={primary.contractor_user_id} onNotice={onNotice} />
          </Row>
        )}

        <Row icon={<ShieldCheck className="size-3.5" />} label={t('admin.workspace.team.verifiers')}>
          {!available ? (
            <span className="text-brand-mid-grey">{t('admin.workspace.overview.domain.unavailable')}</span>
          ) : verifiers.length === 0 ? (
            <span className="text-brand-mid-grey">{t('admin.workspace.team.noVerifier')}</span>
          ) : (
            <ul className="space-y-0.5">
              {verifiers.map(v => (
                <li key={v.id} className="flex items-center gap-2 text-brand-near-black dark:text-white">
                  <span className="min-w-0 flex-1 truncate">
                    {v.name}
                    <span className="text-brand-mid-grey">{v.discipline && ` · ${v.discipline}`}{v.status && ` · ${v.status}`}</span>
                  </span>
                  {/* Only an ACTIVE assignment can be taken off. `remove_verifier` (086)
                      matches on status = 'active', so offering it on a removed row would
                      be a button that silently does nothing. */}
                  {v.status === 'active' && (
                    <button
                      type="button"
                      disabled={removing !== null}
                      onClick={() => { void takeOff(v.id, v.name); }}
                      className="shrink-0 rounded-md px-1.5 py-1 text-brand-mid-grey hover:bg-brand-off-white hover:text-state-alert disabled:opacity-40 dark:hover:bg-[#2c2c2c]"
                      aria-label={t('admin.verifier.removeOne', { name: v.name })}
                      title={t('admin.verifier.removeOne', { name: v.name })}
                    >
                      {removing === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>

      {assignVerifier && (
        <AssignVerifierModal
          project={{ id: ws.project.id, name: ws.project.name, tier: ws.project.tier }}
          onClose={() => setAssignVerifier(false)}
          onAssigned={notice => { setAssignVerifier(false); onNotice(notice); onChanged(); }}
          onUnavailable={() => { setVerifierAvailable(false); setAssignVerifier(false); }}
        />
      )}
    </section>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3 text-xs">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-brand-muted-grey">{icon}{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
