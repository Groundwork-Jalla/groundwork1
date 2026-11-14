import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { projectInvitationLinkPath, type ProjectInvitationLink as InvitationLink, type ProjectInvitationRole } from '@/lib/supabase/project-invitation-links';

/** A project invitation, followed by normal sign-in. This never creates an auth session. */
export function ProjectInvitationLink({ scope, role, link, busy, canCreate, onCreate, onRefresh, primaryContractor = true }: {
  scope: string; role: ProjectInvitationRole; link?: InvitationLink; busy: boolean;
  canCreate: boolean; onCreate: () => void; onRefresh?: () => void;
  primaryContractor?: boolean;
}) {
  const t = useT();
  const url = link ? `${window.location.origin}${projectInvitationLinkPath(role, link.token)}` : '';
  const key = `${scope}:${url}`;
  const current = useRef(key); current.current = key;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [key]);
  useEffect(() => { current.current = key; return () => { current.current = ''; }; }, [key]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(url);
      if (current.current === key) { setCopied(true); setCopyFailed(false); }
    } catch {
      if (current.current === key) { setCopied(false); setCopyFailed(true); }
    }
  }

  if (!link && !canCreate) return null;
  return <div className="mt-4 space-y-2 rounded-xl border border-brand-border-grey bg-brand-off-white p-3 dark:border-[#2c2c2c] dark:bg-[#141414]">
    <p className="text-xs font-semibold">{t('projectLinks.title')}</p>
    <p className="text-xs text-brand-mid-grey">{t('projectLinks.body')}</p>
    <p className="text-xs font-medium">{t(role === 'client' ? 'teamAccess.primaryClient' : role === 'contractor'
      ? primaryContractor ? 'teamAccess.primaryContractor' : 'adminRole.contractor' : 'teamAccess.observer')}</p>
    {link ? <>
      <label className="block text-xs text-brand-mid-grey">
        {t('projectLinks.address')}
        <input aria-label={t('projectLinks.address')} readOnly value={url} onFocus={event => event.currentTarget.select()}
          className="mt-1 w-full rounded-lg border border-brand-border-grey bg-white p-2 font-mono text-xs text-brand-near-black dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white" />
      </label>
      <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => void copy()}>{t(copied ? 'projectLinks.copied' : 'projectShare.copyLink')}</Button>
      {onRefresh && <Button type="button" variant="outline" disabled={busy} className="ml-2 h-8 text-xs" onClick={onRefresh}>{t('projectLinks.refresh')}</Button>}
      {copyFailed && <p role="alert" className="text-xs text-state-alert">{t('projectLinks.copyFailed')}</p>}
    </> : <Button type="button" disabled={busy} className="h-9 text-xs" onClick={onCreate}>
      <Link2 className="mr-1.5 size-3.5" aria-hidden />{t(busy ? 'common.loading' : 'projectLinks.create')}
    </Button>}
  </div>;
}
