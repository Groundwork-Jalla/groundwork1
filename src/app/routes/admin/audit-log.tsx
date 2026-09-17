import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import { listAuditLog, type AuditRow } from '@/lib/supabase/activity';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { EmptyState } from '@/components/ui/EmptyState';
import { actionLabel } from '@/lib/admin/action-labels';
import { useT, useLanguage } from '@/lib/i18n';

// =========================================================
// /admin/audit-log — what "See all" on the Overview's Recent activity opens.
//
// It exists because the alternative was worse: the rail showed five rows and its See all
// went to a placeholder, which is the dead-end navigation the Overview is not allowed to
// have. This is the same table, unlimited, paged.
//
// READ ONLY, and structurally so — the browser cannot write `project_audit_log` at all
// since 089 (the owner/admin INSERT policies were dropped). A row exists here because a
// SECURITY DEFINER function wrote it in the same transaction as the change it describes.
// =========================================================

const PAGE = 50;

export default function AdminAuditLog() {
  const t = useT();
  const { lang } = useLanguage();
  const [rows, setRows]       = useState<AuditRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    try {
      const page = await listAuditLog(PAGE, before);
      setRows(prev => (before ? [...prev, ...page.rows] : page.rows));
      setHasMore(page.hasMore);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const stamp = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB',
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('admin.auditLog.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.auditLog.subtitle')}</p>
      </header>

      {error && <p role="alert" className="mb-4 text-sm text-state-alert">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.ops.recentEmpty')} description={t('admin.auditLog.emptyBody')} />
      ) : (
        <>
          <ul className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {rows.map(r => {
              const verb = actionLabel(r.action, t);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-brand-border-grey px-5 py-3 last:border-b-0 dark:border-[#2c2c2c]">
                  <span className="text-sm text-brand-near-black dark:text-white">
                    {/* An actor with no readable account shows as "—", not as a guess. */}
                    <span className="font-medium">{r.actorName || t('admin.auditLog.unknownActor')}</span> {verb}
                  </span>
                  {r.personName && (
                    <span className="text-xs text-brand-mid-grey">· {r.personName}</span>
                  )}
                  {r.projectId ? (
                    <Link to={`/projects/${r.projectId}`} target="_blank"
                      className="text-xs text-brand-mid-grey underline-offset-2 transition-colors hover:text-brand-near-black hover:underline dark:hover:text-white">
                      {r.projectName || r.projectId.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-xs text-brand-mid-grey">{t('admin.ops.noProject')}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-brand-muted-grey" title={stamp(r.createdAt)}>
                    {formatRelative(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <button
              type="button"
              disabled={more}
              onClick={() => { setMore(true); load(rows.at(-1)?.createdAt); }}
              className="mt-4 rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-semibold text-brand-near-black transition-colors hover:border-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:border-white/40"
            >
              {more ? t('common.loading') : t('admin.auditLog.more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
