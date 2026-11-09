import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { useAuth }       from '@/contexts/AuthContext';
import { supabase }      from '@/lib/supabase/client';
import { fetchClientProjects } from '@/lib/supabase/projects';
import type { ProjectRow } from '@/types/project';
import { useT } from '@/lib/i18n';
import { DocumentViewer } from '@/components/project/DocumentViewer';
import { FileRow, Group, fileKind } from '@/components/project/DocumentList';
import { getSignedDocumentUrl } from '@/lib/supabase/documents';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────

interface Certificate {
  id: string;
  project_id: string;
  stage_number: number;
  project_name: string;
  stage_name: string;
  pdf_url: string | null;
  issued_at: string;
  issued_to: string;
}


function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 rounded-2xl bg-brand-light-grey" />
      ))}
    </div>
  );
}

interface DocRow {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  category: string | null;
  created_at: string;
}

// ── Main page ──────────────────────────────────────────────

/**
 * Documents, and certificates. NOT evidence.
 *
 * This page used to carry an Evidence tab listing every site photograph grouped by
 * project and stage — which is the stage tracker, rebuilt in a second place. Two views
 * of the same thing drift, and a person looking for a permit had to scroll past forty
 * photographs of a slab to find it.
 *
 * Evidence lives with the stage it belongs to, where it means something. This is for
 * documents: contracts, permits, receipts, bills of quantities.
 */
type Tab = 'all' | 'documents' | 'certificates';

export default function DocumentsPage() {
  const { user } = useAuth();
  const t = useT();

  const [tab,          setTab]          = useState<Tab>('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ name: string; url: string | null } | null>(null);
  const [docs,         setDocs]         = useState<DocRow[]>([]);
  /** Narrowing, because a document is found by name or by build. */
  const [query,        setQuery]        = useState('');
  const [projectId,    setProjectId]    = useState<string>('');
  const [certs,        setCerts]        = useState<Certificate[]>([]);
  const [projects,     setProjects]     = useState<ProjectRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [certsErr,     setCertsErr]     = useState(false);

  useEffect(() => {
    if (!user) return;

    // Owned AND shared. The certificates and documents below are filtered by project
    // id, and RLS has always returned both to a viewer (112) — this page simply never
    // asked for the shared ones, so an invited client's vault was empty.
    fetchClientProjects(user.id).then(async ({ all: projs }) => {
      setProjects(projs);

      if (projs.length === 0) {
        setLoading(false);
        return;
      }

      const projectIds = projs.map(p => p.id);
      const projectMap = Object.fromEntries(projs.map(p => [p.id, p]));

      // ── Certificates ───────────────────────────────────
      supabase
        .from('certificates')
        .select('id, project_id, stage_number, project_name, stage_name, pdf_url, issued_at, issued_to')
        .in('project_id', projectIds)
        .order('issued_at', { ascending: false })
        .then(({ data, error }) => {
          if (error) setCertsErr(true);
          else setCerts((data ?? []) as Certificate[]);
        });

      // ── Documents ──────────────────────────────────────
      supabase
        .from('project_documents')
        .select('id, project_id, file_name, file_path, file_size, category, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          setDocs((data ?? []) as DocRow[]);
          setLoading(false);
        });
    });
  }, [user]);

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? '';

  /**
   * Nobody on a self-verifying plan will ever see a certificate here.
   *
   * An approval certificate records an INDEPENDENT check. On self_verify and starter the
   * client approves their own stages, so there is nothing independent to certify and no
   * certificate is issued — which, with the old empty state, read as "yours haven't
   * arrived yet". It is a plan boundary, not a delay, and saying so is also where Jalla
   * Verify is worth mentioning.
   */
  // `starter` is self-verifying too in SQL (086), but it is not in the app's
  // `ProjectTier` union, so there is nothing here that could hold it.
  const allSelfVerify = projects.length > 0 && projects.every(p => p.tier === 'self_verify');

  /**
   * What the filters leave.
   *
   * Name and project, which are the two ways people actually look: "the Kribi permit"
   * and "everything on Franka Home". Matched case-insensitively against the file name
   * and the project it belongs to, so typing a project name works from the box as well
   * as from the dropdown.
   */
  const shown = docs.filter(d => {
    if (projectId && d.project_id !== projectId) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return d.file_name.toLowerCase().includes(q)
        || projectName(d.project_id).toLowerCase().includes(q)
        || String(d.category ?? '').toLowerCase().includes(q);
  });

  const kindLabel = (c: string | null) =>
    c === 'boq' ? t('contractorDocs.billOfQuantities') : c === 'site_photo' ? t('contractorDocs.siteEvidence') : t('contractorDocs.drawing');

  async function openDocument(doc: DocRow) {
    setOpening(doc.id); setOpenError(null);
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

  const q = query.trim().toLowerCase();
  const sortedDocs = [...shown].sort((a, b) =>
    sort === 'name' ? a.file_name.localeCompare(b.file_name)
    : sort === 'oldest' ? a.created_at.localeCompare(b.created_at)
    : b.created_at.localeCompare(a.created_at));
  const shownCerts = certs
    .filter(c => !projectId || c.project_id === projectId)
    .filter(c => !q || c.stage_name.toLowerCase().includes(q) || c.project_name.toLowerCase().includes(q));
  const showDocs = tab === 'all' || tab === 'documents';
  const showCerts = tab === 'all' || tab === 'certificates';
  const chips = [
    { id: 'all' as const,          label: t('contractorDocs.chipAll'),   n: sortedDocs.length + shownCerts.length },
    { id: 'documents' as const,    label: t('documents.tabDocuments'),   n: sortedDocs.length },
    { id: 'certificates' as const, label: t('contractorDocs.chipCerts'), n: shownCerts.length },
  ];
  const nothing = !loading && (!showDocs || sortedDocs.length === 0) && (!showCerts || shownCerts.length === 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-24 sm:px-6 md:pb-8">
      <div>
        <h2 className="text-lg font-bold text-brand-near-black dark:text-white">{t('documents.title')}</h2>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('documents.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" aria-hidden />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            aria-label={t('documents.searchPlaceholder')} placeholder={t('documents.searchPlaceholder')}
            className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-base sm:text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          />
        </div>
        {projects.length > 1 && (
          <select
            value={projectId} onChange={e => setProjectId(e.target.value)}
            aria-label={t('documents.filterProject')}
            className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
          >
            <option value="">{t('documents.allProjects')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select
          value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          aria-label={t('contractorDocs.sortBy')}
          className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
        >
          <option value="newest">{t('contractorDocs.sortNewest')}</option>
          <option value="oldest">{t('contractorDocs.sortOldest')}</option>
          <option value="name">{t('contractorDocs.sortName')}</option>
        </select>
      </div>

      {openError && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-xs dark:bg-[#1e1e1e]">{openError}</p>
      )}
      {certsErr && (
        <p className="rounded-xl border border-state-held/30 bg-brand-off-white px-4 py-3 text-xs text-state-held dark:bg-[#1e1e1e]">
          {t('documents.certsTableMissing')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {chips.map(c => (
          <button key={c.id} type="button" onClick={() => setTab(c.id)} aria-pressed={tab === c.id}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              tab === c.id
                ? 'border-brand-near-black bg-brand-near-black font-semibold text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]')}>
            {c.label}
            <span className={cn('ml-1.5 font-mono text-[10px] tabular-nums', tab === c.id ? 'opacity-60' : 'text-brand-mid-grey')}>{c.n}</span>
          </button>
        ))}
      </div>

      {loading && <Skeleton />}

      {nothing && (
        <div className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-12 text-center dark:border-[#2c2c2c]">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">
            {q || projectId ? t('documents.noMatches') : tab === 'certificates' ? t(allSelfVerify ? 'documents.certsSelfVerifyTitle' : 'documents.noCertificates') : t('documents.noDocuments')}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-brand-mid-grey">
            {q || projectId ? t('documents.noMatchesBody') : tab === 'certificates' ? t(allSelfVerify ? 'documents.certsSelfVerifyBody' : 'documents.certsEarnBody') : t('documents.noDocumentsBody')}
          </p>
          {projects.length === 0 && (
            <Link to="/projects/new" className="mt-4 inline-flex rounded-xl bg-brand-near-black px-5 py-2.5 text-sm font-semibold text-white">
              {t('documents.startBuild')}
            </Link>
          )}
        </div>
      )}

      {!loading && showDocs && sortedDocs.length > 0 && (
        <Group title={t('contractorDocs.chipAll')}>
          {sortedDocs.map(d => (
            <FileRow key={d.id} kind={fileKind(d.file_name)} name={d.file_name}
                     sub={[projectName(d.project_id), kindLabel(d.category),
                           d.file_size ? `${Math.round(d.file_size / 1024)} KB` : null].filter(Boolean).join(' · ')}
                     when={formatDate(d.created_at)}
                     action={t('contractorDocs.view')} onOpen={() => void openDocument(d)}
                     busy={opening === d.id} />
          ))}
        </Group>
      )}

      {!loading && showCerts && shownCerts.length > 0 && (
        <Group title={t('contractorDocs.certificatesIssued')}>
          {shownCerts.map(c => {
            const name = t('contractorDocs.stageCertificate', { n: c.stage_number, name: c.stage_name });
            return (
              <FileRow key={c.id} kind="CRT" name={name}
                       sub={[c.project_name, t('contractorDocs.issuedByGroundwork')].join(' · ')}
                       when={formatDate(c.issued_at)}
                       action={c.pdf_url ? t('contractorDocs.view') : undefined}
                       onOpen={c.pdf_url ? () => setViewing({ name: name + '.pdf', url: c.pdf_url }) : undefined} />
            );
          })}
        </Group>
      )}

      {viewing && (
        <DocumentViewer name={viewing.name} url={viewing.url} loading={viewing.url === null}
                        onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
