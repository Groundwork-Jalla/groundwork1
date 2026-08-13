import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, BadgeCheck, EyeOff, Eye, Link2 } from 'lucide-react';
import {
  listDirectory, setDirectoryActive, type DirectoryEntry,
} from '@/lib/supabase/admin-applications';
import { useRoleLabel } from './applications';
import { cn } from '@/lib/utils';
import { useT, useLanguage } from '@/lib/i18n';

// =========================================================
// /admin/contractors — the published directory.
//
// This page used to query full_name, years_experience, city, country and status off
// `contractors`. None of those are columns on it — the real ones are name, years_exp,
// location — so every request 400'd, and because the page destructured only `data` it
// rendered "0 pending · 0 total" instead of an error. It was also mislabelled
// "Contractor Applications": applications live in contractor_applications and have
// their own screen at /admin/applications.
//
// This is the directory clients browse. Entries arrive by being accepted on an
// application, which calls admin_promote_application() (migration 033).
// =========================================================

export default function AdminContractors() {
  const t = useT();
  const { lang } = useLanguage();
  const tradeLabel = useRoleLabel();      // directory stores the role key; translate it

  const [rows, setRows]       = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [onlyInactive, setOnlyInactive] = useState(false);

  useEffect(() => {
    let alive = true;
    listDirectory()
      .then(r  => { if (alive) setRows(r); })
      .catch(() => { if (alive) setError(t('admin.dir.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  async function toggle(entry: DirectoryEntry) {
    setBusy(entry.id);
    try {
      await setDirectoryActive(entry.id, !entry.active);
      setRows(prev => prev.map(r => r.id === entry.id ? { ...r, active: !r.active } : r));
    } catch {
      setError(t('admin.dir.updateFailed'));
    } finally {
      setBusy(null);
    }
  }

  const inactiveCount = useMemo(() => rows.filter(r => !r.active).length, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (onlyInactive && r.active) return false;
      if (!q) return true;
      return [r.name, r.location, r.email ?? '', tradeLabel(r.trade)]
        .some(v => v.toLowerCase().includes(q));
    });
  }, [rows, query, onlyInactive, tradeLabel]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.dir.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.dir.subtitle')}</p>
      </header>

      {!loading && !error && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Chip active={!onlyInactive} onClick={() => setOnlyInactive(false)}>
              {t('admin.dir.filterAll')} · {rows.length}
            </Chip>
            <Chip active={onlyInactive} onClick={() => setOnlyInactive(true)}>
              {t('admin.dir.filterHidden')} · {inactiveCount}
            </Chip>
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.dir.search')} aria-label={t('admin.dir.search')}
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
          {rows.length === 0 ? t('admin.dir.empty') : t('admin.dir.emptyFiltered')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-border-grey">
          <table className="w-full min-w-4xl text-left text-sm">
            <thead className="border-b border-brand-border-grey bg-brand-off-white">
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colName')}</th>
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colTrade')}</th>
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colLocation')}</th>
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colExperience')}</th>
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colVisibility')}</th>
                <th scope="col" className="px-4 py-2.5">{t('admin.dir.colAdded')}</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(r => (
                <tr key={r.id} className={cn('transition-colors hover:bg-brand-off-white', !r.active && 'opacity-55')}>
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-1.5 font-medium text-brand-near-black">
                      {r.name}
                      {r.verified && <BadgeCheck className="size-3.5 shrink-0 text-state-complete" aria-label={t('admin.dir.verified')} />}
                      {r.applicationId && <Link2 className="size-3 shrink-0 text-brand-mid-grey" aria-label={t('admin.dir.fromApplication')} />}
                    </p>
                    <p className="text-xs text-brand-mid-grey">{r.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey">{tradeLabel(r.trade)}</td>
                  <td className="px-4 py-3 text-brand-mid-grey">{r.location || '—'}</td>
                  <td className="px-4 py-3 text-brand-mid-grey tabular-nums">
                    {t('admin.dir.yearsValue', { years: r.yearsExp })}
                    {r.completedProjects > 0 && (
                      <span className="ml-1.5 text-xs">· {t('admin.dir.projectsValue', { count: r.completedProjects })}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium',
                      r.active ? 'text-state-complete' : 'text-brand-mid-grey')}>
                      <span className={cn('size-1.5 shrink-0 rounded-full', r.active ? 'bg-state-complete' : 'bg-state-locked')} />
                      {r.active ? t('admin.dir.live') : t('admin.dir.hidden')}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-brand-mid-grey tabular-nums">{fmt(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button" onClick={() => toggle(r)} disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-50"
                    >
                      {busy === r.id
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : r.active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {r.active ? t('admin.dir.hide') : t('admin.dir.show')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand-near-black bg-brand-near-black text-white'
          : 'border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black')}>
      {children}
    </button>
  );
}
