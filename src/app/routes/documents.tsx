import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, Award, Building2, ChevronRight, Download, ExternalLink, FileText, Image, Search } from 'lucide-react';
import { useAuth }       from '@/contexts/AuthContext';
import { supabase }      from '@/lib/supabase/client';
import { fetchProjects } from '@/lib/supabase/projects';
import type { ProjectRow } from '@/types/project';
import { useT, type TKey } from '@/lib/i18n';
import { EvidenceLightbox } from '@/components/project/EvidenceLightbox';

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


// ── Helpers ────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Certificate card ───────────────────────────────────────

function CertCard({ cert }: { cert: Certificate }) {
  const t = useT();
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-5 flex flex-col gap-4">
      {/* Header badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-near-black">
          <Award className="size-5 text-white" />
        </div>
        <span className="inline-flex items-center rounded-full bg-brand-off-white border border-state-complete/30 px-2.5 py-0.5 text-[10px] font-semibold text-state-complete">
          {t('documents.verified')}
        </span>
      </div>

      {/* Stage info */}
      <div>
        <p className="text-xs font-medium text-brand-mid-grey uppercase tracking-widest mb-0.5">
          Stage {cert.stage_number}
        </p>
        <h3 className="text-base font-bold text-brand-near-black leading-snug">
          {cert.stage_name}
        </h3>
        <p className="text-xs text-brand-mid-grey mt-1 flex items-center gap-1">
          <Building2 className="size-3 shrink-0" />
          {cert.project_name}
        </p>
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-[10px] text-brand-mid-grey border-t border-brand-off-white pt-3">
        <span>{t('documents.issuedTo', { name: cert.issued_to })}</span>
        <span className="tabular-nums">{formatDate(cert.issued_at)}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {cert.pdf_url ? (
          <>
            <a
              href={cert.pdf_url}
              download
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-near-black text-white text-xs font-semibold py-2.5 hover:bg-black transition-colors"
            >
              <Download className="size-3.5" /> {t('documents.downloadPdf')}
            </a>
            <a
              href={`/verify/${cert.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center size-10 rounded-xl border border-brand-border-grey text-brand-mid-grey hover:border-brand-near-black hover:text-brand-near-black transition-colors shrink-0"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </>
        ) : (
          <span className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey text-xs text-brand-mid-grey py-2.5 cursor-not-allowed opacity-60">
            {t('documents.pdfGenerating')}
          </span>
        )}
      </div>
    </div>
  );
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

/**
 * One document, openable in place.
 *
 * Opened in the viewer rather than a new tab, for the same reason evidence is: a tab
 * hands the browser a bare file with a download button attached, and puts the signed
 * URL in the address bar where it can be copied and forwarded.
 */
function DocRowItem({ doc, projectName }: { doc: DocRow; projectName: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]"
      >
        <FileText className="size-4 shrink-0 text-brand-mid-grey" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-brand-near-black dark:text-white">{doc.file_name}</span>
          <span className="block truncate text-[11px] text-brand-mid-grey">
            {[projectName, doc.category].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-brand-mid-grey">
          {doc.file_size ? `${Math.round(doc.file_size / 1024)} KB` : ''}
        </span>
      </button>
      {open && (
        <EvidenceLightbox
          items={[{ path: doc.file_path, label: doc.file_name, bucket: 'documents' }]}
          index={0} onIndex={() => {}} onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
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
type Tab = 'documents' | 'certificates';

export default function DocumentsPage() {
  const { user } = useAuth();
  const t = useT();

  const [tab,          setTab]          = useState<Tab>('documents');
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

    fetchProjects(user.id).then(async (projs) => {
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black">{t('documents.title')}</h2>
          <p className="text-xs text-brand-mid-grey mt-0.5">
            {t('documents.subtitle')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-brand-off-white rounded-xl p-1 w-fit">
        {([
          { key: 'documents',    labelKey: 'documents.tabDocuments' as TKey,    count: docs.length   },
          { key: 'certificates', labelKey: 'documents.tabCertificates' as TKey, count: certs.length },
        ] as const).map(tab_ => (
          <button
            key={tab_.key}
            type="button"
            onClick={() => setTab(tab_.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === tab_.key
                ? 'bg-white text-brand-near-black shadow-sm border border-brand-border-grey'
                : 'text-brand-mid-grey hover:text-brand-near-black'
            }`}
          >
            {t(tab_.labelKey)}
            {!loading && tab_.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 ${
                tab === tab_.key ? 'bg-brand-near-black text-white' : 'bg-brand-border-grey text-brand-mid-grey'
              }`}>
                {tab_.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Certificates tab ──────────────────────────────── */}
      {tab === 'certificates' && (
        <>
          {certsErr && (
            <div className="flex items-center gap-3 rounded-xl border border-state-held/30 bg-brand-off-white px-4 py-3">
              <AlertCircle className="size-4 text-state-held shrink-0" />
              <p className="text-xs text-state-held">
                {t('documents.certsTableMissing')}
              </p>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"><Skeleton /></div>
          ) : certs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-border-grey py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white">
                <Award className="size-7 text-brand-border-grey" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-near-black mb-1">{t('documents.noCertificates')}</p>
                <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
                  Certificates are issued automatically when a stage is approved and completed.
                  Progress through your build to earn them.
                </p>
              </div>
              {projects.length === 0 && (
                <Link
                  to="/projects/new"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-5 py-2.5 hover:bg-black transition-colors"
                >
                  {t('documents.startBuild')}
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {certs.map(cert => <CertCard key={cert.id} cert={cert} />)}
            </div>
          )}
        </>
      )}

      {/* ── Documents tab ─────────────────────────────────── */}
      {tab === 'documents' && (
        <>
          {/* Search and the project filter, in one row above the list. Documents pile up
              across builds and the question is always "which one" — scrolling is not an
              answer once there are forty. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('documents.searchPlaceholder')}
                aria-label={t('documents.searchPlaceholder')}
                className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
              />
            </div>
            {projects.length > 1 && (
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                aria-label={t('documents.filterProject')}
                className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
              >
                <option value="">{t('documents.allProjects')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <Skeleton />
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-border-grey py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white">
                <FileText className="size-7 text-brand-border-grey" />
              </div>
              <div>
                {/* "Nothing matches" and "nothing here" are different answers, and
                    showing the wrong one sends somebody looking for a bug. */}
                <p className="mb-1 text-sm font-semibold text-brand-near-black">
                  {docs.length === 0 ? t('documents.noDocuments') : t('documents.noMatches')}
                </p>
                <p className="mx-auto max-w-xs text-xs leading-relaxed text-brand-mid-grey">
                  {docs.length === 0 ? t('documents.noDocumentsBody') : t('documents.noMatchesBody')}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <ul className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
                {shown.map(d => <DocRowItem key={d.id} doc={d} projectName={projectName(d.project_id)} />)}
              </ul>
            </div>
          )}
        </>
      )}

    </div>
  );
}
