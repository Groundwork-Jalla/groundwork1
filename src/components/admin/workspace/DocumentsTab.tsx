import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, FolderArchive } from 'lucide-react';
import type { ProjectDocumentRow } from '@/types/project';
import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { domainStateOf, workspaceHref } from '@/lib/admin/workspace-params';
import { getSignedDocumentUrl } from '@/lib/supabase/documents';
import { DomainNote } from './DomainNote';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileIcon, formatFileSize } from '@/components/ui/FileIcon';
import { useDomainLabels } from '@/lib/domain-labels';
import { useStageLabels } from '@/lib/stage-labels';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Documents tab (05 §6): `project_documents` grouped by category, read-only.
//
// READ-ONLY BY DECISION (13 Sep 2026): no admin upload, no delete — the storage INSERT
// and DELETE policies are the owner's, and widening them is a later design gate. What
// staff gained in 092 is SELECT on the `documents` bucket, and that is exactly what this
// tab uses: the existing `getSignedDocumentUrl`, fetched on demand. A file that cannot be
// signed is listed and marked, never hidden — the record says it exists.
//
// Grouping is by the row's own `category`; a document tied to a stage links to it.
// =========================================================

const ORDER: ProjectDocumentRow['category'][] = ['contract', 'permit', 'report', 'invoice', 'receipt', 'site_photo', 'other'];

export function DocumentsTab({ loaded }: { loaded: LoadedWorkspace }) {
  const t = useT();
  const labels = useDomainLabels();
  const { stageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'documents', ws.documents.length);

  if (state === 'unavailable' || state === 'error') {
    return <div className="p-6 sm:p-8"><DomainNote state={state} reason={loaded.errors.documents} /></div>;
  }
  if (state === 'empty') {
    return (
      <div className="p-6 sm:p-8">
        <EmptyState icon={<FolderArchive className="size-8" />} title={t('admin.workspace.documents.empty')} description={t('admin.workspace.documents.emptyBody')} />
      </div>
    );
  }

  const groups = ORDER
    .map(cat => ({ cat, docs: ws.documents.filter(d => d.category === cat) }))
    .filter(g => g.docs.length > 0);
  const uploader = (id: string) => {
    if (ws.team.owner?.id === id) return ws.team.owner.name || ws.team.owner.email;
    const c = ws.team.contractors.find(x => x.contractor_user_id === id);
    return c?.name ?? '';
  };

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6 2xl:p-8">
      <p className="text-xs text-brand-mid-grey">{t('admin.workspace.documents.readOnly')}</p>
      {groups.map(g => (
        <section key={g.cat} className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="border-b border-brand-border-grey px-5 py-3 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
            {labels.docCategory(g.cat)} <span className="font-normal tabular-nums text-brand-mid-grey">· {g.docs.length}</span>
          </h2>
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {g.docs.map(d => {
              const view = d.stage_id ? ws.stages.find(s => s.stage.id === d.stage_id) : null;
              return (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileIcon mimeType={d.mime_type} fileName={d.file_name} className="size-5 shrink-0 text-brand-mid-grey" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">{d.file_name}</span>
                    <span className="block truncate text-[11px] text-brand-mid-grey">
                      {formatFileSize(d.file_size)} · {formatDate(d.created_at)}
                      {uploader(d.uploaded_by) && ` · ${uploader(d.uploaded_by)}`}
                      {view && (
                        <> · <Link to={workspaceHref(ws.project.id, { tab: 'overview', stageId: view.stage.id })} className="hover:underline">
                          {t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })} · {stageLabel(view.stage)}
                        </Link></>
                      )}
                    </span>
                  </span>
                  <DownloadLink path={d.file_path} name={d.file_name} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Signed on demand through the existing reader; marked, not hidden, when signing fails. */
function DownloadLink({ path, name }: { path: string; name: string }) {
  const t = useT();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getSignedDocumentUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [path]);
  const cls = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]';
  if (url === undefined) return <span className={cn(cls, 'opacity-50')} aria-hidden="true"><Download className="size-3.5" /></span>;
  if (url === null) return <span className={cn(cls, 'opacity-50')} title={t('admin.workspace.documents.unsigned')}><Download className="size-3.5" /></span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={t('admin.workspace.documents.open', { name })} aria-label={t('admin.workspace.documents.open', { name })}
      className={cn(cls, 'transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:hover:border-white dark:hover:text-white')}>
      <Download className="size-3.5" />
    </a>
  );
}
