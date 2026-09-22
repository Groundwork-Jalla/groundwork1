// =========================================================
// What the documents bucket will actually take.
//
// The list here is not a preference — it is a transcription of the `documents` bucket's
// own `allowed_mime_types` and `file_size_limit` (migration 011, extended by 096).
// Storage refuses anything outside them, so a file that passes the browser and fails the
// bucket is an upload that disappears with no explanation. That has already happened
// twice over: the wizard offered no spreadsheet at all, and the vault advertised 25 MB
// against a bucket that stops at 20.
//
// One module so the wizard, the vault and the bucket cannot drift again. Change the
// bucket and change this together.
// =========================================================

/** The bucket's own ceiling (migration 011). Not a UI choice. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_MB = 20;

/**
 * Browsers disagree about spreadsheets. The same .xlsx arrives as the official type from
 * Chrome, as `application/vnd.ms-excel` from some Windows setups, and as `''` when the OS
 * has no association at all — so the extension is checked as well, and an empty type is
 * not by itself a rejection.
 */
export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx', '.csv', '.ods',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
] as const;

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
] as const;

/** For an `<input type="file" accept="...">`. Extensions first — Safari prefers them. */
export const FILE_ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME_TYPES].join(',');

export type FileProblem = 'type' | 'size';

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

export function isSpreadsheet(file: { name: string; type?: string }): boolean {
  const ext = extensionOf(file.name);
  if (['.xls', '.xlsx', '.csv', '.ods'].includes(ext)) return true;
  const type = (file.type ?? '').toLowerCase();
  return type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv';
}

/**
 * Why this file cannot be uploaded, or null when it can.
 *
 * Accepts on EITHER signal: a known extension or a known MIME type. A .xlsx whose type
 * the browser reports as empty is a real spreadsheet, and refusing it would be refusing
 * the exact file this was built for.
 */
export function fileProblem(file: { name: string; type?: string; size: number }): FileProblem | null {
  const ext  = extensionOf(file.name);
  const type = (file.type ?? '').toLowerCase();
  const knownExt  = (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
  const knownMime = (ACCEPTED_MIME_TYPES as readonly string[]).includes(type);
  if (!knownExt && !knownMime) return 'type';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}
