import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Upload } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchDocuments, uploadDocument } from '@/lib/supabase/documents';
import { formatBytes, getProjectStorageUsed, getStorageLimit } from '@/lib/storage-limits';
import { FILE_ACCEPT_ATTR, MAX_FILE_MB, fileProblem } from '@/lib/documents/accepted-files';
import { errorMessage } from '@/lib/errors';
import { CategorySelectModal } from '@/components/project/DocumentVault';
import { ProjectDocuments, type DocumentStage } from '@/components/project/ProjectDocuments';
import type { DocumentCategory, ProjectDocumentRow } from '@/types/project';

// =========================================================
// The client's Documents tab — the contractor's view, plus the one thing the client
// does that the contractor does not.
//
// Favour, 11 Nov 2026: "i want the client document view to look the same as the
// contractor document view". So the view IS the contractor's: `ProjectDocuments`, the
// same file, the same chips, the same three groups. This adds uploading around it.
//
// ── WHY UPLOADING STAYS HERE AND NOT IN THE SHARED VIEW ─────────────────────────────
// The contractor's tab offers no upload at all — a contractor files evidence against a
// stage, which is a different act in a different place. A client uploads receipts,
// contracts and permits straight onto the project. Putting it in the shared view would
// mean a button the contractor's side has to switch off, and a switched-off button is
// how a view starts having two personalities again.
//
// ── READ-ONLY VIEWERS ───────────────────────────────────────────────────────────────
// `canUpload` is false for an invited client on somebody else's build (112). The server
// refuses them anyway; this just does not offer an action that would be refused.
// =========================================================

export function ClientDocuments({
  projectId, userId, tier, stages, canUpload = true,
}: {
  projectId: string;
  userId: string;
  tier: string;
  stages: DocumentStage[];
  canUpload?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<ProjectDocumentRow[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);

  const storageLimit = getStorageLimit(tier);
  const hasStorageLimit = Number.isFinite(storageLimit);

  useEffect(() => {
    let alive = true;
    fetchDocuments(projectId)
      .then(rows => { if (alive) setDocs(rows); })
      .catch(() => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (!hasStorageLimit) return;
    getProjectStorageUsed(supabase, projectId).then(setStorageUsed).catch(() => {});
  }, [projectId, hasStorageLimit]);

  /** Validate against the bucket's own rules, then ask what kind of file it is. */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      // The bucket's rules, not this screen's: a file that passes here and fails at
      // Storage is an upload that vanishes silently. See accepted-files.ts.
      const problem = fileProblem(file);
      if (problem) {
        setUploadError(t(problem === 'size' ? 'project.documents.tooLarge' : 'project.documents.badType',
          { mb: MAX_FILE_MB }));
        return;
      }

      if (hasStorageLimit) {
        const used = storageUsed ?? await getProjectStorageUsed(supabase, projectId);
        if (used + file.size > storageLimit) {
          setUploadError(`Storage limit reached (${formatBytes(storageLimit)} for Self Verify). Upgrade to Jalla Verify for unlimited storage.`);
          return;
        }
      }

      setUploadError(null);
      setPendingFile(file);
    },
    [projectId, hasStorageLimit, storageLimit, storageUsed, t],
  );

  const handleUploadWithCategory = useCallback(
    async (file: File, category: DocumentCategory) => {
      setPendingFile(null);
      setUploading(true);
      setUploadError(null);
      try {
        const newDoc = await uploadDocument(projectId, userId, file, () => {}, category);
        // Straight into the list the shared view renders, so the file appears under the
        // group it was just filed in rather than after a reload.
        setDocs(prev => [newDoc, ...prev]);
        if (hasStorageLimit) {
          getProjectStorageUsed(supabase, projectId).then(setStorageUsed).catch(() => {});
        }
      } catch (err) {
        setUploadError(errorMessage(err, 'Upload failed. Please try again.'));
      } finally {
        setUploading(false);
      }
    },
    [projectId, userId, hasStorageLimit],
  );

  return (
    <>
      <ProjectDocuments
        projectId={projectId}
        stages={stages}
        documents={docs}
        toolbar={canUpload ? (
          <>
            <input
              ref={inputRef} type="file" className="hidden"
              accept={FILE_ACCEPT_ATTR} onChange={handleFileChange}
            />
            <button
              type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-near-black px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
            >
              {uploading
                ? <Loader2 className="size-4 animate-spin" aria-hidden />
                : <Upload className="size-4" aria-hidden />}
              {t('project.documents.uploadCta')}
            </button>
          </>
        ) : undefined}
      />

      {uploadError && (
        <p role="alert" className="mt-3 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-xs text-state-alert dark:bg-[#1e1e1e]">
          {uploadError}
        </p>
      )}

      <AnimatePresence>
        {pendingFile && (
          <CategorySelectModal
            file={pendingFile}
            onConfirm={category => void handleUploadWithCategory(pendingFile, category)}
            onCancel={() => setPendingFile(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default ClientDocuments;
