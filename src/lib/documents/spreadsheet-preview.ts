import { read, utils } from 'xlsx';
import { MAX_FILE_BYTES } from './accepted-files';

export const PREVIEW_ROWS = 200;
export const PREVIEW_COLUMNS = 40;
export const PREVIEW_SHEETS = 12;
const CELL_CHARACTERS = 2000;

export interface PreviewSheet {
  name: string; rows: string[][]; columns: number; truncated: boolean;
}
export interface SpreadsheetPreview { sheets: PreviewSheet[]; truncated: boolean }

/** Runs in a worker. Uses saved/formatted values; never evaluates workbook formulas or HTML. */
export function readSpreadsheetPreview(buffer: ArrayBuffer): SpreadsheetPreview {
  if (!buffer.byteLength || buffer.byteLength > MAX_FILE_BYTES) throw new Error('file_size');
  const index = read(buffer, { type: 'array', bookSheets: true });
  const names = index.SheetNames.slice(0, PREVIEW_SHEETS);
  if (!names.length) throw new Error('no_sheets');
  const workbook = read(buffer, { type: 'array', sheets: names, sheetRows: PREVIEW_ROWS + 1,
    dense: true, cellHTML: false, cellFormula: false, cellStyles: false });
  const sheets = names.map(name => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) return { name, rows: [], columns: 0, truncated: false };
    const used = utils.decode_range(sheet['!ref']);
    const full = utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    const columns = Math.min(PREVIEW_COLUMNS, used.e.c + 1);
    const end = { r: Math.min(PREVIEW_ROWS - 1, used.e.r), c: columns - 1 };
    const values = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true,
      range: { s: { r: 0, c: 0 }, e: end } });
    let truncated = full.e.r >= PREVIEW_ROWS || full.e.c >= PREVIEW_COLUMNS;
    const rows = values.slice(0, PREVIEW_ROWS).map(row => row.slice(0, PREVIEW_COLUMNS).map(value => {
      const text = String(value ?? '');
      if (text.length > CELL_CHARACTERS) truncated = true;
      return text.slice(0, CELL_CHARACTERS);
    }));
    return { name: name.slice(0, 100), rows, columns, truncated };
  });
  return { sheets, truncated: index.SheetNames.length > PREVIEW_SHEETS || sheets.some(sheet => sheet.truncated) };
}

