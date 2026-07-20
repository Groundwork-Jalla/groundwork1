import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Trash2, FolderOpen, Upload, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileIcon, formatFileSize } from '@/components/ui/FileIcon';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { supabase } from '@/lib/supabase/client';
import {
  getStorageLimit,
  getProjectStorageUsed,
  formatBytes,
} from '@/lib/storage-limits';

import {
  fetchDocuments,
  uploadDocument,
  getSignedDocumentUrl,
  deleteDocument,
} from '@/lib/supabase/documents';
import type { ProjectDocumentRow, DocumentCategory } from '@/types/project';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  contract:   'Contract',
  permit:     'Permit',
  receipt:    'Receipt',
  invoice:    'Invoice',
  report:     'Report',
  site_photo: 'Site Photo',
  other:      'Other',
};

const CATEGORY_ORDER: DocumentCategory[] = [
  'contract', 'permit', 'receipt', 'invoice', 'report', 'site_photo', 'other',
];

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

function groupByCategory(docs: ProjectDocumentRow[]): Map<DocumentCategory, ProjectDocumentRow[]> {
  const map = new Map<DocumentCategory, ProjectDocumentRow[]>();
  for (const cat of CATEGORY_ORDER) map.set(cat, []);
  for (const doc of docs) {
    const cat = (doc.category as DocumentCategory) ?? 'other';
    map.get(cat)!.push(doc);
  }
  // Remove empty groups
  for (const [k, v] of map) if (v.length === 0) map.delete(k);
  return map;
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

function CategoryBadge({ category }: { category: DocumentCategory }) {
  return (
    <span className="inline-flex items-center rounded-full border border-brand-border-grey dark:border-[#2c2c2c] px-1.5 py-px text-[9px] font-medium text-brand-mid-grey uppercase tracking-wide whitespace-nowrap">
      {CATEGORY_LABELS[category] ?? 'Other'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: number }) {
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
  const category = (doc.category as DocumentCategory) ?? 'other';
  return (
    <motion.tr
      key={doc.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="border-b border-brand-border-grey dark:border-[#2c2c2c] last:border-0 group"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 text-brand-mid-grey">
            <FileIcon mimeType={doc.mime_type} fileName={doc.file_name} className="size-4" />
          </span>
          <span className="text-sm font-medium text-brand-near-black dark:text-white truncate max-w-50" title={doc.file_name}>
            {doc.file_name}
          </span>
          <CategoryBadge category={category} />
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-brand-mid-grey whitespace-nowrap tabular-nums">
        {formatDate(doc.created_at)}
      </td>
      <td className="px-4 py-3 text-xs text-brand-mid-grey whitespace-nowrap tabular-nums">
        {formatFileSize(doc.file_size)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="icon" aria-label={`Download ${doc.file_name}`} disabled={downloadingId === doc.id} onClick={() => onDownload(doc)} className="size-8 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
            <Download className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${doc.file_name}`} onClick={() => onDeleteRequest(doc)} className="size-8 text-brand-mid-grey hover:text-red-600">
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
  const category = (doc.category as DocumentCategory) ?? 'other';
  return (
    <motion.div
      key={doc.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] p-3 flex items-center gap-3 bg-white dark:bg-[#1e1e1e]"
    >
      <span className="shrink-0 text-brand-mid-grey">
        <FileIcon mimeType={doc.mime_type} fileName={doc.file_name} className="size-5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-brand-near-black dark:text-white truncate" title={doc.file_name}>
          {doc.file_name}
        </p>
        <p className="text-xs text-brand-mid-grey mt-0.5 flex items-center gap-1.5 flex-wrap">
          {formatDate(doc.created_at)}
          {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
          <CategoryBadge category={category} />
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" aria-label={`Download ${doc.file_name}`} disabled={downloadingId === doc.id} onClick={() => onDownload(doc)} className="size-8 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white">
          <Download className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Delete ${doc.file_name}`} onClick={() => onDeleteRequest(doc)} className="size-8 text-brand-mid-grey hover:text-red-600">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Category section header (used in grouped view)
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  docs,
  onDownload,
  onDeleteRequest,
  downloadingId,
}: {
  category: DocumentCategory;
  docs: ProjectDocumentRow[];
  onDownload: (doc: ProjectDocumentRow) => void;
  onDeleteRequest: (doc: ProjectDocumentRow) => void;
  downloadingId: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 bg-brand-off-white dark:bg-[#1a1a1a] border-b border-brand-border-grey dark:border-[#2c2c2c] hover:bg-brand-light-grey dark:hover:bg-[#242424] transition-colors"
      >
        <span className="text-xs font-semibold text-brand-near-black dark:text-white uppercase tracking-wide">
          {CATEGORY_LABELS[category]}
          <span className="ml-1.5 font-normal text-brand-mid-grey">({docs.length})</span>
        </span>
        <ChevronDown className={cn('size-3.5 text-brand-mid-grey transition-transform', !open && '-rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Desktop */}
            <div className="hidden sm:block">
              <table className="w-full min-w-130">
                <tbody>
                  <AnimatePresence initial={false}>
                    {docs.map(doc => (
                      <DesktopDocRow key={doc.id} doc={doc} onDownload={onDownload} onDeleteRequest={onDeleteRequest} downloadingId={downloadingId} />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            {/* Mobile */}
            <div className="sm:hidden flex flex-col gap-2 p-3">
              <AnimatePresence initial={false}>
                {docs.map(doc => (
                  <MobileDocCard key={doc.id} doc={doc} onDownload={onDownload} onDeleteRequest={onDeleteRequest} downloadingId={downloadingId} />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category select modal (shown after file chosen, before upload)
// ---------------------------------------------------------------------------

function CategorySelectModal({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (category: DocumentCategory) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<DocumentCategory>('other');
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        className="bg-white dark:bg-brand-rich-black rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] w-full max-w-sm p-5 shadow-lg"
      >
        <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-0.5">Categorise document</p>
        <p className="text-xs text-brand-mid-grey mb-4 truncate" title={file.name}>{file.name}</p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {CATEGORY_ORDER.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelected(cat)}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors',
                selected === cat
                  ? 'border-brand-near-black dark:border-white bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                  : 'border-brand-border-grey dark:border-[#2c2c2c] text-brand-near-black dark:text-white hover:bg-brand-off-white dark:hover:bg-[#282828]',
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={() => onConfirm(selected)}>
            Upload
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface DocumentVaultProps {
  projectId: string;
  userId: string;
  tier: string;
}

export function DocumentVault({ projectId, userId, tier }: DocumentVaultProps) {
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

  const [storageUsed, setStorageUsed] = useState<number | null>(null);

  // Category state
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | 'all'>('all');
  const [pendingFile, setPendingFile] = useState<File | null>(null); // awaiting category pick

  const fileInputRef = useRef<HTMLInputElement>(null);
  const storageLimit = getStorageLimit(tier);
  const hasStorageLimit = storageLimit !== Infinity;

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
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load documents.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ---- storage usage ----
  useEffect(() => {
    if (!hasStorageLimit) return;
    getProjectStorageUsed(supabase, projectId).then(setStorageUsed).catch(() => {});
  }, [projectId, hasStorageLimit]);

  // ---- file input change: validate then open category modal ----
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError('File exceeds the 25 MB limit. Please choose a smaller file.');
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
    [projectId, hasStorageLimit, storageLimit, storageUsed]
  );

  // ---- actual upload (called after category confirmed) ----
  const handleUploadWithCategory = useCallback(
    async (file: File, category: DocumentCategory) => {
      setPendingFile(null);
      setUploading(true);
      setUploadProgress(0);
      setUploadError(null);
      try {
        const newDoc = await uploadDocument(projectId, userId, file, (pct) => {
          setUploadProgress(pct);
        }, category);
        setDocs(prev => [newDoc, ...prev]);
        if (hasStorageLimit) {
          getProjectStorageUsed(supabase, projectId).then(setStorageUsed).catch(() => {});
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [projectId, userId, hasStorageLimit, storageLimit]
  );

  // ---- download ----
  const handleDownload = useCallback(async (doc: ProjectDocumentRow) => {
    setDownloadingId(doc.id);
    try {
      const url = await getSignedDocumentUrl(doc.file_path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
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
      setDocs(prev => prev.filter(d => d.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete]);

  // ---- derived: filtered + grouped docs ----
  const filteredDocs = filterCategory === 'all'
    ? docs
    : docs.filter(d => (d.category ?? 'other') === filterCategory);

  const grouped = groupByCategory(filteredDocs);
  const categoriesWithDocs = CATEGORY_ORDER.filter(c => grouped.has(c));

  // Count per category (from all docs, not filtered, for filter chip counts)
  const countByCategory = (cat: DocumentCategory) => docs.filter(d => (d.category ?? 'other') === cat).length;

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

      {/* Category select modal */}
      <AnimatePresence>
        {pendingFile && (
          <CategorySelectModal
            file={pendingFile}
            onConfirm={cat => handleUploadWithCategory(pendingFile, cat)}
            onCancel={() => setPendingFile(null)}
          />
        )}
      </AnimatePresence>

      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-medium text-brand-near-black dark:text-white">Documents</h2>
          {hasStorageLimit && storageUsed !== null && (
            <div className="flex items-center gap-1.5 text-xs text-brand-mid-grey">
              <div className="w-16 h-1 rounded-full bg-brand-border-grey overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    storageUsed / storageLimit > 0.9 ? 'bg-red-500'
                    : storageUsed / storageLimit > 0.7 ? 'bg-amber-400'
                    : 'bg-brand-near-black'
                  )}
                  style={{ width: `${Math.min((storageUsed / storageLimit) * 100, 100)}%` }}
                />
              </div>
              <span>{formatBytes(storageUsed)} / {formatBytes(storageLimit)}</span>
            </div>
          )}
        </div>
        <Button
          type="button"
          size="default"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full sm:w-auto gap-1.5"
        >
          <Upload className="size-4" />
          {uploading ? 'Uploading…' : 'Upload Document'}
        </Button>
      </div>

      {/* Category filter chips */}
      {docs.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          <button
            type="button"
            onClick={() => setFilterCategory('all')}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              filterCategory === 'all'
                ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                : 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
            )}
          >
            All ({docs.length})
          </button>
          {CATEGORY_ORDER.filter(cat => countByCategory(cat) > 0).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                filterCategory === cat
                  ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                  : 'border border-brand-border-grey dark:border-[#2c2c2c] text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              {CATEGORY_LABELS[cat]} ({countByCategory(cat)})
            </button>
          ))}
        </div>
      )}

      {/* Error banners */}
      <AnimatePresence mode="popLayout">
        {fetchError && (
          <motion.div key="fetch-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            {fetchError}
          </motion.div>
        )}
        {uploadError && (
          <motion.div key="upload-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            {uploadError}
          </motion.div>
        )}
        {deleteError && (
          <motion.div key="delete-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            {deleteError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* List area */}
      <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
        {/* Upload progress bar */}
        <AnimatePresence>
          {uploading && (
            <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
        {!loading && filteredDocs.length === 0 && !fetchError && (
          <EmptyState
            icon={<FolderOpen className="size-10" />}
            title={filterCategory === 'all' ? 'No documents yet' : `No ${CATEGORY_LABELS[filterCategory as DocumentCategory]} documents`}
            description={filterCategory === 'all'
              ? 'Upload contracts, permits, or plans to keep everything in one place.'
              : 'Try another category or upload a document.'}
          />
        )}

        {/* Grouped sections */}
        {!loading && filteredDocs.length > 0 && (
          <div>
            {categoriesWithDocs.map((cat, i) => (
              <div key={cat} className={cn(i > 0 && 'border-t border-brand-border-grey dark:border-[#2c2c2c]')}>
                <CategorySection
                  category={cat}
                  docs={grouped.get(cat)!}
                  onDownload={handleDownload}
                  onDeleteRequest={setPendingDelete}
                  downloadingId={downloadingId}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete document"
        description={
          pendingDelete ? `"${pendingDelete.file_name}" will be permanently removed and cannot be recovered.` : ''
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
