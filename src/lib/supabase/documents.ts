import { supabase } from './client';
import type { ProjectDocumentRow } from '@/types/project';

// =========================================================
// uploadDocument
// Uploads to Storage + inserts metadata record
// =========================================================
export async function uploadDocument(
  projectId: string,
  userId: string,
  file: File,
  onProgress?: (pct: number) => void,
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
