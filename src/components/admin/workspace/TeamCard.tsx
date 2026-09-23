import { useState } from 'react';
import { HardHat, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import type { Workspace } from '@/lib/admin/workspace';
import { assignContractor } from '@/lib/supabase/verifiers';
import { AssignVerifierModal } from '@/components/admin/team/AssignVerifierModal';
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
  const [assigning, setAssigning] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignVerifier, setAssignVerifier] = useState(false);
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
            <ul className="space-y-0.5">
              {contractors.map(c => (
                <li key={c.id} className="text-brand-near-black dark:text-white">
                  {c.name}
                  <span className="text-brand-mid-grey">
                    {' · '}{t(`admin.workspace.team.inviteStatus.${c.status}` as TKey)}
                    {c.accepted_at && ` · ${formatRelative(c.accepted_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Row>

        <Row icon={<ShieldCheck className="size-3.5" />} label={t('admin.workspace.team.verifiers')}>
          {!available ? (
            <span className="text-brand-mid-grey">{t('admin.workspace.overview.domain.unavailable')}</span>
          ) : verifiers.length === 0 ? (
            <span className="text-brand-mid-grey">{t('admin.workspace.team.noVerifier')}</span>
          ) : (
            <ul className="space-y-0.5">
              {verifiers.map(v => (
                <li key={v.id} className="text-brand-near-black dark:text-white">
                  {v.name}
                  <span className="text-brand-mid-grey">{v.discipline && ` · ${v.discipline}`}{v.status && ` · ${v.status}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>

      {assignVerifier && (
        <AssignVerifierModal
          project={{ id: ws.project.id, name: ws.project.name }}
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
