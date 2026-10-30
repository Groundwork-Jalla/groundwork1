import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Users, X } from 'lucide-react';
import {
  fetchProjectViewers, inviteProjectViewer, revokeProjectViewer,
  sendShareInviteEmail, shareLinkFor,
  ShareFailed, type ProjectViewer,
} from '@/lib/supabase/project-viewers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

// =========================================================
// The owner shares their build with their family (112).
//
// Shown only to the person whose project it is. Not to an admin, and not to a contractor:
// who may see somebody's finances is that person's decision, and a contractor inviting a
// client's relatives would be plainly wrong.
//
// Everything it grants is read. The copy says so, because the people being invited are
// often not Groundwork users and the honest question in their head is "what am I agreeing
// to look after?" — the answer is nothing.
// =========================================================

export function ShareProject({ projectId }: { projectId: string }) {
  const t = useT();
  const [rows, setRows] = useState<ProjectViewer[] | null>(null);
  const [email, setEmail]               = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy]   = useState(false);
  const [sent, setSent]   = useState<string | null>(null);
  // Set only when the row was written but the email did not go out. The invitation is
  // real either way, so the owner is given the link rather than an apology.
  const [fallback, setFallback] = useState<{ email: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchProjectViewers(projectId).then(setRows).catch(() => setRows([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSent(null); setFallback(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('projectShare.errEmail')); return; }

    setBusy(true);
    try {
      const address = email.trim();
      // Two steps that fail independently. The row is what grants access and what the
      // link is keyed on; the email is how they find out. This panel used to do only
      // the first and report the second, so everyone invited since 112 shipped was
      // told mail had gone out when none ever had.
      const token = await inviteProjectViewer(projectId, address, relationship.trim() || undefined);
      const delivered = await sendShareInviteEmail(token);
      if (delivered) setSent(address);
      else setFallback({ email: address, link: shareLinkFor(token) });
      setEmail(''); setRelationship('');
      load();
    } catch (err) {
      const code = err instanceof ShareFailed ? err.code : '';
      setError(code === 'self_invite' ? t('projectShare.errSelf')
             : code === 'invalid_email' ? t('projectShare.errEmail')
             : t('projectShare.errFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try { await revokeProjectViewer(id); load(); }
    catch { setError(t('projectShare.errFailed')); }
  }

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <Users className="size-4 shrink-0" aria-hidden />{t('projectShare.title')}
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">{t('projectShare.body')}</p>

      <form onSubmit={invite} noValidate className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {/* Name, then email address. 30 Oct 2026, Philip: "the question we should be
            asking here is the client's name and client's email address — I don't
            know what who they are is for." The column still stores a relationship
            for older rows; new invitations put the client's name in it, which is
            what the list and the invitation email both read. */}
        <div className="space-y-1.5">
          <Label htmlFor="shareRel" className="text-xs">{t('projectShare.relationship')}</Label>
          <Input id="shareRel" autoComplete="off" value={relationship}
            onChange={e => setRelationship(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shareEmail" className="text-xs">{t('projectShare.email')}</Label>
          <Input id="shareEmail" type="email" autoComplete="off" value={email}
            onChange={e => setEmail(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="h-9 text-xs">
          {busy ? <Loader2 className="size-4 animate-spin" /> : t('projectShare.invite')}
        </Button>
      </form>
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

      <ul className="mt-4 space-y-2">
        {rows === null ? null
          : rows.length === 0 ? <li className="text-xs text-brand-mid-grey">{t('projectShare.none')}</li>
          : rows.map(v => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border-grey px-3 py-2 dark:border-[#2c2c2c]">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-brand-near-black dark:text-white">
                  {v.email}{v.relationship ? ` · ${v.relationship}` : ''}
                </p>
                <p className="text-[11px] text-brand-mid-grey">
                  {v.acceptedAt ? t('projectShare.accepted') : t('projectShare.pending')}
                </p>
              </div>
              <button type="button" onClick={() => remove(v.id)}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black dark:hover:text-white">
                <X className="size-3" aria-hidden />{t('projectShare.remove')}
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}
