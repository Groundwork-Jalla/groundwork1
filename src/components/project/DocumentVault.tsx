import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Trash2, FolderOpen, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileIcon, formatFileSize } from '@/components/ui/FileIcon';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

import {
  fetchDocuments,
  uploadDocument,
  getSignedDocumentUrl,
  deleteDocument,
} from '@/lib/supabase/documents';
import type { ProjectDocumentRow } from '@/types/project';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-brand-border-grey last:border-0">
      <div className="size-8 rounded-md bg-brand-light-grey animate-pulse shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/2 rounded bg-brand-light-grey animate-pulse" />
        <div className="h-2.5 w-1/4 rounded bg-brand-light-grey animate-pulse" />
      </div>
      <div className="h-3 w-12 rounded bg-brand-light-grey animate-pulse hidden sm:block" />
      <div className="h-3 w-10 rounded bg-brand-light-grey animate-pulse hidden sm:block" />
      <div className="flex gap-1.5">
        <div className="size-8 rounded-md bg-brand-light-grey animate-pulse" />
        <div className="size-8 rounded-md bg-brand-light-grey animate-pulse" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  progress: number; // 0–100
}

function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div className="h-0.5 w-full bg-brand-border-grey overflow-hidden">
      <motion.div
        className="h-full bg-brand-near-black"
        initial={{ width: '0%' }}
        animate={{ width: `${progress}%` }}
        transition={{ ease: 'easeOut', duration: 0.15 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop table row
// ---------------------------------------------------------------------------

interface DocRowProps {
  doc: ProjectDocumentRow;
  onDownload: (doc: ProjectDocumentRow) => void;
  onDeleteRequest: (doc: ProjectDocumentRow) => void;
  downloadingId: string | null;
}

function DesktopDocRow({ doc, onDownload, onDeleteRequest, downloadingId }: DocRowProps) {
  return (
    <motion.tr
      key={doc.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="border-b border-brand-border-grey last:border-0 group"
    >
      {/* Filename */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 text-brand-mid-grey">
            <FileIcon mimeType={doc.mime_type} fileName={doc.file_name} className="size-4" />
          </span>
          <span
            className="text-sm font-medium text-brand-near-black truncate max-w-[240px]"
            title={doc.file_name}
          >
            {doc.file_name}
          </span>
        </div>
      </td>

      {/* Date */}
      <td className="px-4 py-3 text-xs text-brand-mid-grey whitespace-nowrap font-variant-numeric tabular-nums">
        {formatDate(doc.created_at)}
      </td>

      {/* Size */}
      <td className="px-4 py-3 text-xs text-brand-mid-grey whitespace-nowrap tabular-nums">
        {formatFileSize(doc.file_size)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Download ${doc.file_name}`}
            disabled={downloadingId === doc.id}
            onClick={() => onDownload(doc)}
            className="size-8 text-brand-mid-grey hover:text-brand-near-black"
          >
            <Download className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${doc.file_name}`}
            onClick={() => onDeleteRequest(doc)}
            className="size-8 text-brand-mid-grey hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </td>
    </motion.tr>
  );
}

// ---------------------------------------------------------------------------
// Mobile card
// ---------------------------------------------------------------------------

function MobileDocCard({ doc, onDownload, onDeleteRequest, downloadingId }: DocRowProps) {
  return (
    <motion.div
      key={doc.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="rounded-lg border border-brand-border-grey p-3 flex items-center gap-3 bg-white"
    >
      {/* Icon */}
      <span className="shrink-0 text-brand-mid-grey">
        <FileIcon mimeType={doc.mime_type} fileName={doc.file_name} className="size-5" />
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium text-brand-near-black truncate"
          title={doc.file_name}
        >
          {doc.file_name}
        </p>
        <p className="text-xs text-brand-mid-grey mt-0.5">
          {formatDate(doc.created_at)}
          {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Download ${doc.file_name}`}
          disabled={downloadingId === doc.id}
          onClick={() => onDownload(doc)}
          className="size-8 text-brand-mid-grey hover:text-brand-near-black"
        >
          <Download className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${doc.file_name}`}
          onClick={() => onDeleteRequest(doc)}
          className="size-8 text-brand-mid-grey hover:text-red-600"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface DocumentVaultProps {
  projectId: string;
  userId: string;
}

export function DocumentVault({ projectId, userId }: DocumentVaultProps) {
  // ---- state ----
  const [docs, setDocs] = useState<ProjectDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProjectDocumentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- fetch on mount ----
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const data = await fetchDocuments(projectId);
        if (!cancelled) setDocs(data);
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : 'Failed to load documents.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ---- upload ----
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be re-selected if needed
      e.target.value = '';

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError('File exceeds the 25 MB limit. Please choose a smaller file.');
        return;
      }

      setUploading(true);
      setUploadProgress(0);
      setUploadError(null);

      try {
        const newDoc = await uploadDocument(projectId, userId, file, (pct) => {
          setUploadProgress(pct);
        });
        // Prepend — newest first
        setDocs((prev) => [newDoc, ...prev]);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : 'Upload failed. Please try again.'
        );
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [projectId, userId]
  );

  // ---- download ----
  const handleDownload = useCallback(async (doc: ProjectDocumentRow) => {
    setDownloadingId(doc.id);
    try {
      const url = await getSignedDocumentUrl(doc.file_path);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setDownloadingId(null);
    }
  }, []);

  // ---- delete ----
  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocument(pendingDelete);
      setDocs((prev) => prev.filter((d) => d.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Delete failed. Please try again.'
      );
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete]);

  // ---- render ----
  return (
    <section className="font-sans">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h2 className="text-sm font-medium text-brand-near-black">Documents</h2>
        <Button
          type="button"
          size="default"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className={cn('w-full sm:w-auto gap-1.5')}
        >
          <Upload className="size-4" />
          {uploading ? 'Uploading…' : 'Upload Document'}
        </Button>
      </div>

      {/* Error banners */}
      <AnimatePresence mode="popLayout">
        {fetchError && (
          <motion.div
            key="fetch-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
          >
            {fetchError}
          </motion.div>
        )}
        {uploadError && (
          <motion.div
            key="upload-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
          >
            {uploadError}
          </motion.div>
        )}
        {deleteError && (
          <motion.div
            key="delete-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
          >
            {deleteError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* List area */}
      <div className="rounded-xl border border-brand-border-grey overflow-hidden">
        {/* Upload progress bar */}
        <AnimatePresence>
          {uploading && (
            <motion.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ProgressBar progress={uploadProgress} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading skeleton */}
        {loading && (
          <div>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}

        {/* Empty state */}
        {!loading && docs.length === 0 && !fetchError && (
          <EmptyState
            icon={<FolderOpen className="size-10" />}
            title="No documents yet"
            description="Upload contracts, permits, or plans to keep everything in one place."
          />
        )}

        {/* Desktop table — hidden on mobile */}
        {!loading && docs.length > 0 && (
          <>
            {/* sm+ table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-brand-border-grey bg-brand-off-white">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-mid-grey">
                      File
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-mid-grey whitespace-nowrap">
                      Uploaded
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-mid-grey">
                      Size
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-brand-mid-grey">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {docs.map((doc) => (
                      <DesktopDocRow
                        key={doc.id}
                        doc={doc}
                        onDownload={handleDownload}
                        onDeleteRequest={setPendingDelete}
                        downloadingId={downloadingId}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {/* Mobile card stack — visible only below sm */}
            <div className="sm:hidden flex flex-col gap-2 p-3">
              <AnimatePresence initial={false}>
                {docs.map((doc) => (
                  <MobileDocCard
                    key={doc.id}
                    doc={doc}
                    onDownload={handleDownload}
                    onDeleteRequest={setPendingDelete}
                    downloadingId={downloadingId}
                  />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete document"
        description={
          pendingDelete
            ? `"${pendingDelete.file_name}" will be permanently removed and cannot be recovered.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      />
    </section>
  );
}

export default DocumentVault;
