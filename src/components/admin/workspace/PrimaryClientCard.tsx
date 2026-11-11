import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useT } from '@/lib/i18n';
import { fetchProjectViewers, type ProjectViewer } from '@/lib/supabase/project-viewers';
import { setProjectClient } from '@/lib/supabase/project-team';

/** Staff can promote an accepted observer; invitation forms cannot change roles. */
export function PrimaryClientCard({ projectId, ownerClientName, onChanged, onNotice }: {
  projectId: string; ownerClientName?: string | null; onChanged: () => void; onNotice: (message: string) => void;
}) {
  const t = useT();
  const current = useRef(projectId);
  current.current = projectId;
  const [rows, setRows] = useState<ProjectViewer[] | null>(null);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<ProjectViewer | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const load = useCallback(async () => {
    try {
      const viewers = await fetchProjectViewers(projectId);
      if (current.current !== projectId) return;
      setRows(viewers); setError(false);
    } catch { if (current.current === projectId) setError(true); }
  }, [projectId]);
  useEffect(() => {
    current.current = projectId;
    setRows(null); setTarget(null); setError(false); setBusy(false); working.current = false;
    void load();
    return () => { current.current = ''; };
  }, [load]);

  async function change() {
    if (!target || working.current || current.current !== projectId) return;
    working.current = true; setBusy(true); setError(false);
    try {
      await setProjectClient(target.id);
      if (current.current !== projectId) return;
      setTarget(null); onNotice(t('teamAccess.clientChanged')); onChanged();
      await load();
    } catch { if (current.current === projectId) setError(true); }
    finally { if (current.current === projectId) { working.current = false; setBusy(false); } }
  }

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('teamAccess.adminClientTitle')}</h2>
      <p className="mt-1 text-xs text-brand-mid-grey">{t('teamAccess.adminClientBody')}</p>
      {rows !== null && !rows.some(viewer => viewer.isClient) && ownerClientName !== undefined && <p className="mt-3 text-xs text-brand-near-black dark:text-white">
        {ownerClientName ? `${t('teamAccess.primaryClient')} · ${ownerClientName}` : t('teamAccess.awaitingClient')}
      </p>}
      {rows === null ? !error && <p className="mt-3 text-xs text-brand-mid-grey">{t('common.loading')}</p> : (
        <ul className="mt-4 space-y-3">
          {rows.length === 0 && <li className="text-xs text-brand-mid-grey">{t('teamAccess.noViewers')}</li>}
          {rows.map(viewer => (
            <li key={viewer.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="min-w-0 break-all text-brand-near-black dark:text-white">
                {viewer.email}{' · '}{t(viewer.isClient ? 'teamAccess.primaryClient' : 'teamAccess.observer')}
                {!viewer.acceptedAt && ` · ${t('projectShare.pending')}`}
              </span>
              {viewer.acceptedAt && !viewer.isClient && <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => setTarget(viewer)}>{t('teamAccess.makeClient')}</Button>}
            </li>
          ))}
        </ul>
      )}
      {error && <div role="alert" className="mt-3 text-xs text-state-alert">
        <p>{t('teamAccess.changeFailed')}</p>
        <Button type="button" variant="outline" className="mt-2 h-8 text-xs" onClick={() => { void load(); }}>{t('common.retry')}</Button>
      </div>}
      <ConfirmModal open={target !== null} title={t('teamAccess.clientConfirmTitle')}
        description={t('teamAccess.clientConfirmBody', { email: target?.email ?? '' })}
        confirmLabel={t('teamAccess.makeClient')} cancelLabel={t('common.cancel')}
        loading={busy} onConfirm={change} onCancel={() => { if (!busy) setTarget(null); }} />
    </section>
  );
}
