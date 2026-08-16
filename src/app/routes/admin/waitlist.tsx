import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Cloud, CloudOff, Trash2 } from 'lucide-react';
import { listWaitlist, deleteWaitlistEntry, type WaitlistEntry } from '@/lib/supabase/admin-applications';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { cn } from '@/lib/utils';
import { useT, useLanguage } from '@/lib/i18n';

// =========================================================
// /admin/waitlist
//
// `waitlist_emails` is the private table — email and nothing else. The public
// `waitlist_members` table (name + location) drives the landing-page ticker and is
// not shown here; it is a different, deliberately non-identifying record.
//
// The CRM column is the point of this screen as much as the list is. The GHL mirror
// never ran in production until today, so every existing row is unforwarded, and
// `synced_to_ghl` is how you find them.
// =========================================================

export default function AdminWaitlist() {
  const t = useT();
  const { lang } = useLanguage();

  const [rows, setRows]       = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [onlyUnsynced, setOnlyUnsynced] = useState(false);
  const [target, setTarget]   = useState<WaitlistEntry | null>(null);
  const [busy, setBusy]       = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!target) return;
    setBusy(true); setDelError(null);
    try {
      await deleteWaitlistEntry(target.id);
      setRows(prev => prev.filter(r => r.id !== target.id));
      setTarget(null);
    } catch {
      setDelError(t('admin.del.failed'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    listWaitlist()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.wait.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  const unsyncedCount = useMemo(() => rows.filter(r => !r.syncedToGhl).length, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (onlyUnsynced && r.syncedToGhl) return false;
      return !q || r.email.toLowerCase().includes(q);
    });
  }, [rows, query, onlyUnsynced]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.wait.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.wait.subtitle')}</p>
      </header>

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={!onlyUnsynced} onClick={() => setOnlyUnsynced(false)}>
              {t('admin.wait.filterAll')} · {rows.length}
            </Chip>
            <Chip active={onlyUnsynced} onClick={() => setOnlyUnsynced(true)}>
              {t('admin.wait.filterUnsynced')} · {unsyncedCount}
            </Chip>
          </div>

          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.wait.search')}
              aria-label={t('admin.wait.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
            />
          </div>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-brand-mid-grey">
          {rows.length === 0 ? t('admin.wait.empty') : t('admin.wait.emptyFiltered')}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-brand-mid-grey">
            {t('admin.wait.total', { count: rows.length })}
            {unsyncedCount > 0 && <> · {t('admin.wait.unsynced', { count: unsyncedCount })}</>}
          </p>

          <div className="overflow-x-auto rounded-xl border border-brand-border-grey">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-brand-border-grey bg-brand-off-white">
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                  <th scope="col" className="px-4 py-2.5">{t('admin.wait.colEmail')}</th>
                  <th scope="col" className="px-4 py-2.5">{t('admin.wait.colLang')}</th>
                  <th scope="col" className="px-4 py-2.5">{t('admin.wait.colCrm')}</th>
                  <th scope="col" className="px-4 py-2.5">{t('admin.wait.colJoined')}</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border-grey">
                {filtered.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-brand-off-white">
                    <td className="px-4 py-3">
                      <a href={`mailto:${r.email}`} className="text-brand-near-black underline underline-offset-2 hover:opacity-70">
                        {r.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium uppercase text-brand-mid-grey">
                      {r.lang}
                    </td>
                    <td className="px-4 py-3">
                      {r.syncedToGhl ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-brand-mid-grey">
                          <Cloud className="size-3.5" /> {t('admin.apps.synced')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-state-held">
                          <CloudOff className="size-3.5" /> {t('admin.apps.notSynced')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-brand-mid-grey tabular-nums">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button" onClick={() => setTarget(r)}
                        aria-label={`${t('admin.del.confirm')} ${r.email}`}
                        className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ConfirmDelete
        open={!!target}
        subject={target?.email ?? ''}
        busy={busy}
        error={delError}
        onConfirm={confirmDelete}
        onCancel={() => { setTarget(null); setDelError(null); }}
      />
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-near-black bg-brand-near-black text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
      )}
    >
      {children}
    </button>
  );
}
