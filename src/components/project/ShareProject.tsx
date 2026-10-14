import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Users, X } from 'lucide-react';
import {
  fetchProjectViewers, inviteProjectViewer, revokeProjectViewer,
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchProjectViewers(projectId).then(setRows).catch(() => setRows([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSent(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('projectShare.errEmail')); return; }

    setBusy(true);
    try {
      await inviteProjectViewer(projectId, email.trim(), relationship.trim() || undefined);
      setSent(email.trim());
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
        <div className="space-y-1.5">
          <Label htmlFor="shareEmail" className="text-xs">{t('projectShare.email')}</Label>
          <Input id="shareEmail" type="email" autoComplete="off" value={email}
            onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shareRel" className="text-xs">{t('projectShare.relationship')}</Label>
          <Input id="shareRel" autoComplete="off" value={relationship}
            onChange={e => setRelationship(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="h-9 text-xs">
          {busy ? <Loader2 className="size-4 animate-spin" /> : t('projectShare.invite')}
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] text-brand-mid-grey">{t('projectShare.relationshipHint')}</p>

      {sent  && <p className="mt-3 flex items-center gap-2 text-xs text-state-complete"><Check className="size-3.5" />{t('projectShare.sent', { email: sent })}</p>}
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
