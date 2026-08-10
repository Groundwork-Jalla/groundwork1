import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Search, ArrowUpRight, CloudOff, Cloud } from 'lucide-react';
import {
  listApplications, APPLICATION_STATUSES,
  type ApplicationSummary, type ApplicationStatus,
} from '@/lib/supabase/admin-applications';
import { cn } from '@/lib/utils';
import { useT, useLanguage, type TKey } from '@/lib/i18n';

// =========================================================
// /admin/applications
//
// Until now nothing in the app read `contractor_applications` — /admin/contractors
// shows the approved `contractors` directory, a different table. Applications landed
// in Supabase and could only be read from the SQL editor.
//
// This is also the list half of the URL that api/ghl/contractor.ts puts in every CRM
// record (`application_url`), so the detail route below it has to keep that path.
// =========================================================

/**
 * Status colour follows the state tokens, and `disqualified` is intentionally the
 * locked/grey one rather than the alert red: they screened themselves out on a
 * standards question, which is not the same event as being rejected on review.
 */
const STATUS_STYLE: Record<ApplicationStatus, string> = {
  pending:      'text-state-held',
  reviewing:    'text-state-active',
  accepted:     'text-state-complete',
  rejected:     'text-state-alert',
  disqualified: 'text-brand-mid-grey',
};

const STATUS_DOT: Record<ApplicationStatus, string> = {
  pending:      'bg-state-held',
  reviewing:    'bg-state-active',
  accepted:     'bg-state-complete',
  rejected:     'bg-state-alert',
  disqualified: 'bg-state-locked',
};

export function StatusPill({ status }: { status: ApplicationStatus }) {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', STATUS_STYLE[status])}>
      {/* State is a dot plus the figure's own colour — never a tinted pill. */}
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
      {t(`admin.status.${status}` as TKey)}
    </span>
  );
}

/**
 * Formatted in the VIEWER's language, not `application.lang`. The stored language is
 * what the applicant filled the form in — it decides which language we email them in,
 * not how an admin reads a date. Keying off it made one row in an English table read
 * "5 août 2026".
 */
function fmtDate(iso: string, lang: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `role` is a stored enum. The public form already translates these under
 * contractorApply.form.role.*, so reuse them rather than showing `general_contractor`.
 * `role_other` is free text and has no key — fall back to the raw value.
 */
export function useRoleLabel() {
  const t = useT();
  return (role: string) => {
    const key = `contractorApply.form.role.${role}` as TKey;
    const label = t(key);
    return label === key ? role : label;
  };
}

export default function AdminApplications() {
  const t = useT();
  const { lang } = useLanguage();
  const roleLabel = useRoleLabel();
  const [apps, setApps]       = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<ApplicationStatus | 'all'>('all');

  useEffect(() => {
    let alive = true;
    listApplications()
      .then(rows => { if (alive) setApps(rows); })
      .catch(()  => { if (alive) setError(t('admin.apps.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter(a => {
      if (filter !== 'all' && a.status !== filter) return false;
      if (!q) return true;
      return [a.fullName, a.email, a.businessName ?? '', a.city, a.country]
        .some(v => v.toLowerCase().includes(q));
    });
  }, [apps, query, filter]);

  const counts = useMemo(() => {
    const m = {} as Record<ApplicationStatus, number>;
    for (const s of APPLICATION_STATUSES) m[s] = 0;
    for (const a of apps) m[a.status] += 1;
    return m;
  }, [apps]);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.apps.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.apps.subtitle')}</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            {t('admin.apps.filterAll')} · {apps.length}
          </FilterChip>
          {APPLICATION_STATUSES.map(s => (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {t(`admin.status.${s}` as TKey)} · {counts[s]}
            </FilterChip>
          ))}
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.apps.search')}
            aria-label={t('admin.apps.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
          />
        </div>
      </div>

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
          {apps.length === 0 ? t('admin.apps.empty') : t('admin.apps.emptyFiltered')}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-brand-mid-grey">
            {t('admin.apps.count', { shown: filtered.length, total: apps.length })}
          </p>

          {/* Wide content in its own scroller — the page body never scrolls sideways. */}
          <div className="overflow-x-auto rounded-xl border border-brand-border-grey">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-brand-border-grey bg-brand-off-white">
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
                  <Th>{t('admin.apps.colApplicant')}</Th>
                  <Th>{t('admin.apps.colRole')}</Th>
                  <Th>{t('admin.apps.colLocation')}</Th>
                  <Th>{t('admin.apps.colStatus')}</Th>
                  <Th>{t('admin.apps.colCrm')}</Th>
                  <Th>{t('admin.apps.colSubmitted')}</Th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border-grey">
                {filtered.map(a => (
                  <tr key={a.id} className="transition-colors hover:bg-brand-off-white">
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-near-black">{a.fullName}</p>
                      <p className="text-xs text-brand-mid-grey">{a.businessName ?? a.email}</p>
                    </td>
                    <td className="px-4 py-3 text-brand-mid-grey">{roleLabel(a.role)}</td>
                    <td className="px-4 py-3 text-brand-mid-grey">{a.city}, {a.country}</td>
                    <td className="px-4 py-3"><StatusPill status={a.status} /></td>
                    <td className="px-4 py-3">
                      {a.syncedToGhl ? (
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
                      {fmtDate(a.createdAt, lang)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/applications/${a.id}`}
                        aria-label={t('admin.apps.open')}
                        className="inline-flex size-7 items-center justify-center rounded-lg text-brand-mid-grey transition-colors hover:bg-brand-light-grey hover:text-brand-near-black"
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="px-4 py-2.5 font-semibold">{children}</th>;
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
