import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { useStageLabels } from '@/lib/stage-labels';
import { getSignedDocumentUrl } from '@/lib/supabase/documents';
import { fetchProjectCertificates, type IssuedCertificate } from '@/lib/supabase/certificates';
import { DocumentViewer } from '@/components/project/DocumentViewer';
import { FileRow, Group, fileKind } from '@/components/project/DocumentList';
import type { ProjectDocumentRow } from '@/types/project';

// =========================================================
// The project's documents — one view, both sides of the project.
//
// Favour, 11 Nov 2026, with Philip on the contractor's Documents tab: "the document
// part is from contractors and i want the client document view to look the same as the
// contractor document view".
//
// They were two different screens. The contractor had this one — search, filter chips
// that count what the search left, and three groups: the build's own files, the site
// updates filed under the stage they belong to, and the certificates actually issued.
// The client had a flat list in a different component, so the same project looked like
// two different projects depending on who opened it.
//
// ── WHAT STAYS ROLE-SPECIFIC ─────────────────────────────────────────────────────────
// The VIEW is shared; what you may DO is not. Uploading is passed in as `toolbar`,
// because the client uploads receipts and contracts and the contractor's tab offers no
// upload at all. Nothing here decides who may act — it renders what it is handed, and
// the server still refuses anybody it should.
// =========================================================

/** The little a stage has to tell us to be filed and counted. */
export interface DocumentStage {
  id: string;
  stage_number: number;
  stage_key: string | null;
  name: string;
  status: string;
}

export function ProjectDocuments({
  projectId, stages, documents, toolbar, emptyLabel,
}: {
  projectId: string;
  stages: DocumentStage[];
  documents: ProjectDocumentRow[];
  /** Rendered beside the search box. The client's Upload button lives here. */
  toolbar?: ReactNode;
  /** What to say when the project genuinely has nothing yet. */
  emptyLabel?: string;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [filter, setFilter] = useState<'all' | 'drawings' | 'boq' | 'site' | 'certificates'>('all');
  /** Search across file names. Philip asked to be able to "search through documents". */
  const [query, setQuery] = useState('');
  /**
   * Philip listed three things this tab had to do: "filter through documents, search
   * through documents, organize documents." Filter is the chips, search is the box,
   * and this is the third — newest first by default, because the thing somebody
   * uploaded this morning is the thing they came looking for.
   */
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  /** Which file is being opened, so its own button shows it and the others stay live. */
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /** The file on screen. Null means the viewer is closed. */
  const [viewing, setViewing] = useState<{ name: string; url: string | null } | null>(null);
  /** Certificates that actually exist, by stage. Empty means none were issued. */
  const [certs, setCerts] = useState<Map<string, IssuedCertificate>>(new Map());

  useEffect(() => {
    let alive = true;
    void fetchProjectCertificates(projectId)
      .then(m => { if (alive) setCerts(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  /**
   * Open a stored file.
   *
   * A signed URL rather than a public one: the bucket is private, and a document on
   * somebody's build is theirs. One hour is the same window every other download in
   * the app uses.
   */
  async function openDocument(doc: ProjectDocumentRow) {
    setOpening(doc.id); setOpenError(null);
    // The viewer opens straight away, showing the file name and a spinner, rather than
    // the row sitting silent while the URL is signed. Signing takes a round trip, and
    // a control that looks like it did nothing gets pressed again.
    setViewing({ name: doc.file_name, url: null });
    try {
      const url = await getSignedDocumentUrl(doc.file_path);
      if (!url) { setViewing(null); setOpenError(t('contractorDocs.openFailed')); return; }
      setViewing({ name: doc.file_name, url });
    } catch {
      setViewing(null);
      setOpenError(t('contractorDocs.openFailed'));
    } finally {
      setOpening(null);
    }
  }

  // The search applies to the FILES. Stages and certificates are matched on their own
  // names further down, so typing "roof" finds the roofing certificate too.
  const q = query.trim().toLowerCase();
  const hit = (text: string) => !q || text.toLowerCase().includes(q);
  const order = (a: ProjectDocumentRow, b: ProjectDocumentRow) =>
    sort === 'name'   ? a.file_name.localeCompare(b.file_name)
    : sort === 'oldest' ? a.created_at.localeCompare(b.created_at)
    :                     b.created_at.localeCompare(a.created_at);

  const inScope = documents.filter(d => hit(d.file_name)).sort(order);

  const drawings = inScope.filter(d => d.category !== 'boq' && d.category !== 'site_photo');
  const boq = inScope.filter(d => d.category === 'boq');
  // One certificate per approved stage — that is how they are issued, so that is
  // how they are counted. Nothing invented: an unapproved stage has none.
  const certificates = stages.filter(st => st.status === 'complete' && hit(stageLabel(st)));
  /** The stages the group below lists, so the chip counts what is under it. */
  const stagesWithUpdates = stages.filter(st =>
    (st.status === 'complete' || st.status === 'active' || st.status === 'pending_review')
    && hit(stageLabel(st)));

  const CHIPS = [
    // Counted from what the search left, like every other chip — otherwise the first
    // chip claims six while the five beside it add up to none.
    { id: 'all' as const,          label: t('contractorDocs.chipAll'),      n: inScope.length + certificates.length },
    { id: 'drawings' as const,     label: t('contractorDocs.chipDrawings'), n: drawings.length },
    { id: 'boq' as const,          label: t('contractorDocs.chipBoq'),      n: boq.length },
    { id: 'site' as const,         label: t('contractorDocs.chipSite'),     n: stagesWithUpdates.length },
    { id: 'certificates' as const, label: t('contractorDocs.chipCerts'),    n: certificates.length },
  ];

  const show = (which: typeof filter) => filter === 'all' || filter === which;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" aria-hidden />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              aria-label={t('contractorDocs.search')} placeholder={t('contractorDocs.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-base sm:text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
            />
          </div>

          {/* A native select: three options do not earn a custom control, and this one
              is reachable by keyboard and by a screen reader without any work. */}
          <label className="shrink-0">
            <span className="sr-only">{t('contractorDocs.sortBy')}</span>
            <select
              value={sort} onChange={e => setSort(e.target.value as typeof sort)}
              className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
            >
              <option value="newest">{t('contractorDocs.sortNewest')}</option>
              <option value="oldest">{t('contractorDocs.sortOldest')}</option>
              <option value="name">{t('contractorDocs.sortName')}</option>
            </select>
          </label>

          {toolbar}
        </div>

        {openError && (
          <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-xs dark:bg-[#1e1e1e]">
            {openError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {CHIPS.map(c => (
            <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === c.id
                  ? 'border-brand-near-black bg-brand-near-black font-semibold text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]')}>
              {c.label}
              <span className={cn('ml-1.5 font-mono text-[10px] tabular-nums',
                filter === c.id ? 'opacity-60' : 'text-brand-mid-grey')}>{c.n}</span>
            </button>
          ))}
        </div>

        {documents.length === 0 && stages.every(st => st.status !== 'complete') && (
          <p className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
            {emptyLabel ?? t('contractorProject.noDocuments')}
          </p>
        )}

        {/* There ARE documents, but none match what was typed. Said plainly, rather
            than leaving the page looking empty and broken. */}
        {documents.length > 0 && q !== '' && inScope.length === 0 && certificates.length === 0
          && stagesWithUpdates.length === 0 && (
          <p className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-12 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
            {t('contractorDocs.noMatch', { q: query.trim() })}
          </p>
        )}

        {(show('drawings') || show('boq')) && (drawings.length > 0 || boq.length > 0) && (
          <Group title={t('contractorDocs.theBuild')}>
            {[...boq, ...drawings].map(d => (
              <FileRow key={d.id} kind={fileKind(d.file_name)} name={d.file_name}
                       sub={[d.category === 'boq' ? t('contractorDocs.billOfQuantities') : t('contractorDocs.drawing'),
                            d.file_size ? `${Math.round(d.file_size / 1024)} KB` : null].filter(Boolean).join(' · ')}
                       when={formatDate(d.created_at)}
                       action={t('contractorDocs.view')} onOpen={() => void openDocument(d)}
                       busy={opening === d.id} />
            ))}
          </Group>
        )}

        {show('site') && !(q !== '' && stagesWithUpdates.length === 0) && (
          <Group title={t('contractorDocs.siteUpdatesFiled')}>
            {stagesWithUpdates.length === 0
              ? <p className="py-3 text-xs text-brand-mid-grey">{t('contractorDocs.noSiteUpdates')}</p>
              : stagesWithUpdates.map(st => (
                    <FileRow key={st.id} kind={String(st.stage_number)} name={stageLabel(st)}
                             sub={t(st.status === 'complete'
                               ? 'contractorDocs.stageApproved' : 'contractorDocs.stageOpen')}
                             when="" state={st.status === 'complete' ? 'done' : 'open'} />
                ))}
          </Group>
        )}

        {show('certificates') && certificates.length > 0 && (
          <Group title={t('contractorDocs.certificatesIssued')}>
            {certificates.map(st => {
              // Only where a certificate was really issued. A stage approved before
              // certificates existed has no file, and gets no button rather than a
              // dead one.
              const cert = certs.get(st.id);
              return (
                <FileRow key={st.id} kind="CRT"
                         name={t('contractorDocs.stageCertificate', { n: st.stage_number, name: stageLabel(st) })}
                         sub={t('contractorDocs.issuedByGroundwork')} when=""
                         action={cert?.pdfUrl ? t('contractorDocs.view') : undefined}
                         onOpen={cert?.pdfUrl
                           ? () => setViewing({
                               name: t('contractorDocs.stageCertificate', { n: st.stage_number, name: stageLabel(st) }) + '.pdf',
                               url: cert.pdfUrl,
                             })
                           : undefined} />
              );
            })}
          </Group>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* "Who can see these" removed 30 Oct 2026 (Philip, recording 2): "not
            needed at all on this document section". Who can see the project is
            the People tab's subject, and it is one tab away. */}

        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorDocs.nothingLeaves')}
          </h2>
          <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorDocs.nothingLeavesBody')}</p>
        </section>
      </div>

      {viewing && (
        <DocumentViewer name={viewing.name} url={viewing.url} loading={viewing.url === null}
                        onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

export default ProjectDocuments;
