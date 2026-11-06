import { useCallback, useEffect, useState } from 'react';
import { Check, HardHat, Loader2, X } from 'lucide-react';

import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { isValidEmail } from '@/lib/email/is-valid-email';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInvites, inviteContractor, revokeInvite } from '@/lib/supabase/invites';
import type { ContractorInviteRow } from '@/types/project';

// =========================================================
// The owner invites the contractor who is building this.
//
// Favour, 7 Nov 2026: "the contractor invite side should look like the share this
// build section. they should both have the same ui."
//
// It did not. Share This Build is a card with the form already open — a label, a box,
// a button, and the list of people underneath. Contractor Access was a bare heading
// with an "Invite Contractor" button that toggled a form into view, over an
// illustrated empty state the width of the page. Two panels doing the same job on the
// same screen, one of them asking to be clicked before it would show you anything.
//
// This is the Share This Build shell, with the contractor's own rules inside it.
//
// ── Where the two still differ, and why ────────────────────────────────────────────
//
// · No Name field. `contractor_invites` has nowhere to put one (project, email, role,
//   status, token). Share This Build stores the client's name in `relationship`.
//   Inventing a box whose contents are dropped on submit is worse than not asking.
// · A plan cap. Self Verify allows one contractor per project, so the form is replaced
//   by a line saying so rather than left to fail on submit.
// · Removing is confirmed. A revoked contractor loses access to a build they may be
//   standing on; a family viewer loses a page they were reading.
// =========================================================

interface ContractorInviteProps {
  projectId: string;
  userId: string;
  projectName: string;
  projectTier: string;
}

export function ContractorInvite({
  projectId, userId, projectName, projectTier,
}: ContractorInviteProps) {
  const t = useT();
  const { user } = useAuth();
  const inviterName = user?.user_metadata?.full_name ?? user?.email ?? 'Project Owner';

  const [rows, setRows]   = useState<ContractorInviteRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const [sent, setSent]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set only when the invite row was written but the email did not go out.
   *
   * The invitation is real either way — the row is what grants access and what the
   * link is keyed on — so the owner is handed the address rather than an apology.
   * Same reasoning as ShareProject's fallback.
   */
  const [notEmailed, setNotEmailed] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContractorInviteRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    fetchInvites(projectId).then(setRows).catch(() => setRows([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const live = (rows ?? []).filter(r => r.status === 'pending' || r.status === 'accepted');
  const atCap = (projectTier === 'self_verify' || projectTier === 'starter') && live.length >= 1;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSent(null); setNotEmailed(null);

    const address = email.trim();
    if (!isValidEmail(address)) { setError(t('inviteUi.errEmail')); return; }

    setBusy(true);
    try {
      const { emailSent } = await inviteContractor(
        projectId, userId, address, projectName, inviterName);
      if (emailSent) setSent(address); else setNotEmailed(address);
      setEmail('');
      load();
    } catch (err) {
      setError(errorMessage(err, t('inviteUi.errFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await revokeInvite(removeTarget.id);
      setRemoveTarget(null);
      load();
    } catch {
      setError(t('inviteUi.errFailed'));
    } finally {
      setRemoving(false);
    }
  }

  function statusLabel(status: ContractorInviteRow['status']): string {
    return t(status === 'accepted' ? 'inviteUi.accepted'
           : status === 'rejected' ? 'inviteUi.rejected'
           : 'inviteUi.pending');
  }

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <HardHat className="size-4 shrink-0" aria-hidden />
        {t('inviteUi.title')}
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">
        {t('inviteUi.body')}
      </p>

      {atCap ? (
        /* Said instead of the form, not beside it. A box you may not submit is a
           worse answer than a sentence explaining why there is no box. */
        <p className="mt-4 rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-2.5 text-xs leading-relaxed text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#141414]">
          {t('inviteUi.capReached')}{' '}
          <span className="text-brand-near-black dark:text-white">{t('project.invite.capUpgrade')}</span>
        </p>
      ) : (
        <form onSubmit={invite} noValidate className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="contractorEmail" className="text-xs">{t('inviteUi.email')}</Label>
            <Input
              id="contractorEmail" type="email" autoComplete="off"
              placeholder={t('inviteUi.emailPlaceholder')}
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="h-9 text-xs">
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('inviteUi.invite')}
          </Button>
        </form>
      )}

      {sent && (
        <p className="mt-3 flex items-center gap-2 text-xs text-state-complete">
          <Check className="size-3.5" aria-hidden />{t('inviteUi.sent', { email: sent })}
        </p>
      )}

      {notEmailed && (
        <div className="mt-3 rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-2.5 dark:border-[#2c2c2c] dark:bg-[#141414]">
          <p className="text-xs text-brand-near-black dark:text-white">
            {t('inviteUi.notEmailed', { email: notEmailed })}
          </p>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}

      <ul className="mt-4 space-y-2">
        {rows === null ? null
          : rows.length === 0 ? <li className="text-xs text-brand-mid-grey">{t('inviteUi.none')}</li>
          : rows.map(inv => (
            <li key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border-grey px-3 py-2 dark:border-[#2c2c2c]">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-brand-near-black dark:text-white">
                  {inv.email}
                </p>
                <p className="text-[11px] text-brand-mid-grey">{statusLabel(inv.status)}</p>
              </div>
              {inv.status === 'pending' && (
                <button type="button" onClick={() => setRemoveTarget(inv)}
                  aria-label={`${t('inviteUi.remove')} ${inv.email}`}
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black dark:hover:text-white">
                  <X className="size-3" aria-hidden />{t('inviteUi.remove')}
                </button>
              )}
            </li>
          ))}
      </ul>

      <ConfirmModal
        open={removeTarget !== null}
        title={t('inviteUi.removeTitle')}
        description={t('inviteUi.removeBody', { email: removeTarget?.email ?? '' })}
        confirmLabel={t('inviteUi.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={removing}
        onConfirm={remove}
        onCancel={() => { if (!removing) setRemoveTarget(null); }}
      />
    </section>
  );
}

export default ContractorInvite;
