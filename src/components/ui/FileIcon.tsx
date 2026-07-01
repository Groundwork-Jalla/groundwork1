import { FileText, Image, FileSpreadsheet, File } from 'lucide-react';

interface FileIconProps {
  mimeType: string | null;
  fileName?: string;
  className?: string;
}

export function FileIcon({ mimeType, fileName, className = 'size-5' }: FileIconProps) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? '';
  const mime = mimeType ?? '';

  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
    return <Image className={className} />;
  }
  if (mime.includes('pdf') || ext === 'pdf') {
    return <FileText className={className} />;
  }
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls','xlsx','csv'].includes(ext)) {
    return <FileSpreadsheet className={className} />;
  }
  return <File className={className} />;
}

/** Derive a human-readable label from MIME type or filename */
export function fileTypeLabel(mimeType: string | null, fileName?: string): string {
  const ext = fileName?.split('.').pop()?.toUpperCase() ?? '';
  if (!mimeType) return ext || 'File';
  if (mimeType.startsWith('image/')) return ext || 'Image';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return ext || 'Spreadsheet';
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'DOC';
  return ext || 'File';
}

/** Format bytes → "2.4 MB" */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
