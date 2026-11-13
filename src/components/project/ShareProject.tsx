import { ProjectInvitationLink } from './ProjectInvitationLink';
import { createProjectInvitationLink } from '@/lib/supabase/project-invitation-links';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, Users, X } from 'lucide-react';
import {
  fetchProjectViewers, inviteProjectViewer, revokeProjectViewer,
  sendShareInviteEmail, shareLinkFor,
  ShareFailed, type ProjectViewer,
} from '@/lib/supabase/project-viewers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage, useT } from '@/lib/i18n';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';

// =========================================================
// Both primary project roles may invite observers. `asClient` is only for the
// contractor's initial client invitation, which grants the client approval rights.
// Capabilities are checked here and enforced again by the invitation RPC.
// =========================================================

/**
 * `asClient` distinguishes the two surfaces this is rendered on.
 *
 * On the contractor's own project page the person being invited IS the client the
 * build is for, and since 174 that is who signs off each stage. On the client's page
 * it is their family, who watch and nothing more (112). Same component, same table,
 * two different people — so the caller states which, rather than this guessing from
 * the signed-in role.
 */
export function ShareProject(
  { projectId, asClient = false }: { projectId: string; asClient?: boolean },
) {
  const t = useT();
  const { lang } = useLanguage();
  const { scope: teamScope, access, error: accessError, refresh } = useProjectTeamAccess(projectId);
  const scope = `${teamScope}:${asClient}`;
  const current = useRef(scope);
  current.current = scope;
  const mounted = useRef(false);
  const working = useRef(false);
  const rowRequest = useRef(0);
  const inputId = useId();
  const [rows, setRows] = useState<ProjectViewer[] | null>(null);
  const [email, setEmail]               = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy]   = useState(false);
  const [sent, setSent]   = useState<string | null>(null);
  // Set only when the row was written but the email did not go out. The invitation is
  // real either way, so the owner is given the link rather than an apology.
  const [fallback, setFallback] = useState<{ email: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const version = ++rowRequest.current;
    try {
      const viewers = await fetchProjectViewers(projectId);
      if (!mounted.current || current.current !== scope || version !== rowRequest.current) return;
      setRows(viewers.filter(v => v.isClient === asClient)); setLoadError(false);
    } catch {
      if (!mounted.current || current.current !== scope || version !== rowRequest.current) return;
      setRows(null); setLoadError(true);
    }
  }, [projectId, scope, asClient]);
  useEffect(() => {
    mounted.current = true; working.current = false;
    setRows(null); setError(null); setSent(null); setFallback(null);
    setBusy(false); setEmail(''); setRelationship(''); setLoadError(false);
    return () => { mounted.current = false; ++rowRequest.current; };
  }, [scope]);
  useEffect(() => { if (access?.canInvite) void load(); }, [access, load]);

  const canSubmit = access?.canInvite === true && (!asClient || access.canInviteClient) && rows !== null && !loadError;

  async function createLink() {
    if (working.current || !canSubmit || current.current !== scope) return;
    working.current = true; setBusy(true); setError(null);
    try {
      await createProjectInvitationLink(projectId, asClient ? 'client' : 'observer');
      if (mounted.current && current.current === scope) await Promise.all([load(), refresh()]);
    } catch {
      if (mounted.current && current.current === scope) setError(t('projectLinks.createFailed'));
    } finally {
      if (mounted.current && current.current === scope) { working.current = false; setBusy(false); }
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (working.current || !canSubmit || current.current !== scope) return;
    setError(null); setSent(null); setFallback(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('projectShare.errEmail')); return; }

    working.current = true; setBusy(true);
    try {
      const address = email.trim();
      // Two steps that fail independently. The row is what grants access and what the
      // link is keyed on; the email is how they find out. This panel used to do only
      // the first and report the second, so everyone invited since 112 shipped was
      // told mail had gone out when none ever had.
      const token = await inviteProjectViewer(
        projectId, address, relationship.trim() || undefined, asClient);
      // A saved invitation belongs to this original request. Finish its delivery
      // even if the person leaves Team; only the UI result is scoped to this panel.
      const delivered = await sendShareInviteEmail(token, lang);
      if (!mounted.current || current.current !== scope) return;
      if (delivered) setSent(address);
      else setFallback({ email: address, link: shareLinkFor(token) });
      setEmail(''); setRelationship('');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      if (!mounted.current || current.current !== scope) return;
      const code = err instanceof ShareFailed ? err.code : '';
      setError(code === 'self_invite' ? t('projectShare.errSelf')
             : code === 'invalid_email' ? t('projectShare.errEmail')
             : code === 'role_change_requires_admin' ? t('teamAccess.roleChange')
             : code === 'already_member' ? t('teamAccess.alreadyMember')
             : code === 'not_permitted' ? t('teamAccess.notPermitted')
             : t('projectShare.errFailed'));
    } finally {
      if (mounted.current && current.current === scope) { working.current = false; setBusy(false); }
    }
  }

  async function remove(id: string) {
    if (working.current || !access?.canInvite || current.current !== scope) return;
    working.current = true; setBusy(true); setError(null);
    try {
      await revokeProjectViewer(id);
      if (mounted.current && current.current === scope) await Promise.all([load(), refresh()]);
    } catch {
      if (mounted.current && current.current === scope) setError(t('teamAccess.changeFailed'));
    } finally {
      if (mounted.current && current.current === scope) { working.current = false; setBusy(false); }
    }
  }

  if (access && (!access.canInvite || (asClient && (!access.primaryContractor || (!access.canInviteClient && !access.hasClientInvitation))))) return null;
  const clientEstablished = asClient && access?.hasClientInvitation;
  const activeLink = rows?.find(v => v.isShareLink && !v.acceptedAt && v.token);

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <Users className="size-4 shrink-0" aria-hidden />
        {t(clientEstablished ? 'teamAccess.clientTitle' : asClient ? 'projectShare.title' : 'projectShare.familyTitle')}
      </h3>
      {/* Two voices, because these are two different invitations. Telling a homeowner
          on their own project page to "invite your client" is the copy this component
          shipped with, and it was only ever right on the contractor's surface. */}
      <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">
        {t(clientEstablished ? 'teamAccess.clientAssigned' : asClient ? 'projectShare.body' : 'projectShare.familyBody')}
      </p>

      {!access && <p className="mt-3 text-xs text-brand-mid-grey">{t(accessError ? 'teamAccess.loadFailed' : 'common.loading')}</p>}
      {(accessError || loadError) && <Button type="button" variant="outline" className="mt-3 h-8 text-xs" onClick={() => { void refresh(); void load(); }}>{t('common.retry')}</Button>}
      <ProjectInvitationLink scope={scope} role={asClient ? 'client' : 'observer'} busy={busy}
        canCreate={canSubmit} onCreate={() => void createLink()} onRefresh={() => { void load(); void refresh(); }}
        link={activeLink?.token ? { token: activeLink.token } : undefined} />
      {canSubmit && (
      <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold underline underline-offset-4">{t('projectLinks.byEmail')}</summary>
      <form onSubmit={invite} noValidate className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {/* Name, then email address. 30 Oct 2026, Philip: "the question we should be
            asking here is the client's name and client's email address — I don't
            know what who they are is for." The column still stores a relationship
            for older rows; new invitations put the client's name in it, which is
            what the list and the invitation email both read. */}
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-name`} className="text-xs">{t('projectShare.relationship')}</Label>
          <Input id={`${inputId}-name`} autoComplete="off" value={relationship}
            onChange={e => setRelationship(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-email`} className="text-xs">{t('projectShare.email')}</Label>
          <Input id={`${inputId}-email`} type="email" autoComplete="off" value={email}
            onChange={e => setEmail(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="h-9 text-xs">
          {busy ? <Loader2 className="size-4 animate-spin" /> : t('projectShare.invite')}
        </Button>
      </form>
      </details>
      )}
      {/* The "whatever helps you tell the list apart later" hint went with the
          relabelled field, 30 Oct 2026. */}

      {sent  && <p className="mt-3 flex items-center gap-2 text-xs text-state-complete"><Check className="size-3.5" />{t('projectShare.sent', { email: sent })}</p>}

      {/* They ARE invited — the row is written and the link works. Only the email did
          not leave. Handing over the link is the useful thing to do here; "something
          went wrong" would hide an invitation that already exists. */}
      {fallback && (
        <div className="mt-3 rounded-lg border border-brand-border-grey bg-brand-off-white px-3 py-2.5 dark:border-[#2c2c2c] dark:bg-[#141414]">
          <p className="text-xs text-brand-near-black dark:text-white">
            {t('projectShare.notEmailed', { email: fallback.email })}
          </p>
          <p className="mt-1.5 break-all font-mono text-[11px] text-brand-mid-grey">{fallback.link}</p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(fallback.link)}
            className="mt-1.5 text-[11px] font-semibold text-brand-near-black underline underline-offset-4 dark:text-white">
            {t('projectShare.copyLink')}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}
      {loadError && <p role="alert" className="mt-3 text-xs text-state-alert">{t('teamAccess.loadFailed')}</p>}

      <ul className="mt-4 space-y-2">
        {!access?.canInvite || rows === null ? null
          : rows.length === 0 ? <li className="text-xs text-brand-mid-grey">{t(asClient ? 'projectShare.none' : 'projectShare.familyNone')}</li>
          : rows.map(v => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border-grey px-3 py-2 dark:border-[#2c2c2c]">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-brand-near-black dark:text-white">
                  {v.email || t('projectLinks.title')}{v.relationship ? ` · ${v.relationship}` : ''}
                </p>
                <p className="text-[11px] text-brand-mid-grey">
                  {t(v.isClient ? 'teamAccess.primaryClient' : 'teamAccess.observer')} · {v.acceptedAt ? t('projectShare.accepted') : t('projectShare.pending')}
                </p>
              </div>
              {(!v.isClient || !v.acceptedAt) && <button type="button" disabled={busy} onClick={() => remove(v.id)}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black dark:hover:text-white">
                <X className="size-3" aria-hidden />{t('projectShare.remove')}
              </button>}
            </li>
          ))}
      </ul>
    </section>
  );
}
