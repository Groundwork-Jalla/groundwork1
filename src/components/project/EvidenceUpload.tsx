import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileIcon, formatFileSize } from '@/components/ui/FileIcon';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface EvidenceUploadProps {
  projectId: string;
  stageId: string;
  substageId: string;
  existingUrls: string[];
  onUploadComplete: (newUrls: string[]) => void;
}

interface UploadingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  done: boolean;
}

interface ThumbnailItem {
  path: string;
  isImage: boolean;
  fileName: string;
  signedUrl: string | null;
  loadingSignedUrl: boolean;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

function buildStoragePath(
  projectId: string,
  stageId: string,
  substageId: string,
  fileName: string
): string {
  return `${projectId}/${stageId}/${substageId}/${Date.now()}_${fileName}`;
}

function useThumbnails(paths: string[]) {
  const [items, setItems] = useState<ThumbnailItem[]>([]);

  useEffect(() => {
    const normalized: ThumbnailItem[] = paths.map((path) => ({
      path,
      isImage: isImagePath(path),
      fileName: fileNameFromPath(path),
      signedUrl: null,
      loadingSignedUrl: isImagePath(path),
    }));
    setItems(normalized);

    let cancelled = false;

    const imagePaths = normalized.filter((item) => item.isImage);

    (async () => {
      for (const item of imagePaths) {
        const { data } = await supabase.storage
          .from('evidence')
          .createSignedUrl(item.path, 3600);

        if (cancelled) return;

        const signedUrl = data?.signedUrl ?? null;

        setItems((prev) =>
          prev.map((p) =>
            p.path === item.path
              ? { ...p, signedUrl, loadingSignedUrl: false }
              : p
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  return items;
}

export function EvidenceUpload({
  projectId,
  stageId,
  substageId,
  existingUrls,
  onUploadComplete,
}: EvidenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [sizeErrors, setSizeErrors] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const thumbnails = useThumbnails(existingUrls);

  const updateFileProgress = useCallback(
    (id: string, patch: Partial<UploadingFile>) => {
      setUploadingFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
      );
    },
    []
  );

  const animateProgress = useCallback(
    (id: string): (() => void) => {
      const interval = setInterval(() => {
        setUploadingFiles((prev) =>
          prev.map((f) => {
            if (f.id !== id || f.progress >= 90) return f;
            return { ...f, progress: Math.min(f.progress + 8, 90) };
          })
        );
      }, 120);
      return () => clearInterval(interval);
    },
    []
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);

      const sizeErrs: string[] = [];
      const validFiles: File[] = [];

      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          sizeErrs.push(
            `"${file.name}" exceeds the 10 MB limit (${formatFileSize(file.size)}).`
          );
        } else {
          validFiles.push(file);
        }
      }

      setSizeErrors(sizeErrs);
      setGlobalError(null);

      if (inputRef.current) inputRef.current.value = '';

      if (validFiles.length === 0) return;

      const entries: UploadingFile[] = validFiles.map((file) => ({
        id: `${Date.now()}_${file.name}`,
        name: file.name,
        size: file.size,
        progress: 0,
        error: null,
        done: false,
      }));

      setUploadingFiles(entries);
      setUploading(true);

      const uploadedPaths: string[] = [];

      for (const entry of entries) {
        const file = validFiles.find((f) => f.name === entry.name)!;
        const storagePath = buildStoragePath(projectId, stageId, substageId, file.name);

        const stopAnimation = animateProgress(entry.id);

        const { error } = await supabase.storage
          .from('evidence')
          .upload(storagePath, file, { upsert: false });

        stopAnimation();

        if (error) {
          updateFileProgress(entry.id, {
            progress: 0,
            error: error.message ?? 'Upload failed.',
            done: false,
          });
          setGlobalError('One or more files failed to upload. Check errors below.');
        } else {
          updateFileProgress(entry.id, { progress: 100, done: true, error: null });
          uploadedPaths.push(storagePath);
        }
      }

      if (uploadedPaths.length > 0) {
        const newUrls = [...existingUrls, ...uploadedPaths];

        const { error: dbError } = await supabase
          .from('project_substages')
          .update({ evidence_urls: newUrls })
          .eq('id', substageId);

        if (dbError) {
          setGlobalError(
            'Files uploaded but could not save references. Please refresh and try again.'
          );
        } else {
          onUploadComplete(newUrls);
        }
      }

      setUploading(false);

      setTimeout(() => {
        setUploadingFiles((prev) => prev.filter((f) => !f.done));
      }, 1200);
    },
    [
      projectId,
      stageId,
      substageId,
      existingUrls,
      onUploadComplete,
      animateProgress,
      updateFileProgress,
    ]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    const newUrls = existingUrls.filter((u) => u !== deleteTarget);

    const { error } = await supabase
      .from('project_substages')
      .update({ evidence_urls: newUrls })
      .eq('id', substageId);

    if (error) {
      setGlobalError('Could not remove file. Please try again.');
    } else {
      onUploadComplete(newUrls);
    }

    setDeleting(false);
    setDeleteTarget(null);
  }, [deleteTarget, existingUrls, substageId, onUploadComplete]);

  const handleRetry = useCallback(() => {
    setGlobalError(null);
    setSizeErrors([]);
    setUploadingFiles([]);
    inputRef.current?.click();
  }, []);

  return (
    <div className="w-full font-sans">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Upload button */}
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto gap-2"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload evidence files"
      >
        {uploading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Camera className="size-4" aria-hidden="true" />
        )}
        <span>{uploading ? 'Uploading…' : 'Upload Evidence'}</span>
      </Button>

      {/* Size validation errors */}
      <AnimatePresence>
        {sizeErrors.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="mt-3 space-y-1"
            aria-live="polite"
          >
            {sizeErrors.map((err) => (
              <li
                key={err}
                className="flex items-start gap-1.5 text-xs text-red-600"
              >
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>{err}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Global error */}
      <AnimatePresence>
        {globalError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
            role="alert"
          >
            <AlertCircle className="mt-px size-4 shrink-0 text-red-500" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-red-700">{globalError}</p>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
              aria-label="Retry upload"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active upload progress rows */}
      <AnimatePresence>
        {uploadingFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 space-y-3"
            aria-live="polite"
            aria-label="Upload progress"
          >
            {uploadingFiles.map((f) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="rounded-xl border border-brand-border-grey bg-brand-off-white px-3 py-2.5"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="text-xs font-medium text-brand-near-black truncate max-w-[60%]"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  <span className="text-xs text-brand-mid-grey tabular-nums">
                    {formatFileSize(f.size)}
                  </span>
                </div>

                {f.error ? (
                  <p className="text-xs text-red-600">{f.error}</p>
                ) : (
                  <div
                    className="h-1 w-full rounded-full bg-brand-border-grey overflow-hidden"
                    role="progressbar"
                    aria-valuenow={f.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${f.name} upload progress`}
                  >
                    <motion.div
                      className={cn(
                        'h-full rounded-full',
                        f.done ? 'bg-green-500' : 'bg-brand-near-black'
                      )}
                      initial={{ width: '0%' }}
                      animate={{ width: `${f.progress}%` }}
                      transition={{ duration: 0.15, ease: 'linear' }}
                    />
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thumbnail grid */}
      {existingUrls.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-medium text-brand-mid-grey uppercase tracking-wide mb-3">
            Uploaded files
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <AnimatePresence>
              {thumbnails.map((item) => (
                <motion.div
                  key={item.path}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.18 }}
                  className="relative group rounded-xl border border-brand-border-grey bg-brand-light-grey overflow-hidden"
                >
                  {item.isImage ? (
                    <div className="flex items-center justify-center h-20 w-full">
                      {item.loadingSignedUrl ? (
                        <div className="h-full w-full animate-pulse bg-brand-border-grey" />
                      ) : item.signedUrl ? (
                        <img
                          src={item.signedUrl}
                          alt={item.fileName}
                          className="h-16 w-16 rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <FileIcon
                          mimeType="image/jpeg"
                          fileName={item.fileName}
                          className="size-8 text-brand-mid-grey"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 px-2 py-4">
                      <FileIcon
                        mimeType="application/pdf"
                        fileName={item.fileName}
                        className="size-8 text-brand-mid-grey"
                      />
                      <span
                        className="text-xs text-brand-mid-grey text-center truncate w-full px-1"
                        title={item.fileName}
                      >
                        {item.fileName}
                      </span>
                    </div>
                  )}

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(item.path)}
                    className={cn(
                      'absolute top-1.5 right-1.5 size-5 rounded-full',
                      'bg-brand-near-black text-white flex items-center justify-center',
                      'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      'transition-opacity duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-brand-near-black'
                    )}
                    aria-label={`Remove ${item.fileName}`}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        !uploading && (
          <EmptyState
            icon={<Camera className="size-8" />}
            title="No evidence uploaded"
            description="Upload photos or PDF documents to support this substage."
          />
        )
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="Remove file"
        description="This will remove the file reference from this substage. The action cannot be undone."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default EvidenceUpload;
