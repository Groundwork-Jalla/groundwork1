import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, HardHat, Loader2, X } from 'lucide-react';

import { useLanguage, useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { isValidEmail } from '@/lib/email/is-valid-email';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInvites, inviteContractor, revokeInvite } from '@/lib/supabase/invites';
import type { ContractorInviteRow } from '@/types/project';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';

// =========================================================
// The primary client invites the initial contractor who is building this.
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
// · Removing is confirmed. A revoked contractor loses access to a build they may be
//   standing on; a family viewer loses a page they were reading.
// =========================================================

interface ContractorInviteProps {
  projectId: string;
  userId: string;
  projectName: string;
}

export function ContractorInvite({
  projectId, userId, projectName,
}: ContractorInviteProps) {
  const t = useT();
  const { lang } = useLanguage();
  const { user } = useAuth();
  const inviterName = user?.user_metadata?.full_name ?? user?.email ?? 'Project Owner';
  const { scope, access, error: accessError, refresh } = useProjectTeamAccess(projectId);
  const current = useRef(scope);
  current.current = scope;
  const mounted = useRef(false);
  const working = useRef(false);
  const rowRequest = useRef(0);

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
  const [notEmailed, setNotEmailed] = useState<{ email: string; link: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContractorInviteRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const version = ++rowRequest.current;
    try {
      const invites = await fetchInvites(projectId);
      if (!mounted.current || current.current !== scope || rowRequest.current !== version) return;
      setRows(invites); setLoadError(false);
    } catch {
      if (!mounted.current || current.current !== scope || rowRequest.current !== version) return;
      setRows(null); setLoadError(true);
    }
  }, [projectId, scope]);
  useEffect(() => {
    mounted.current = true; working.current = false;
    setRows(null); setEmail(''); setBusy(false); setSent(null); setError(null);
    setNotEmailed(null); setRemoveTarget(null); setRemoving(false); setLoadError(false);
    return () => { mounted.current = false; ++rowRequest.current; };
  }, [scope]);
  useEffect(() => { if (access?.primaryClient) void load(); }, [access, load]);
  const canSubmit = access?.canInviteContractor === true && rows !== null && !loadError;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (working.current || !canSubmit || current.current !== scope) return;
    setError(null); setSent(null); setNotEmailed(null);

    const address = email.trim();
    if (!isValidEmail(address)) { setError(t('inviteUi.errEmail')); return; }

    working.current = true; setBusy(true);
    try {
      const { emailSent, invite: saved } = await inviteContractor(
        projectId, userId, address, projectName, inviterName, lang);
      if (!mounted.current || current.current !== scope) return;
      if (emailSent) setSent(address);
      else setNotEmailed({ email: address, link: `${window.location.origin}/invite/${encodeURIComponent(saved.token)}` });
      setEmail('');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      if (!mounted.current || current.current !== scope) return;
      const message = errorMessage(err, '');
      setError(message.includes('role_change_requires_admin') ? t('teamAccess.roleChange')
        : message.includes('contractor_invitation_pending') ? t('teamAccess.pendingContractor')
        : message.includes('not_permitted') ? t('teamAccess.notPermitted')
        : message.includes('self_invite') ? t('projectShare.errSelf')
        : message.includes('invalid_email') ? t('inviteUi.errEmail')
        : t('inviteUi.errFailed'));
    } finally {
      if (mounted.current && current.current === scope) { working.current = false; setBusy(false); }
    }
  }

  async function remove() {
    if (!removeTarget || working.current || !access?.primaryClient || current.current !== scope) return;
    working.current = true; setRemoving(true);
    try {
      await revokeInvite(removeTarget.id);
      if (!mounted.current || current.current !== scope) return;
      setRemoveTarget(null);
      await Promise.all([load(), refresh()]);
    } catch {
      if (mounted.current && current.current === scope) setError(t('teamAccess.changeFailed'));
    } finally {
      if (mounted.current && current.current === scope) { working.current = false; setRemoving(false); }
    }
  }

  function statusLabel(status: ContractorInviteRow['status']): string {
    return t(status === 'accepted' ? 'inviteUi.accepted'
           : status === 'rejected' ? 'inviteUi.rejected'
           : 'inviteUi.pending');
  }

  if (access && !access.primaryClient) return null;
  const contractorChosen = access?.hasContractor || access?.hasPendingContractor;

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <HardHat className="size-4 shrink-0" aria-hidden />
        {t(contractorChosen ? 'teamAccess.contractorTitle' : 'inviteUi.title')}
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">
        {t(access?.needsPrimaryReview ? 'teamAccess.needsReview' : contractorChosen ? 'teamAccess.contractorAssigned' : 'inviteUi.body')}
      </p>

      {!access && <p className="mt-3 text-xs text-brand-mid-grey">{t(accessError ? 'teamAccess.loadFailed' : 'common.loading')}</p>}
      {(accessError || loadError) && <Button type="button" variant="outline" className="mt-3 h-8 text-xs" onClick={() => { void refresh(); void load(); }}>{t('common.retry')}</Button>}
      {canSubmit && (
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
            {t('inviteUi.notEmailed', { email: notEmailed.email })}
          </p>
          <p className="mt-1.5 break-all font-mono text-[11px] text-brand-mid-grey">{notEmailed.link}</p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(notEmailed.link)}
            className="mt-1.5 text-[11px] font-semibold text-brand-near-black underline underline-offset-4 dark:text-white">
            {t('projectShare.copyLink')}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}
      {loadError && <p role="alert" className="mt-3 text-xs text-state-alert">{t('teamAccess.loadFailed')}</p>}

      <ul className="mt-4 space-y-2">
        {!access?.primaryClient || rows === null ? null
          : rows.length === 0 ? <li className="text-xs text-brand-mid-grey">{t('inviteUi.none')}</li>
          : rows.map(inv => (
            <li key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border-grey px-3 py-2 dark:border-[#2c2c2c]">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-brand-near-black dark:text-white">
                  {inv.email}
                </p>
                <p className="text-[11px] text-brand-mid-grey">
                  {inv.is_primary && `${t('teamAccess.primaryContractor')} · `}{statusLabel(inv.status)}
                </p>
              </div>
              {inv.status === 'pending' && (
                <button type="button" disabled={busy || removing} onClick={() => setRemoveTarget(inv)}
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
