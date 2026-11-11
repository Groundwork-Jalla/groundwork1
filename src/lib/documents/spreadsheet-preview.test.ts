import { describe, expect, it } from 'vitest';
import { utils, write, type BookType } from 'xlsx';
import { MAX_FILE_BYTES } from './accepted-files';
import { readSpreadsheetPreview, PREVIEW_COLUMNS, PREVIEW_ROWS, PREVIEW_SHEETS } from './spreadsheet-preview';

function workbook(rows: unknown[][], bookType: BookType = 'xlsx') {
  if (bookType === 'csv') return new TextEncoder().encode(rows.map(row => row.join(',')).join('\n')).buffer;
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Bill of quantities');
  return write(book, { type: 'array', bookType }) as ArrayBuffer;
}

describe('uploaded spreadsheet previews', () => {
  it.each(['xlsx', 'xls', 'ods', 'csv'] as BookType[])('reads actual %s values and the final bill total', format => {
    const preview = readSpreadsheetPreview(workbook([
      ['Description', 'Amount'], ['Foundation', 118587057.65], ['Grand total', 141407337.524],
    ], format));
    expect(preview.sheets[0].rows[2]).toEqual(['Grand total', '141407337.524']);
    expect(preview.sheets[0].columns).toBe(2);
    expect(preview.truncated).toBe(false);
  });

  it('uses the stored formula result and preserves text as text', () => {
    const book = utils.book_new(), sheet = utils.aoa_to_sheet([['<img src=x onerror=alert(1)>', 1]]);
    sheet.B1 = { t: 'n', f: '1+2', v: 3, z: '0.000' };
    utils.book_append_sheet(book, sheet, 'Total');
    const preview = readSpreadsheetPreview(write(book, { type: 'array', bookType: 'xlsx' }));
    expect(preview.sheets[0].rows).toEqual([['<img src=x onerror=alert(1)>', '3']]);
  });

  it('bounds wide, long and many-sheet books and tells the viewer it was truncated', () => {
    const book = utils.book_new();
    for (let i = 0; i < PREVIEW_SHEETS + 1; i++) utils.book_append_sheet(book,
      utils.aoa_to_sheet(Array.from({ length: PREVIEW_ROWS + 5 }, () => Array(PREVIEW_COLUMNS + 2).fill('item'))), `Sheet ${i}`);
    const preview = readSpreadsheetPreview(write(book, { type: 'array', bookType: 'xlsx' }));
    expect(preview.sheets).toHaveLength(PREVIEW_SHEETS);
    expect(preview.sheets[0].rows).toHaveLength(PREVIEW_ROWS);
    expect(preview.sheets[0].rows.every(row => row.length === PREVIEW_COLUMNS)).toBe(true);
    expect(preview.truncated).toBe(true);
  });

  it('keeps an empty sheet available and bounds exceptionally long cells', () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([]), 'Empty');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['a'.repeat(3000)]]), 'Text');
    const preview = readSpreadsheetPreview(write(book, { type: 'array', bookType: 'xlsx' }));
    expect(preview.sheets[0].rows).toEqual([]);
    expect(preview.sheets[1].rows[0][0]).toHaveLength(2000);
    expect(preview.truncated).toBe(true);
  });

  it('refuses empty and oversized inputs before parsing', () => {
    expect(() => readSpreadsheetPreview(new ArrayBuffer(0))).toThrow('file_size');
    expect(() => readSpreadsheetPreview(new ArrayBuffer(MAX_FILE_BYTES + 1))).toThrow('file_size');
  });
});
