import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, Eye, FolderArchive, LayoutGrid, List, Search } from 'lucide-react';
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

/**
 * The categories shown, in the order they appear.
 *
 * A document whose category is NOT in this list is rendered nowhere — the groups are
 * built by walking this array, not the rows. That is how every bill of quantities
 * became invisible to staff: 096 added `boq` to the table's CHECK and to the wizard's
 * upload, and this line was never touched, so the one document a project is priced on
 * could be uploaded and then not exist as far as the admin was concerned.
 *
 * `boq` leads, because when there is one it is the most consequential paper on the
 * project — the figure every stage payment is derived from.
 */
const ORDER: ProjectDocumentRow['category'][] =
  ['boq', 'contract', 'permit', 'report', 'invoice', 'receipt', 'site_photo', 'other'];

export function DocumentsTab({ loaded }: { loaded: LoadedWorkspace }) {
  const t = useT();
  const labels = useDomainLabels();
  const { stageLabel } = useStageLabels();
  const ws = loaded.workspace;
  const state = domainStateOf(ws, loaded.errors, 'documents', ws.documents.length);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectDocumentRow['category'] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

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
  // Search, category chips and grid/list (18 Nov redesign): client-side over the rows
  // already loaded. The first three categories are chips; the rest sit under More.
  const q = query.trim().toLowerCase();
  const visible = groups
    .filter(g => !category || g.cat === category)
    .map(g => ({ ...g, docs: g.docs.filter(d => !q || d.file_name.toLowerCase().includes(q)) }))
    .filter(g => g.docs.length > 0);
  const chips = moreOpen ? groups : groups.slice(0, 3);

  const meta = (d: ProjectDocumentRow) => {
    const view = d.stage_id ? ws.stages.find(s => s.stage.id === d.stage_id) : null;
    return (
      <>
        {formatFileSize(d.file_size)} · {formatDate(d.created_at)}
        {uploader(d.uploaded_by) && ` · ${uploader(d.uploaded_by)}`}
        {view && (
          <> · <Link to={workspaceHref(ws.project.id, { tab: 'overview', stageId: view.stage.id })} className="font-medium text-brand-green underline underline-offset-2 dark:text-state-complete">
            {t('admin.workspace.stage.eyebrow', { n: view.stage.stage_number })} · {stageLabel(view.stage)}
          </Link></>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 2xl:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('admin.workspace.ui.searchFiles', { n: ws.documents.length })} aria-label={t('admin.workspace.ui.searchFiles', { n: ws.documents.length })}
            className="w-full rounded-full border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/15 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white" />
        </div>
        <Chip on={!category} onClick={() => setCategory(null)} label={t('admin.workspace.ui.all')} n={ws.documents.length} />
        {chips.map(g => (
          <Chip key={g.cat} on={category === g.cat} onClick={() => setCategory(category === g.cat ? null : g.cat)} label={labels.docCategory(g.cat)} n={g.docs.length} />
        ))}
        {groups.length > 3 && !moreOpen && (
          <button type="button" onClick={() => setMoreOpen(true)}
            className="rounded-full border border-brand-border-grey bg-white px-3.5 py-1.5 text-[13px] font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
            {t('admin.workspace.ui.more')}
          </button>
        )}
        <div className="ml-auto flex rounded-xl border border-brand-border-grey bg-white p-0.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {(['grid', 'list'] as const).map(v => (
            <button key={v} type="button" onClick={() => setLayout(v)} aria-pressed={layout === v}
              aria-label={t(v === 'grid' ? 'admin.workspace.ui.grid' : 'admin.workspace.ui.list')} title={t(v === 'grid' ? 'admin.workspace.ui.grid' : 'admin.workspace.ui.list')}
              className={cn('rounded-lg p-1.5 transition-colors', layout === v ? 'bg-brand-off-white text-brand-near-black dark:bg-[#252525] dark:text-white' : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
              {v === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </button>
          ))}
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Eye className="size-3.5 shrink-0" />{t('admin.workspace.documents.readOnly')}</p>

      {visible.length === 0 && (
        <p className="rounded-2xl border border-brand-border-grey bg-white px-5 py-8 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{t('admin.workspace.ui.noMatch')}</p>
      )}

      {layout === 'grid' ? (
        // Groups flow side by side, so a project with one file per category fits one screen.
        <div className="flex flex-wrap gap-x-5 gap-y-6">
          {visible.map(g => (
            <section key={g.cat} className="w-full min-w-0 sm:w-auto">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-brand-near-black dark:text-white">
                {labels.docCategory(g.cat)} <span className="font-normal tabular-nums text-brand-mid-grey">{g.docs.length}</span>
              </h2>
              <ul className="flex flex-wrap gap-3">
                {g.docs.map(d => (
                  <li key={d.id} className="flex w-full flex-col overflow-hidden sm:w-52 rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                    <DocPreview path={d.file_path} mime={d.mime_type} name={d.file_name} />
                    <div className="flex items-start gap-2 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-brand-near-black dark:text-white" title={d.file_name}>{d.file_name}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-brand-mid-grey">{meta(d)}</span>
                      </span>
                      <DownloadLink path={d.file_path} name={d.file_name} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : visible.map(g => (
        <section key={g.cat} className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="border-b border-brand-border-grey px-5 py-3 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
            {labels.docCategory(g.cat)} <span className="font-normal tabular-nums text-brand-mid-grey">· {g.docs.length}</span>
          </h2>
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {g.docs.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <FileIcon mimeType={d.mime_type} fileName={d.file_name} className="size-5 shrink-0 text-brand-mid-grey" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">{d.file_name}</span>
                  <span className="block truncate text-[11px] text-brand-mid-grey">{meta(d)}</span>
                </span>
                <DownloadLink path={d.file_path} name={d.file_name} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Chip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
        on ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]'
          : 'border-brand-border-grey bg-white text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white')}>
      {label}<span className="tabular-nums opacity-70">{n}</span>
    </button>
  );
}

/** The file's face: the photo itself for an image that signs, otherwise a typed page tile. */
function DocPreview({ path, mime, name }: { path: string; mime: string | null; name: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const image = (mime ?? '').startsWith('image/');
  useEffect(() => {
    if (!image) return;
    let alive = true;
    getSignedDocumentUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [path, image]);
  const ext = (name.split('.').pop() ?? '').toUpperCase().slice(0, 4);
  return (
    <div className="relative grid h-32 place-items-center border-b border-brand-border-grey bg-brand-off-white dark:border-[#2c2c2c]">
      {image && url
        ? <img src={url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        : <FileIcon mimeType={mime} fileName={name} className="size-9 text-brand-muted-grey" />}
      {ext && <span className="absolute left-2 top-2 rounded-md border border-brand-border-grey bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">{ext}</span>}
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
  if (url === null) return <span className={cn(cls, 'opacity-50')} title={t('admin.workspace.documents.unsigned')} aria-label={t('admin.workspace.documents.unsigned')}><Download className="size-3.5" /></span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={t('admin.workspace.documents.open', { name })} aria-label={t('admin.workspace.documents.open', { name })}
      className={cn(cls, 'transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:hover:border-white dark:hover:text-white')}>
      <Download className="size-3.5" />
    </a>
  );
}
