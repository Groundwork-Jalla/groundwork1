import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Award, Image, FileText, Download, ExternalLink,
  Building2, ChevronRight, AlertCircle,
} from 'lucide-react';
import { useAuth }       from '@/contexts/AuthContext';
import { supabase }      from '@/lib/supabase/client';
import { fetchProjects } from '@/lib/supabase/projects';
import type { ProjectRow } from '@/types/project';

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

interface EvidenceStage {
  stageId: string;
  stageName: string;
  stageNumber: number;
  projectId: string;
  projectName: string;
  fileCount: number;
}

// ── Helpers ────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Certificate card ───────────────────────────────────────

function CertCard({ cert }: { cert: Certificate }) {
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-5 flex flex-col gap-4">
      {/* Header badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-near-black">
          <Award className="size-5 text-white" />
        </div>
        <span className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
          Verified
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
        <span>Issued to {cert.issued_to}</span>
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
              <Download className="size-3.5" /> Download PDF
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
            PDF generating…
          </span>
        )}
      </div>
    </div>
  );
}

// ── Evidence row ───────────────────────────────────────────

function EvidenceRow({ item }: { item: EvidenceStage }) {
  return (
    <Link
      to={`/projects/${item.projectId}`}
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-brand-off-white transition-colors group"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-off-white group-hover:bg-white transition-colors">
        <Image className="size-4 text-brand-mid-grey" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-brand-near-black truncate">
          Stage {item.stageNumber}: {item.stageName}
        </p>
        <p className="text-xs text-brand-mid-grey truncate">{item.projectName}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-2.5 py-0.5 text-[10px] font-semibold text-brand-mid-grey">
          <FileText className="size-2.5" />
          {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'}
        </span>
        <ChevronRight className="size-4 text-brand-border-grey group-hover:text-brand-near-black group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}

// ── Skeleton ───────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 rounded-2xl bg-brand-light-grey" />
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

type Tab = 'certificates' | 'evidence';

export default function DocumentsPage() {
  const { user } = useAuth();

  const [tab,          setTab]          = useState<Tab>('certificates');
  const [certs,        setCerts]        = useState<Certificate[]>([]);
  const [evidence,     setEvidence]     = useState<EvidenceStage[]>([]);
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

      // ── Evidence via project_stages → project_substages ─
      supabase
        .from('project_stages')
        .select('id, stage_number, project_id')
        .in('project_id', projectIds)
        .then(({ data: stages }) => {
          if (!stages?.length) {
            setEvidence([]);
            setLoading(false);
            return;
          }

          const stageIds = stages.map(s => s.id);
          const stageMap = Object.fromEntries(stages.map(s => [s.id, s]));

          supabase
            .from('project_substages')
            .select('stage_id, evidence_urls')
            .in('stage_id', stageIds)
            .then(({ data: subs }) => {
              const STAGE_NAMES = [
                'Land Secured', 'Design Completed', 'Site Preparation', 'Foundation',
                'Structure & Walls', 'Roofing', 'Electrical & Plumbing', 'Finishing',
                'Exterior Work', 'Final Handover',
              ];

              // Aggregate file counts per stage
              const stageCounts: Record<string, number> = {};
              for (const sub of subs ?? []) {
                if (!sub.evidence_urls?.length) continue;
                stageCounts[sub.stage_id] = (stageCounts[sub.stage_id] ?? 0) + sub.evidence_urls.length;
              }

              const items: EvidenceStage[] = Object.entries(stageCounts)
                .map(([stageId, count]) => {
                  const stage   = stageMap[stageId];
                  const project = stage ? projectMap[stage.project_id] : null;
                  if (!stage || !project) return null;
                  return {
                    stageId,
                    stageName:   STAGE_NAMES[stage.stage_number - 1] ?? `Stage ${stage.stage_number}`,
                    stageNumber: stage.stage_number,
                    projectId:   project.id,
                    projectName: project.name,
                    fileCount:   count,
                  } satisfies EvidenceStage;
                })
                .filter((x): x is EvidenceStage => x !== null)
                .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.stageNumber - b.stageNumber);

              setEvidence(items);
              setLoading(false);
            });
        });
    }).catch(() => setLoading(false));
  }, [user]);

  // Group evidence by project
  const evidenceByProject = evidence.reduce<Record<string, EvidenceStage[]>>((acc, item) => {
    if (!acc[item.projectId]) acc[item.projectId] = [];
    acc[item.projectId].push(item);
    return acc;
  }, {});

  const totalEvFiles = evidence.reduce((s, i) => s + i.fileCount, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black">Documents</h2>
          <p className="text-xs text-brand-mid-grey mt-0.5">
            Certificates and evidence across all your builds
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-brand-off-white rounded-xl p-1 w-fit">
        {([
          { key: 'certificates', label: 'Certificates', count: certs.length },
          { key: 'evidence',     label: 'Evidence',     count: totalEvFiles  },
        ] as const).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-brand-near-black shadow-sm border border-brand-border-grey'
                : 'text-brand-mid-grey hover:text-brand-near-black'
            }`}
          >
            {t.label}
            {!loading && t.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 ${
                tab === t.key ? 'bg-brand-near-black text-white' : 'bg-brand-border-grey text-brand-mid-grey'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Certificates tab ──────────────────────────────── */}
      {tab === 'certificates' && (
        <>
          {certsErr && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertCircle className="size-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700">
                Certificates table not yet set up. Apply migration 014 to enable this feature.
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
                <p className="text-sm font-semibold text-brand-near-black mb-1">No certificates yet</p>
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
                  Start a build
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

      {/* ── Evidence tab ──────────────────────────────────── */}
      {tab === 'evidence' && (
        <>
          {loading ? (
            <Skeleton />
          ) : evidence.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-border-grey py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white">
                <Image className="size-7 text-brand-border-grey" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-near-black mb-1">No evidence uploaded yet</p>
                <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
                  Evidence photos and documents uploaded by your contractor appear here,
                  grouped by project and stage.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary banner */}
              <div className="flex items-center gap-3 rounded-xl bg-brand-near-black px-5 py-3.5">
                <Image className="size-4 text-white/60 shrink-0" />
                <p className="text-sm font-semibold text-white flex-1">
                  {totalEvFiles} evidence {totalEvFiles === 1 ? 'file' : 'files'} across {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                </p>
                <span className="text-xs text-white/50">Click a row to view files in context</span>
              </div>

              {/* Grouped by project */}
              {Object.entries(evidenceByProject).map(([projectId, items]) => {
                const project = projects.find(p => p.id === projectId);
                const totalFiles = items.reduce((s, i) => s + i.fileCount, 0);
                return (
                  <div key={projectId} className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden">
                    {/* Project header */}
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-brand-off-white bg-brand-off-white/40">
                      <div className="flex items-center gap-2.5">
                        <Building2 className="size-4 text-brand-mid-grey shrink-0" />
                        <p className="text-sm font-semibold text-brand-near-black">
                          {project?.name ?? 'Unknown Project'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-brand-mid-grey tabular-nums">
                          {totalFiles} {totalFiles === 1 ? 'file' : 'files'} · {items.length} {items.length === 1 ? 'stage' : 'stages'}
                        </span>
                        <Link
                          to={`/projects/${projectId}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black transition-colors"
                        >
                          Open <ExternalLink className="size-3" />
                        </Link>
                      </div>
                    </div>

                    {/* Stage rows */}
                    <div className="divide-y divide-brand-off-white">
                      {items.map(item => <EvidenceRow key={item.stageId} item={item} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
