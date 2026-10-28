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

/**
 * What a bill of quantities is allowed to arrive as.
 *
 * Spreadsheets only, until 28 October. That refused the shape this market most often
 * sends: a quantity surveyor prepares in Excel and hands over the signed print, so the
 * bill turns up as a PDF. `extract-bq` was built for exactly that — it has table line
 * grouping written so a description and its amount stay on one row, and an OCR fallback
 * for a print that was scanned — and the accept list on the upload step disagreed with
 * the reader behind it.
 *
 * It also disagreed with the product's OTHER door: the costing box on the confirm step
 * uses the general list, takes a PDF, and files it as `boq`. One of this project's two
 * real bills came in that way. So this was never a decision about bills of quantities,
 * only one screen out of step with the rest.
 *
 * `.ods` for the same reason — `isSpreadsheet` has always known it and this list did not.
 *
 * NOT images. The reader will OCR a photographed bill, and the scanned-PDF path already
 * leans on that, but a phone photo as the FIRST-CLASS way to price a build is a product
 * decision about a misread digit becoming a stage payment, not a list to widen quietly.
 */
const BOQ_EXTENSIONS = ['.xls', '.xlsx', '.ods', '.csv', '.pdf'] as const;
const BOQ_MIME_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/pdf',
] as const;
const FLOOR_PLAN_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'] as const;
const FLOOR_PLAN_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
] as const;

export const BOQ_ACCEPT_ATTR = [...BOQ_EXTENSIONS, ...BOQ_MIME_TYPES].join(',');
export const FLOOR_PLAN_ACCEPT_ATTR = [...FLOOR_PLAN_EXTENSIONS, ...FLOOR_PLAN_MIME_TYPES].join(',');

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

export function isBoqFile(file: { name: string; type?: string }): boolean {
  const ext = extensionOf(file.name);
  const type = (file.type ?? '').toLowerCase();
  return (BOQ_EXTENSIONS as readonly string[]).includes(ext)
    || (BOQ_MIME_TYPES as readonly string[]).includes(type);
}

export function isFloorPlanFile(file: { name: string; type?: string }): boolean {
  const ext = extensionOf(file.name);
  const type = (file.type ?? '').toLowerCase();
  return (FLOOR_PLAN_EXTENSIONS as readonly string[]).includes(ext)
    || (FLOOR_PLAN_MIME_TYPES as readonly string[]).includes(type);
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
