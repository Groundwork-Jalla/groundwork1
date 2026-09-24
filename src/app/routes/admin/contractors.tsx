import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2, Search, BadgeCheck, EyeOff, Eye, Link2, Trash2, ChevronRight } from 'lucide-react';
import {
  listDirectory, setDirectoryActive, deleteDirectoryEntry, type DirectoryEntry,
} from '@/lib/supabase/admin-applications';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { ContractorOversight } from '@/components/admin/ContractorOversight';
import { matchesQuery } from '@/lib/admin/contractor-oversight';
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
//
// ── And, since slice 15, the oversight surface ──────────────────────────────────────
// Expanding a row shows what Groundwork holds ABOUT that contractor — assignments,
// verification history on those projects, evidence they filed, money recorded as owed to
// them. Reads and links only: an admin manages the actor here and performs no work as
// them. /work is where a contractor works.
//
// Two columns on this table are NOT performance measures and are labelled accordingly.
// `completed_projects` is `jsonb_array_length(application.projects)` (033) — the jobs the
// applicant typed into their own form before joining, not work done here. `rating` and
// `review_count` have no writer anywhere and are permanently 0, so they are not shown at
// all. See src/lib/admin/contractor-oversight.ts.
// =========================================================

export default function AdminContractors() {
  const t = useT();
  const { lang } = useLanguage();
  const tradeLabel = useRoleLabel();      // directory stores the role key; translate it

  const [rows, setRows]       = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState<string | null>(null);
  // `?q=` so a deep link — the Quote Requests contractor link among them — opens the
  // directory already searched. One implementation: the box writes the URL and the URL
  // is the only source the filter reads, so the two cannot drift apart.
  const [params, setParams]   = useSearchParams();
  const query = params.get('q') ?? '';
  const selectedId = params.get('contractor');
  const put = useCallback((key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value === null || value === '') p.delete(key); else p.set(key, value);
    setParams(p, { replace: true });
  }, [params, setParams]);
  const setQuery = useCallback((v: string) => put('q', v), [put]);
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [target, setTarget]     = useState<DirectoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true); setDelError(null);
    try {
      await deleteDirectoryEntry(target.id);
      setRows(prev => prev.filter(r => r.id !== target.id));
      setTarget(null);
    } catch {
      setDelError(t('admin.del.failed'));
    } finally {
      setDeleting(false);
    }
  }

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

  const filtered = useMemo(() => rows.filter(r => {
    if (onlyInactive && r.active) return false;
    // The trade is stored as a role key and shown translated, so the translated word is
    // what a person would type — it is matched as well as the stored fields.
    return matchesQuery({ ...r, trade: tradeLabel(r.trade) }, query)
        || matchesQuery(r, query);
  }), [rows, query, onlyInactive, tradeLabel]);

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
                <th className="w-36" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border-grey">
              {filtered.map(r => (
                <Fragment key={r.id}>
                <tr className={cn('transition-colors hover:bg-brand-off-white', !r.active && 'opacity-55')}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => put('contractor', r.id === selectedId ? null : r.id)}
                      aria-expanded={r.id === selectedId}
                      className="flex items-center gap-1.5 text-left font-medium text-brand-near-black"
                    >
                      <ChevronRight className={cn('size-3.5 shrink-0 text-brand-mid-grey transition-transform', r.id === selectedId && 'rotate-90')} aria-hidden />
                      {r.name}
                      {r.verified && <BadgeCheck className="size-3.5 shrink-0 text-state-complete" aria-label={t('admin.dir.verified')} />}
                      {r.applicationId && <Link2 className="size-3 shrink-0 text-brand-mid-grey" aria-label={t('admin.dir.fromApplication')} />}
                    </button>
                    <p className="ml-5 text-xs text-brand-mid-grey">{r.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-brand-mid-grey">{tradeLabel(r.trade)}</td>
                  <td className="px-4 py-3 text-brand-mid-grey">{r.location || '—'}</td>
                  <td className="px-4 py-3 text-brand-mid-grey tabular-nums">
                    {t('admin.dir.yearsValue', { years: r.yearsExp })}
                    {/* Self-reported on the application form, so it is labelled as that
                        and never as work completed on Groundwork. */}
                    {r.completedProjects > 0 && (
                      <span className="ml-1.5 text-xs" title={t('admin.dir.listedHint')}>
                        · {t('admin.dir.listedValue', { count: r.completedProjects })}
                      </span>
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
                    <button
                      type="button" onClick={() => setTarget(r)}
                      aria-label={`${t('admin.del.confirm')} ${r.name}`}
                      className="ml-1 inline-flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
                {r.id === selectedId && (
                  <tr className="bg-brand-off-white/40">
                    <td colSpan={7} className="p-0">
                      <ContractorOversight contractor={r} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDelete
        open={!!target}
        subject={target?.name ?? ''}
        consequence={t('admin.dir.deleteHint')}
        busy={deleting}
        error={delError}
        onConfirm={confirmDelete}
        onCancel={() => { setTarget(null); setDelError(null); }}
      />
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
