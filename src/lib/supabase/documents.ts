import { supabase } from './client';
import type { ProjectDocumentRow, DocumentCategory } from '@/types/project';

// =========================================================
// uploadDocument
// Uploads to Storage + inserts metadata record
// =========================================================
export async function uploadDocument(
  projectId: string,
  userId: string,
  file: File,
  onProgress?: (pct: number) => void,
  category: DocumentCategory = 'other',
): Promise<ProjectDocumentRow> {
  const timestamp = Date.now();
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path      = `${projectId}/${timestamp}_${safeName}`;

  // Fake progress: animate to 90% during upload, 100% on complete
  let animFrame: ReturnType<typeof setInterval> | null = null;
  let fakeProgress = 0;
  if (onProgress) {
    animFrame = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + 8, 90);
      onProgress(fakeProgress);
    }, 120);
  }

  try {
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(path, file, { upsert: false });

    if (uploadError) throw uploadError;
  } finally {
    if (animFrame) clearInterval(animFrame);
    if (onProgress) onProgress(100);
  }

  const { data, error } = await supabase
    .from('project_documents')
    .insert({
      project_id:  projectId,
      file_name:   file.name,
      file_path:   path,
      file_size:   file.size,
      mime_type:   file.type || null,
      uploaded_by: userId,
      category,
    })
    .select()
    .single<ProjectDocumentRow>();

  if (error) throw error;
  return data;
}

// =========================================================
// fetchDocuments — ordered by newest first
// =========================================================
export async function fetchDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// getSignedDocumentUrl — 1-hour signed download URL
// =========================================================
export async function getSignedDocumentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// =========================================================
// deleteDocument — removes storage object + DB record
// =========================================================
export async function deleteDocument(doc: ProjectDocumentRow): Promise<void> {
  await supabase.storage.from('documents').remove([doc.file_path]);

  const { error } = await supabase
    .from('project_documents')
    .delete()
    .eq('id', doc.id);

  if (error) throw error;
}

/**
 * A time-limited link to one private file, in either bucket.
 *
 * `getSignedDocumentUrl` hardcodes `documents`, which is right for the vault and wrong
 * for stage evidence — that lives in `evidence`. Both buckets are private and have no
 * public path at all, so every view of a file goes through a signed URL; a reader is
 * admitted by the member policies (092), not by knowing the path.
 *
 * Signed on demand rather than for every file on the page: a stage with twenty
 * photographs would otherwise mint twenty URLs nobody opens, and each one is a
 * capability that lives for an hour.
 */
export async function signedUrlIn(
  bucket: 'documents' | 'evidence', path: string,
  /**
   * Ask the storage layer to resize before sending. A thumbnail grid would otherwise
   * pull the full photographs — several megabytes each, over a phone connection on a
   * building site. Supabase only honours this where the image-transform add-on is
   * enabled, so the caller must be able to fall back to the original.
   */
  thumb?: { width: number; height: number },
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(
    path, 3600,
    thumb ? { transform: { width: thumb.width, height: thumb.height, resize: 'cover' } } : undefined,
  );
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Everything attached to a project: uploaded documents AND stage evidence.
 *
 * ── Why they were invisible to each other ───────────────────────────────────────────
 * They are two tables in two buckets. The Documents view read `project_documents`; the
 * contractor's evidence goes to `project_substages.evidence_urls` and the `evidence`
 * bucket. So a client looking in Documents saw nothing of the work that had actually
 * been photographed, and a contractor could not find their own submissions there either.
 * Reported as "nobody is seeing anything uploaded in a particular project".
 *
 * They stay separate tables — evidence belongs to a substage and carries a verification
 * meaning that a loose document does not — and are merged only for reading.
 */
export interface ProjectFile {
  key: string;
  name: string;
  path: string;
  bucket: 'documents' | 'evidence';
  /** A `DocumentCategory` for an uploaded document, or 'evidence' for stage evidence. */
  kind: string;
  stageNumber: number | null;
  substageName: string | null;
  createdAt: string | null;
  size: number | null;
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const [docs, subs, stages] = await Promise.all([
    supabase.from('project_documents')
      .select('id, file_name, file_path, file_size, category, created_at')
      .eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('project_substages')
      .select('id, name, stage_id, evidence_urls, completed_at, created_at')
      .eq('project_id', projectId),
    supabase.from('project_stages')
      .select('id, stage_number').eq('project_id', projectId),
  ]);

  const out: ProjectFile[] = [];

  for (const d of ((docs.data ?? []) as Record<string, unknown>[])) {
    out.push({
      key: `doc:${String(d.id)}`,
      name: String(d.file_name ?? ''),
      path: String(d.file_path ?? ''),
      bucket: 'documents',
      kind: typeof d.category === 'string' && d.category ? d.category : 'other',
      stageNumber: null, substageName: null,
      createdAt: typeof d.created_at === 'string' ? d.created_at : null,
      size: typeof d.file_size === 'number' ? d.file_size : null,
    });
  }

  const stageNo = new Map<string, number>();
  for (const s of ((stages.data ?? []) as Record<string, unknown>[])) {
    if (typeof s.stage_number === 'number') stageNo.set(String(s.id), s.stage_number);
  }

  for (const s of ((subs.data ?? []) as Record<string, unknown>[])) {
    const paths = Array.isArray(s.evidence_urls) ? (s.evidence_urls as unknown[]).map(String) : [];
    paths.forEach((p, i) => {
      out.push({
        // The path, not the index: a substage's array is reordered when one is removed,
        // and a key that shifts re-mounts every row after it.
        key: `ev:${String(s.id)}:${p}`,
        // Evidence is stored by path alone — there is no stored display name — so the
        // file's own last segment is the honest label, with the upload prefix dropped.
        name: (p.split('/').pop() ?? p).replace(/^\d+_/, '') || `Evidence ${i + 1}`,
        path: p,
        bucket: 'evidence',
        kind: 'evidence',
        stageNumber: stageNo.get(String(s.stage_id)) ?? null,
        substageName: typeof s.name === 'string' ? s.name : null,
        createdAt: typeof s.completed_at === 'string' ? s.completed_at
                 : typeof s.created_at === 'string' ? s.created_at : null,
        size: null,
      });
    });
  }

  // Newest first, with undated rows last rather than pretending to be oldest.
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
