import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Download, ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import { listUnifiedAuditLog, type AuditCategory, type UnifiedAuditRow } from '@/lib/supabase/activity';
import { downloadAuditLogCsv, formatAuditLogCsv } from '@/lib/admin/audit-csv';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { EmptyState } from '@/components/ui/EmptyState';
import { actionLabel } from '@/lib/admin/action-labels';
import { workspaceHref } from '@/lib/admin/workspace-params';
import { useAuth } from '@/contexts/AuthContext';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const PAGE = 60;
const CATEGORIES: ('all' | AuditCategory)[] = ['all', 'project', 'finance', 'security', 'deletion'];

const CAT_PILL: Record<AuditCategory, string> = {
  project:  'bg-state-complete/10 text-state-complete',
  finance:  'bg-state-held/15 text-state-held',
  security: 'bg-[#eaf2f8] text-[#26547c] dark:bg-[#1e3142] dark:text-[#93c5fd]',
  deletion: 'bg-state-alert/10 text-state-alert',
};

export default function AdminAuditLog() {
  const t = useT();
  const { lang } = useLanguage();
  const { isAdmin } = useAuth();

  const [rows, setRows] = useState<UnifiedAuditRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<'all' | AuditCategory>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (before?: string, cat: 'all' | AuditCategory = category) => {
    try {
      const page = await listUnifiedAuditLog(PAGE, before, cat);
      setRows(prev => (before ? [...prev, ...page.rows] : page.rows));
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, [t, category]);

  useEffect(() => {
    setLoading(true);
    void load(undefined, category);
  }, [category, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      `${r.actorName} ${r.action} ${actionLabel(r.action, t)} ${r.projectName} ${r.personName} ${r.source}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, t]);

  const selected = useMemo(
    () => filtered.find(r => r.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const stamp = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
  };

  const handleExportCsv = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Pull up to 500 matching rows across pages so the CSV covers more than just the first screen.
      const collected: UnifiedAuditRow[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const res = await listUnifiedAuditLog(200, cursor, category);
        collected.push(...res.rows);
        if (!res.hasMore || res.rows.length === 0) break;
        cursor = res.rows[res.rows.length - 1]?.createdAt;
        if (!cursor) break;
      }
      const q = query.trim().toLowerCase();
      const toExport = q
        ? collected.filter(r =>
            `${r.actorName} ${r.action} ${actionLabel(r.action, t)} ${r.projectName} ${r.personName} ${r.source}`
              .toLowerCase()
              .includes(q),
          )
        : collected;
      const csv = formatAuditLogCsv(toExport, t);
      downloadAuditLogCsv(csv, category);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setExporting(false);
    }
  }, [exporting, category, query, t]);

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8" data-unified-audit-log>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white">
            {t('admin.auditLog.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.auditLog.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-action="export-audit-csv"
            disabled={loading || exporting || filtered.length === 0}
            onClick={() => { void handleExportCsv(); }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey bg-white px-4 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-green hover:text-brand-green disabled:opacity-45 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
            {exporting ? t('admin.auditLog.exporting') : t('admin.auditLog.exportCsv')}
          </button>
          {isAdmin && (
            <Link
              to="/admin/team"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-2 text-xs font-semibold text-white hover:bg-brand-green-hover"
            >
              <ShieldCheck className="size-3.5" aria-hidden />
              {t('admin.auditLog.manageRoles')}
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              data-audit-category={cat}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                category === cat
                  ? 'border-brand-green bg-brand-green text-white'
                  : 'border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
              )}
            >
              {t(`admin.auditLog.categories.${cat}` as TKey)}
            </button>
          ))}
        </div>

        <label className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-muted-grey" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.auditLog.search')}
            aria-label={t('admin.auditLog.search')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          />
        </label>
      </div>

      <p className="text-[11px] text-brand-muted-grey">{t('admin.auditLog.mergingNote')}</p>

      {error && <p role="alert" className="rounded-xl border border-state-alert/30 bg-white px-4 py-3 text-xs text-state-alert dark:bg-[#1e1e1e]">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState title={t('admin.ops.recentEmpty')} description={t('admin.auditLog.emptyBody')} />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Chronological Table */}
          <div className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-brand-border-grey text-[11px] uppercase tracking-wider text-brand-muted-grey dark:border-[#2c2c2c]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">{t('admin.auditLog.colTime')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('admin.auditLog.colCategory')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('admin.auditLog.colEvent')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('admin.auditLog.colActor')}</th>
                    <th className="px-4 py-2.5 font-semibold">{t('admin.auditLog.colTarget')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
                  {filtered.map(r => {
                    const on = r.id === selected?.id;
                    const primaryRole = r.actorRoles.split(',').map(s => s.trim()).find(Boolean);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          on ? 'bg-brand-green/[0.06] shadow-[inset_3px_0_0_var(--color-brand-green)]' : 'hover:bg-brand-off-white dark:hover:bg-[#242424]',
                        )}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-brand-mid-grey" title={r.createdAt}>
                          {stamp(r.createdAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold', CAT_PILL[r.category])}>
                            {t(`admin.auditLog.categories.${r.category}` as TKey)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-brand-near-black dark:text-white">
                          {actionLabel(r.action, t)}
                        </td>
                        <td className="px-3 py-2.5 text-brand-near-black dark:text-white">
                          <span>{r.actorName || t('admin.auditLog.unknownActor')}</span>
                          {primaryRole && (
                            <span className="ml-1.5 rounded bg-brand-light-grey px-1.5 py-px text-[9.5px] font-bold uppercase text-brand-mid-grey dark:bg-[#2a2a2a]">
                              {primaryRole}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-brand-mid-grey">
                          {r.projectName || r.personName || t('admin.ops.noProject')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="border-t border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
                <button
                  type="button"
                  disabled={more}
                  onClick={() => { setMore(true); void load(rows[rows.length - 1]?.createdAt, category); }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3.5 py-1.5 text-xs font-semibold hover:border-brand-near-black disabled:opacity-50 dark:border-[#2c2c2c]"
                >
                  {more && <Loader2 className="size-3.5 animate-spin" />}
                  {t('admin.auditLog.more')}
                </button>
              </div>
            )}
          </div>

          {/* Right Event Inspector */}
          <aside className="sticky top-4 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', CAT_PILL[selected.category])}>
                    {t(`admin.auditLog.categories.${selected.category}` as TKey)}
                  </span>
                  <h2 className="mt-2 text-base font-extrabold text-brand-near-black dark:text-white">
                    {actionLabel(selected.action, t)}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] text-brand-muted-grey">
                    {t('admin.auditLog.source')}: {selected.source}
                  </p>
                </div>

                <dl className="divide-y divide-brand-border-grey border-y border-brand-border-grey text-xs dark:divide-[#2c2c2c] dark:border-[#2c2c2c]">
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-brand-mid-grey">{t('admin.auditLog.colActor')}</dt>
                    <dd className="text-right font-semibold text-brand-near-black dark:text-white">{selected.actorName || t('admin.auditLog.unknownActor')}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-brand-mid-grey">{t('admin.auditLog.colTime')}</dt>
                    <dd className="font-mono text-[11px] text-brand-near-black dark:text-white">{formatRelative(selected.createdAt)}</dd>
                  </div>
                  {selected.projectName && (
                    <div className="flex justify-between gap-3 py-2">
                      <dt className="text-brand-mid-grey">{t('admin.auditLog.colTarget')}</dt>
                      <dd className="font-semibold text-brand-green dark:text-[#b4d8bf]">{selected.projectName}</dd>
                    </div>
                  )}
                </dl>

                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">
                    {t('admin.auditLog.recordedDiff')}
                  </p>
                  <pre className="max-h-56 overflow-auto rounded-xl border border-brand-border-grey bg-brand-off-white p-3 font-mono text-[11px] leading-relaxed text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white">
                    {JSON.stringify({ action: selected.action, ...selected.details }, null, 2)}
                  </pre>
                </div>

                {selected.projectId && (
                  <Link
                    to={workspaceHref(selected.projectId)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold hover:border-brand-near-black dark:border-[#2c2c2c]"
                  >
                    {t('admin.auditLog.openProject')} <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-brand-mid-grey">{t('admin.auditLog.selectEvent')}</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
