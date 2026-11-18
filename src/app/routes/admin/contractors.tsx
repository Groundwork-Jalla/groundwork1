import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2, Search, BadgeCheck, EyeOff, Eye, Link2, Trash2, UserRound, X, ArrowUpRight } from 'lucide-react';
import {
  listDirectory, setDirectoryActive, deleteDirectoryEntry, type DirectoryEntry,
} from '@/lib/supabase/admin-applications';
import { ConfirmDelete } from '@/components/ui/ConfirmDelete';
import { ContractorOversight } from '@/components/admin/ContractorOversight';
import { matchesQuery } from '@/lib/admin/contractor-oversight';
import { useRoleLabel } from './applications';
import { cn } from '@/lib/utils';
import { useT, useLanguage } from '@/lib/i18n';
import { PublishContractor } from '@/components/admin/PublishContractor';
import { PersonPreview, usePersonPreview } from '@/components/admin/PersonPreview';

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
// Selecting a row (18 Nov redesign: a pane beside the list; under the card on a phone)
// shows what Groundwork holds ABOUT that contractor — assignments,
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

/** Wide screens show the selected contractor beside the list; phones open it under the card. */
function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return wide;
}

export default function AdminContractors() {
  const t = useT();
  const { lang } = useLanguage();
  const tradeLabel = useRoleLabel();      // directory stores the role key; translate it
  const wide = useWide();

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
  // The person behind a listing. A directory row carries no user id, so the preview is
  // opened by its application or its email and resolves the account itself.
  const person = usePersonPreview();
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

  const selected = selectedId ? rows.find(r => r.id === selectedId) ?? null : null;
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

  /** One-click Hide/Publish (Favour, 18 Nov): it stays on the row, not only in the pane. */
  const hideButton = (r: DirectoryEntry, size: 'sm' | 'md' = 'sm') => (
    <button
      type="button" onClick={() => toggle(r)} disabled={busy === r.id}
      className={cn('inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey bg-white font-semibold text-brand-near-black transition-colors hover:border-brand-near-black disabled:opacity-50 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm')}
    >
      {busy === r.id
        ? <Loader2 className="size-3.5 animate-spin" />
        : r.active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {r.active ? t('admin.dir.hide') : t('admin.dir.show')}
    </button>
  );
  const personButton = (r: DirectoryEntry, labelled = false) => (
    <button
      type="button"
      onClick={() => person.open({ applicationId: r.applicationId, email: r.email })}
      aria-label={`${t('admin.person.view')} ${r.name}`}
      title={t('admin.person.view')}
      className={labelled
        ? 'inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white'
        : 'inline-flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-brand-near-black dark:hover:bg-[#252525] dark:hover:text-white'}
    >
      <UserRound className="size-3.5" />{labelled && t('admin.person.view')}
    </button>
  );
  const deleteButton = (r: DirectoryEntry, labelled = false) => (
    <button
      type="button" onClick={() => setTarget(r)}
      aria-label={`${t('admin.del.confirm')} ${r.name}`}
      className={labelled
        ? 'inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm font-semibold text-state-alert transition-colors hover:border-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]'
        : 'inline-flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-off-white hover:text-state-alert dark:hover:bg-[#252525]'}
    >
      <Trash2 className="size-3.5" />{labelled && t('admin.del.confirm')}
    </button>
  );
  const nameLine = (r: DirectoryEntry) => (
    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-brand-near-black dark:text-white">
      <span className="truncate">{r.name}</span>
      {r.verified && <BadgeCheck className="size-3.5 shrink-0 text-state-complete" aria-label={t('admin.dir.verified')} />}
      {r.applicationId && <Link2 className="size-3 shrink-0 text-brand-mid-grey" aria-label={t('admin.dir.fromApplication')} />}
    </span>
  );
  const experience = (r: DirectoryEntry) => (
    <>
      {t('admin.dir.yearsValue', { years: r.yearsExp })}
      {/* Self-reported on the application form, so it is labelled as that
          and never as work completed on Groundwork. */}
      {r.completedProjects > 0 && (
        <span className="ml-1.5 text-xs" title={t('admin.dir.listedHint')}>
          · {t('admin.dir.listedValue', { count: r.completedProjects })}
        </span>
      )}
    </>
  );
  const visibility = (r: DirectoryEntry) => (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold',
      r.active ? 'text-state-complete' : 'text-brand-mid-grey')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', r.active ? 'bg-state-complete' : 'bg-state-locked')} />
      {r.active ? t('admin.dir.live') : t('admin.dir.hidden')}
    </span>
  );

  /** What Groundwork holds about the selected contractor — beside the list, or under the card on a phone. */
  const pane = (r: DirectoryEntry) => (
    <div>
      <div className="border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {visibility(r)}
            <h2 className="mt-1.5 flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight text-brand-near-black dark:text-white">
              {r.name}
              {r.verified && <span className="rounded-full bg-state-complete/10 px-2 py-0.5 text-xs font-semibold text-state-complete">{t('admin.dir.verified')}</span>}
            </h2>
            <p className="mt-0.5 text-sm text-brand-mid-grey">
              {[tradeLabel(r.trade), r.location, t('admin.dir.yearsValue', { years: r.yearsExp })].filter(Boolean).join(' · ')}
              {' · '}{t('admin.peopleUi.addedOn', { date: fmt(r.createdAt) })}
            </p>
          </div>
          <button type="button" onClick={() => put('contractor', null)} aria-label={t('common.close')}
            className="-m-1 shrink-0 rounded-lg p-1 text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {hideButton(r, 'md')}
          {personButton(r, true)}
          <span className="ml-auto">{deleteButton(r, true)}</span>
        </div>
      </div>
      <ContractorOversight contractor={r} />
    </div>
  );

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-brand-mid-grey">
            {t('nav.sectionPeople')} · <span className="font-semibold text-brand-near-black dark:text-white">{t('nav.contractors')}</span>
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-[28px]">{t('admin.dir.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.dir.subtitle')}</p>
        </div>
        <Link to="/admin/applications"
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey bg-white px-3.5 py-2 text-sm font-semibold text-brand-near-black transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          {t('nav.applications')}<ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </header>

      {/* Contractors with an account the directory cannot show (111). Renders nothing
          when there are none. */}
      <PublishContractor />

      {!loading && !error && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-brand-light-grey p-1 dark:bg-[#252525]">
            <Chip active={!onlyInactive} onClick={() => setOnlyInactive(false)}>
              {t('admin.dir.filterAll')} · {rows.length}
            </Chip>
            <Chip active={onlyInactive} onClick={() => setOnlyInactive(true)}>
              {t('admin.dir.filterHidden')} · {inactiveCount}
            </Chip>
          </div>
          <div className="relative ml-auto w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.dir.search')} aria-label={t('admin.dir.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
            />
          </div>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-brand-border-grey bg-white py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {rows.length === 0 ? t('admin.dir.empty') : t('admin.dir.emptyFiltered')}
        </p>
      ) : (
        <div className={cn('grid items-start gap-4', selected && wide && 'lg:grid-cols-[minmax(0,1fr)_25rem]')}>
          <div className="overflow-hidden rounded-2xl lg:border lg:border-brand-border-grey lg:bg-white lg:dark:border-[#2c2c2c] lg:dark:bg-[#1e1e1e]">
            {/* Wide: a table. Phone: one card per contractor, the same facts and actions. */}
            <div className="hidden lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-brand-border-grey bg-brand-off-white dark:border-[#2c2c2c]">
                  <tr className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                    <th scope="col" className="px-4 py-3">{t('admin.dir.colName')}</th>
                    <th scope="col" className="px-4 py-3">{t('admin.dir.colTrade')} · {t('admin.dir.colLocation')}</th>
                    <th scope="col" className="px-4 py-3">{t('admin.dir.colExperience')}</th>
                    <th scope="col" className="px-4 py-3">{t('admin.dir.colVisibility')}</th>
                    <th scope="col" className="px-4 py-3">{t('admin.dir.colAdded')}</th>
                    <th className="w-40" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                  {filtered.map(r => {
                    const on = r.id === selectedId;
                    return (
                      <tr key={r.id} className={cn('transition-colors',
                        on ? 'bg-[#f3f6f4] shadow-[inset_3px_0_0_var(--color-brand-green)] dark:bg-[#1c2620]' : 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
                        !r.active && 'opacity-55')}>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => put('contractor', on ? null : r.id)}
                            aria-expanded={on}
                            className="flex min-w-0 items-center gap-3 text-left"
                          >
                            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-light-grey text-[11px] font-semibold text-brand-mid-grey dark:bg-[#2c2c2c]">{initials(r.name)}</span>
                            <span className="min-w-0">
                              {nameLine(r)}
                              <span className="block truncate text-xs text-brand-mid-grey">{r.email ?? '—'}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-brand-near-black dark:text-white">{tradeLabel(r.trade)}</span>
                          <span className="block text-xs text-brand-mid-grey">{r.location || '—'}</span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-brand-mid-grey">{experience(r)}</td>
                        <td className="px-4 py-3">{visibility(r)}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-brand-mid-grey">{fmt(r.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {hideButton(r)}
                            {personButton(r)}
                            {deleteButton(r)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2.5 lg:hidden">
              {filtered.map(r => {
                const on = r.id === selectedId;
                return (
                  <li key={r.id} className={cn('overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]', !r.active && !on && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-3 p-4">
                      <button type="button" onClick={() => put('contractor', on ? null : r.id)} aria-expanded={on} className="min-w-0 text-left">
                        {nameLine(r)}
                        <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">{[tradeLabel(r.trade), r.location].filter(Boolean).join(' · ')}</span>
                        <span className="mt-0.5 block text-xs text-brand-mid-grey">{experience(r)}</span>
                      </button>
                      {visibility(r)}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-brand-border-grey px-4 py-2.5 dark:border-[#2c2c2c]">
                      <span className="text-xs text-brand-mid-grey">{fmt(r.createdAt)}</span>
                      <span className="flex items-center gap-1">{hideButton(r)}{personButton(r)}{deleteButton(r)}</span>
                    </div>
                    {on && !wide && <div className="border-t border-brand-border-grey dark:border-[#2c2c2c]">{pane(r)}</div>}
                  </li>
                );
              })}
            </ul>

            {/* What the two marks and "listed" mean, said once under the table. */}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 text-xs text-brand-mid-grey lg:border-t lg:border-brand-border-grey lg:px-4 lg:dark:border-[#2c2c2c]">
              <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3.5" aria-hidden />{t('admin.dir.verified')}</span>
              <span className="inline-flex items-center gap-1"><Link2 className="size-3" aria-hidden />{t('admin.dir.fromApplication')}</span>
              <span>{t('admin.peopleUi.listedLegend')}</span>
            </p>
          </div>

          {selected && wide && (
            <aside className="sticky top-4 overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              {pane(selected)}
            </aside>
          )}
        </div>
      )}
      <PersonPreview reference={person.ref} rolesHint={person.rolesHint} onClose={person.close} />
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
      className={cn('rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors',
        active
          ? 'bg-white text-brand-near-black shadow-sm dark:bg-[#1e1e1e] dark:text-white'
          : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
      {children}
    </button>
  );
}
