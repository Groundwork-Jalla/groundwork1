import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { useDomainLabels } from '@/lib/domain-labels';
import { useStageLabels } from '@/lib/stage-labels';
import { supabase } from '@/lib/supabase/client';
import { getSignedDocumentUrl, signedUrlIn } from '@/lib/supabase/documents';
import { fetchProjectCertificates, type IssuedCertificate } from '@/lib/supabase/certificates';
import { listSiteUpdates, type SiteUpdate } from '@/lib/supabase/site-updates';
import { fetchSubstages } from '@/lib/supabase/contractor-work';
import { projectMedia, type ProjectMedia } from '@/lib/documents/project-media';
import { DocumentViewer } from './DocumentViewer';
import { FileRow, Group, fileKind } from './DocumentList';
import type { ProjectDocumentRow, ProjectSubstageRow } from '@/types/project';

export interface DocumentStage {
  id: string; stage_number: number; stage_key: string | null; name: string; status: string;
}

/** The same actual-file catalogue for clients, contractors and observers. */
export function ProjectDocuments({ projectId, stages, documents, toolbar, emptyLabel }: {
  projectId: string; stages: DocumentStage[]; documents: ProjectDocumentRow[];
  toolbar?: ReactNode; emptyLabel?: string;
}) {
  const t = useT();
  const labels = useDomainLabels();
  const { stageLabel } = useStageLabels();
  const [filter, setFilter] = useState<'all' | 'drawings' | 'boq' | 'site' | 'certificates'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ projectId: string; name: string; url: string | null } | null>(null);
  const [read, setRead] = useState<{
    projectId: string; status: 'loading' | 'ready' | 'error'; certs: Map<string, IssuedCertificate>;
    updates: SiteUpdate[]; substages: ProjectSubstageRow[];
  }>({ projectId, status: 'loading', certs: new Map(), updates: [], substages: [] });
  const current = useRef(projectId); current.current = projectId;
  const viewRequest = useRef(0);

  useEffect(() => {
    let alive = true, generation = 0;
    async function load() {
      const version = ++generation;
      try {
        const [certs, updates, substages] = await Promise.all([
          fetchProjectCertificates(projectId, { strict: true }), listSiteUpdates(projectId), fetchSubstages(projectId),
        ]);
        if (alive && version === generation) setRead({ projectId, status: 'ready', certs, updates: updates.rows, substages });
      } catch {
        if (alive && version === generation) setRead({ projectId, status: 'error', certs: new Map(), updates: [], substages: [] });
      }
    }
    setRead({ projectId, status: 'loading', certs: new Map(), updates: [], substages: [] });
    setViewing(null); setOpening(null); setOpenError(null); setFilter('all'); setQuery(''); ++viewRequest.current;
    void load();
    const channel = supabase.channel(`project-files:${projectId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_updates', filter: `project_id=eq.${projectId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_substages', filter: `project_id=eq.${projectId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'certificates', filter: `project_id=eq.${projectId}` }, () => { void load(); })
      .subscribe();
    const focus = () => { void load(); }; window.addEventListener('focus', focus);
    return () => { alive = false; ++viewRequest.current; window.removeEventListener('focus', focus); void supabase.removeChannel(channel); };
  }, [projectId, attempt]);

  const closeViewer = useCallback(() => { ++viewRequest.current; setViewing(null); setOpening(null); }, []);
  async function openFile(file: { id: string; name: string; path: string; bucket: 'documents' | 'evidence' }) {
    const version = ++viewRequest.current;
    setOpening(file.id); setOpenError(null); setViewing({ projectId, name: file.name, url: null });
    try {
      const url = file.bucket === 'documents' ? await getSignedDocumentUrl(file.path) : await signedUrlIn('evidence', file.path);
      if (version !== viewRequest.current || current.current !== projectId) return;
      if (!url) throw new Error('File unavailable');
      setViewing({ projectId, name: file.name, url });
    } catch {
      if (version === viewRequest.current && current.current === projectId) { setViewing(null); setOpenError(t('contractorDocs.openFailed')); }
    } finally {
      if (version === viewRequest.current && current.current === projectId) setOpening(null);
    }
  }
  const ready = read.projectId === projectId && read.status === 'ready';
  const error = read.projectId === projectId && read.status === 'error';
  const media = projectMedia(documents, ready ? read.updates : [], ready ? read.substages : []);
  const q = query.trim().toLowerCase();
  const hit = (name: string) => !q || name.toLowerCase().includes(q);
  const stageName = (id: string | null) => { const stage = stages.find(row => row.id === id); return stage ? stageLabel(stage) : ''; };
  const ordered = <T extends { name: string; at: string | null }>(rows: T[]) => [...rows].sort((a, b) => sort === 'name'
    ? a.name.localeCompare(b.name) : sort === 'oldest' ? (a.at ?? '').localeCompare(b.at ?? '') : (b.at ?? '').localeCompare(a.at ?? ''));
  const files = ordered(documents.filter(doc => doc.category !== 'site_photo' && hit(doc.file_name)).map(doc => ({ ...doc, name: doc.file_name, at: doc.created_at })));
  const drawings = files.filter(doc => doc.category !== 'boq');
  const boq = files.filter(doc => doc.category === 'boq');
  const site = ordered(media.filter(item => hit(`${item.name} ${stageName(item.stageId)} ${item.description ?? ''}`)));
  const certificates = ready ? [...read.certs.values()].filter(cert => cert.pdfUrl && hit(stageName(cert.stageId))) : [];
  const counts = { all: files.length + site.length + certificates.length, drawings: drawings.length, boq: boq.length, site: site.length, certificates: certificates.length };
  const chips = [
    { id: 'all' as const, label: t('contractorDocs.chipAll') }, { id: 'drawings' as const, label: t('project.review.documents') },
    { id: 'boq' as const, label: t('contractorDocs.chipBoq') }, { id: 'site' as const, label: t('contractorDocs.chipSite') },
    { id: 'certificates' as const, label: t('contractorDocs.chipCerts') },
  ];
  const show = (group: typeof filter) => filter === 'all' || filter === group;
  const visible = filter === 'all' ? counts.all : counts[filter];
  const renderFile = (doc: typeof files[number]) => <FileRow key={doc.id} kind={fileKind(doc.file_name)} name={doc.file_name}
    sub={doc.category === 'boq' ? t('contractorDocs.billOfQuantities') : labels.docCategory(doc.category)}
    when={formatDate(doc.created_at)} action={t('contractorDocs.view')} busy={opening === doc.id}
    onOpen={() => { void openFile({ id: doc.id, name: doc.file_name, path: doc.file_path, bucket: 'documents' }); }} />;
  const renderMedia = (item: ProjectMedia) => item.path ? <FileRow key={item.id} kind={fileKind(item.name)} name={item.name}
    sub={stageName(item.stageId)} when={item.at ? formatDate(item.at) : ''} action={t('contractorDocs.view')} busy={opening === item.id}
    onOpen={() => { void openFile({ id: item.id, name: item.name, path: item.path!, bucket: item.bucket }); }} />
    : <article key={item.id} className="border-t border-brand-border-grey py-3">
      <p className="text-xs text-brand-mid-grey">{stageName(item.stageId)}{item.at ? ` · ${formatDate(item.at)}` : ''}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-brand-near-black dark:text-white">{item.description}</p>
    </article>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" aria-hidden />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('contractorDocs.search')}
          placeholder={t('contractorDocs.search')} className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm dark:bg-[#1e1e1e] dark:text-white" />
      </div>
      <select aria-label={t('contractorDocs.sortBy')} value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-xs dark:bg-[#1e1e1e] dark:text-white">
        <option value="newest">{t('contractorDocs.sortNewest')}</option><option value="oldest">{t('contractorDocs.sortOldest')}</option><option value="name">{t('contractorDocs.sortName')}</option>
      </select>
      {toolbar}
    </div>
    <div className="flex flex-wrap gap-1.5">{chips.map(chip => <button key={chip.id} type="button" onClick={() => setFilter(chip.id)}
      aria-pressed={filter === chip.id} className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', filter === chip.id ? 'border-transparent bg-brand-green text-white' : 'border-brand-border-grey text-brand-mid-grey')}>
      {chip.label}<span className="ml-1.5 font-mono">{counts[chip.id]}</span>
    </button>)}</div>
    {!ready && !error && <p role="status" className="text-xs text-brand-mid-grey">{t('common.loading')}</p>}
    {error && <p role="alert" className="text-sm text-state-alert">{t('project.review.documentsLoadFailed')}{' '}
      <button type="button" className="font-semibold underline" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button></p>}
    {openError && <p role="alert" className="text-sm text-state-alert">{openError}</p>}
    {ready && visible === 0 && <p className="rounded-2xl border border-dashed border-brand-border-grey p-8 text-center text-sm text-brand-mid-grey">
      {q ? t('contractorDocs.noMatch', { q: query.trim() }) : emptyLabel ?? t('contractorProject.noDocuments')}
    </p>}
    {show('drawings') && drawings.length > 0 && <Group title={t('project.review.documents')}>{drawings.map(renderFile)}</Group>}
    {show('boq') && boq.length > 0 && <Group title={t('contractorDocs.billOfQuantities')}>{boq.map(renderFile)}</Group>}
    {show('site') && site.length > 0 && <Group title={t('contractorDocs.siteUpdatesFiled')}>{site.map(renderMedia)}</Group>}
    {show('certificates') && certificates.length > 0 && <Group title={t('contractorDocs.certificatesIssued')}>
      {certificates.map(cert => <FileRow key={cert.id} kind="PDF" name={stageName(cert.stageId) || t('project.stages.certificate')}
        sub={t('contractorDocs.issuedByGroundwork')} when="" action={t('contractorDocs.view')} onOpen={() => {
          ++viewRequest.current; setOpening(null); setViewing({ projectId, name: `${stageName(cert.stageId) || t('project.stages.certificate')}.pdf`, url: cert.pdfUrl });
        }} />)}
    </Group>}
    {viewing?.projectId === projectId && <DocumentViewer name={viewing.name} url={viewing.url} loading={viewing.url === null} onClose={closeViewer} />}
  </div>;
}
export default ProjectDocuments;
