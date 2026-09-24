import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Camera, Loader2 } from 'lucide-react';
import { listAllSiteUpdates, type SiteUpdateFeedRow } from '@/lib/supabase/site-updates';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateTime, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/site-updates — what has happened on site, everywhere (01 §3).
//
// The field evidence feed: every `site_updates` row (088) in time order, with the
// project, the stage, who reported it and what they added. It shows work; it does not
// approve it — approval is Reviews & Approvals, and every row here opens the project's
// own Site updates tab where the evidence is.
//
// Filters are only what the table can actually answer: project and reporter. There is no
// "update type" column, so there is no type filter.
// =========================================================

export default function AdminSiteUpdates() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const projectFilter = params.get('project');
  const reporterFilter = params.get('reporter');

  const [rows, setRows] = useState<SiteUpdateFeedRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listAllSiteUpdates();
      setRows(r.rows); setAvailable(r.available); setError(null);
    } catch (err) { setRows([]); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const setParam = (key: string, value: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows ?? []) if (r.projectId && !seen.has(r.projectId)) seen.set(r.projectId, r.projectName || r.projectId);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const reporters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows ?? []) if (r.submittedBy && r.reporterName && !seen.has(r.submittedBy)) seen.set(r.submittedBy, r.reporterName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const shown = (rows ?? []).filter(r =>
    (!projectFilter || r.projectId === projectFilter) && (!reporterFilter || r.submittedBy === reporterFilter));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.siteUpdates.title')}</h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.siteUpdates.subtitle')}</p>
        </div>
        {rows !== null && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select label={t('admin.siteUpdates.allProjects')} value={projectFilter} options={projects} onChange={v => setParam('project', v)} />
            {reporters.length > 0 && (
              <Select label={t('admin.siteUpdates.allReporters')} value={reporterFilter} options={reporters} onChange={v => setParam('reporter', v)} />
            )}
          </div>
        )}
      </header>

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{error}</p>
      ) : !available ? (
        <p className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('admin.siteUpdates.unavailable')}
        </p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<Camera className="size-8" />}
            title={t(rows.length === 0 ? 'admin.siteUpdates.empty' : 'admin.siteUpdates.noMatch')}
            description={t(rows.length === 0 ? 'admin.siteUpdates.emptyBody' : 'admin.siteUpdates.noMatchBody')} />
        </div>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {shown.map(r => (
            <li key={r.id} className="border-b border-brand-border-grey last:border-0 dark:border-[#2c2c2c]">
              <Link to={`/admin/projects/${r.projectId}?tab=site-updates`}
                className="block px-5 py-3.5 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-brand-near-black dark:text-white">
                  <span className="truncate">{r.projectName || t('admin.siteUpdates.unknownProject')}</span>
                  <span className="text-[11px] font-normal text-brand-mid-grey">
                    {r.stageNumber != null && `${t('admin.workspace.stage.eyebrow', { n: r.stageNumber })} · `}{r.stageName}
                    {r.substageName && ` · ${r.substageName}`}
                  </span>
                </p>
                {r.description && <p className="mt-1 whitespace-pre-wrap text-xs text-brand-near-black dark:text-white">{r.description}</p>}
                <p className="mt-1 text-[11px] text-brand-mid-grey" title={formatDateTime(r.submittedAt)}>
                  {r.reporterName || t('admin.workspace.header.unknownAccount')}
                  {' · '}{formatRelative(r.submittedAt)}
                  {r.evidencePaths.length > 0 && ` · ${t('admin.siteUpdates.files', { n: r.evidencePaths.length })}`}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string | null; options: { id: string; name: string }[]; onChange: (v: string | null) => void;
}) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} aria-label={label}
      className={cn('rounded-lg border border-brand-border-grey bg-white px-2.5 py-1.5 text-xs text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white')}>
      <option value="">{label}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
