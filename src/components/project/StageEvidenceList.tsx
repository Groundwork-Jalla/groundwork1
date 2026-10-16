import { useEffect, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { listProjectFiles, type ProjectFile } from '@/lib/supabase/documents';
import { EvidenceLightbox } from '@/components/project/EvidenceLightbox';
import { useFormat, useT } from '@/lib/i18n';

/**
 * The evidence the contractor submitted, in the Documents view.
 *
 * ── Why it was missing ──────────────────────────────────────────────────────────────
 * Documents and evidence are two tables in two buckets: the vault reads
 * `project_documents`, while a contractor's photographs go to
 * `project_substages.evidence_urls` and the `evidence` bucket. So the Documents tab
 * showed nothing of the work that had actually been photographed, for the client AND
 * for the contractor who uploaded it. Reported as "nobody is seeing anything uploaded
 * in a particular project".
 *
 * They remain separate tables — evidence belongs to a substage and carries a
 * verification meaning a loose document does not — and are only brought together for
 * reading, here and in the vault beside it.
 *
 * ── Grouped by stage, because that is the question being asked ──────────────────────
 * Nobody looks for "a photograph"; they look for what was done at Foundation. A flat
 * list of forty files sorted by date answers a question nobody has.
 */
export function StageEvidenceList({ projectId }: { projectId: string }) {
  const t = useT();
  const fmt = useFormat();
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  /** Index into the FLAT list, so the arrows carry on across stage headings
   *  rather than stopping at the end of each group. */
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void listProjectFiles(projectId)
      .then(all => { if (live) setFiles(all.filter(f => f.bucket === 'evidence')); })
      // Never fatal: the documents beside this must still render.
      .catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [projectId]);

  if (files === null) {
    return <p role="status" className="flex items-center gap-2 py-4 text-xs text-brand-mid-grey">
      <Loader2 className="size-3.5 animate-spin" />{t('common.loading')}
    </p>;
  }
  if (files.length === 0) {
    // Said plainly rather than hiding the section: "there is none yet" and "this view
    // does not show evidence" look identical when the answer is an absent heading.
    return <p className="py-4 text-xs text-brand-mid-grey">{t('project.evidence.none')}</p>;
  }

  const byStage = new Map<number | null, ProjectFile[]>();
  for (const f of files) {
    const list = byStage.get(f.stageNumber) ?? [];
    list.push(f);
    byStage.set(f.stageNumber, list);
  }
  const stages = [...byStage.keys()].sort((a, b) => (a ?? 99) - (b ?? 99));

  return (
    <div className="space-y-4">
      {at !== null && (
        <EvidenceLightbox
          items={files.map(f => ({ path: f.path, label: f.name, bucket: f.bucket }))}
          index={at} onIndex={setAt} onClose={() => setAt(null)}
        />
      )}
      {stages.map(n => (
        <div key={String(n)}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
            {n === null ? t('project.evidence.unplaced') : t('project.evidence.stageN', { n })}
          </p>
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {byStage.get(n)!.map(f => (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => setAt(files.indexOf(f))}
                  className="flex w-full items-center gap-3 py-2 text-left hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]"
                >
                  <Camera className="size-4 shrink-0 text-brand-mid-grey" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-brand-near-black dark:text-white">{f.name}</span>
                    {f.substageName && (
                      <span className="block truncate text-[11px] text-brand-mid-grey">{f.substageName}</span>
                    )}
                  </span>
                  {f.createdAt && (
                    <span className="shrink-0 text-[11px] text-brand-mid-grey">{fmt.date(f.createdAt)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
