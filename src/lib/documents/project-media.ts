import type { ProjectDocumentRow, ProjectSubstageRow } from '@/types/project';
import type { SiteUpdate } from '@/lib/supabase/site-updates';

export interface ProjectMedia {
  id: string;
  name: string;
  path: string | null;
  bucket: 'documents' | 'evidence';
  stageId: string | null;
  at: string | null;
  description: string | null;
}

export function mediaFileName(path: string): string {
  const name = path.split('?')[0].split('/').pop() || 'File';
  try { return decodeURIComponent(name); } catch { return name; }
}

/** Only real files or actual update records; stage completion never creates media. */
export function projectMedia(
  documents: ProjectDocumentRow[], updates: SiteUpdate[], substages: ProjectSubstageRow[],
): ProjectMedia[] {
  const out = new Map<string, ProjectMedia>();
  const add = (media: ProjectMedia) => {
    const key = media.path ? `${media.bucket}:${media.path}` : media.id;
    if (!out.has(key)) out.set(key, media);
  };
  for (const update of updates) {
    const paths = update.evidencePaths.filter(path => typeof path === 'string' && path.trim());
    for (const path of paths) add({ id: `${update.id}:${path}`, name: mediaFileName(path), path, bucket: 'evidence', stageId: update.stageId, at: update.submittedAt, description: update.description });
    if (paths.length === 0 && update.description?.trim()) add({ id: update.id, name: update.description, path: null, bucket: 'evidence', stageId: update.stageId, at: update.submittedAt, description: update.description });
  }
  for (const doc of documents.filter(doc => doc.category === 'site_photo')) {
    if (doc.file_path) add({ id: doc.id, name: doc.file_name, path: doc.file_path, bucket: 'documents', stageId: doc.stage_id ?? null, at: doc.created_at, description: null });
  }
  for (const sub of substages) {
    for (const path of sub.evidence_urls ?? []) {
      if (typeof path === 'string' && path.trim()) add({ id: `${sub.id}:${path}`, name: mediaFileName(path), path, bucket: 'evidence', stageId: sub.stage_id, at: sub.approved_at ?? null, description: null });
    }
  }
  return [...out.values()];
}
