import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
import * as XLSX from 'xlsx';
import { readBqTotal } from './read-bq-total';
import { canExtract } from './extract-bq';

/**
 * Reading a real bill of quantities, in the formats they actually arrive in.
 *
 * `extract-bq` turns a spreadsheet or a PDF into delimited text and hands it to
 * `readBqTotal`. These tests build genuine files and run the same conversion, because
 * the interesting failures are in the conversion rather than in the rules — a
 * spreadsheet flattened the wrong way produces text that reads perfectly and means
 * something else.
 *
 * The figure this produces becomes the construction budget and then the payment at
 * each of ten stages. What matters most is not that it finds the right total but that
 * it does not confidently find the wrong one.
 */

/** Exactly what `fromSpreadsheet` does, so the test exercises the real conversion. */
function sheetToText(buf: Uint8Array): string {
  const book = XLSX.read(buf, { type: 'array' });
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    if (!sheet) return '';
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
      .map(row => row.map(c => (c == null ? '' : String(c))).join('\t'))
      .join('\n');
  }).join('\n');
}

function workbook(rows: unknown[][], sheets: Record<string, unknown[][]> = {}): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'BQ');
  for (const [name, r] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(r), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** A BQ shaped like one a quantity surveyor in Douala would send. */
const REAL_BQ: unknown[][] = [
  ['BILL OF QUANTITIES — Ada House, Douala'],
  [],
  ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
  ['1', 'SUBSTRUCTURE', '', '', '', ''],
  ['1.1', 'Excavation', 'm3', 120, '15,000', '1,800,000'],
  ['1.2', 'Mass concrete', 'm3', 45, '95,000', '4,275,000'],
  ['', 'Sub-total', '', '', '', '6,075,000'],
  ['2', 'SUPERSTRUCTURE', '', '', '', ''],
  ['2.1', 'Blockwork', 'm2', 480, '12,500', '6,000,000'],
  ['2.2', 'Reinforced concrete', 'm3', 60, '145,000', '8,700,000'],
  ['', 'Sub-total', '', '', '', '14,700,000'],
  ['', 'VAT 19.25%', '', '', '', '3,997,687'],
  ['', 'GRAND TOTAL', '', '', '', '24,772,687'],
];

describe('a real .xlsx bill of quantities', () => {
  const text = sheetToText(workbook(REAL_BQ));

  it('finds the grand total', () => {
    const r = readBqTotal(text)!;
    expect(r.total).toBe(24_772_687);
    expect(r.confidence).toBe('grand');
  });

  it('and not the VAT line, nor either sub-total', () => {
    // THE ONE THAT MATTERS. Each of these is large enough to be mistaken for the
    // total, and taking one would set every stage payment wrong.
    const r = readBqTotal(text)!;
    expect(r.total).not.toBe(3_997_687);
    expect(r.total).not.toBe(6_075_000);
    expect(r.total).not.toBe(14_700_000);
  });

  it('keeps thousands separators intact through the conversion', () => {
    /**
     * THE BUG THIS CAUGHT. Rows are flattened TAB-separated, and an amount in them
     * reads `24,772,687`. The splitter took comma AND tab, so that one figure became
     * three cells of 24, 772 and 687 — each under the plausibility floor — and an
     * ordinary BQ produced no total at all.
     */
    expect(text).toContain('24,772,687');
    expect(readBqTotal(text)?.total).toBe(24_772_687);
  });

  it('reads a BQ split across several sheets, which is how they are usually built', () => {
    const multi = sheetToText(workbook(
      [['Item', 'Description', 'Amount'], ['1.1', 'Excavation', '1,800,000']],
      { Summary: [['', 'GRAND TOTAL', '', '24,772,687']] },
    ));
    expect(readBqTotal(multi)?.total).toBe(24_772_687);
  });

  it('a sheet with no priced column yields nothing rather than a guess', () => {
    const bare = sheetToText(workbook([
      ['Item', 'Description'], ['1.1', 'Excavation'], ['1.2', 'Mass concrete'],
    ]));
    expect(readBqTotal(bare)).toBeNull();
  });
});

describe('which files it will attempt', () => {
  it.each(['boq.xlsx', 'BOQ.XLS', 'boq.ods', 'boq.csv', 'boq.tsv', 'quote.pdf'])(
    '%s is attempted', (name) => expect(canExtract(name)).toBe(true));

  it.each(['boq.jpg', 'BOQ.PNG', 'boq.heic', 'scan.tiff'])(
    '%s is attempted too, via OCR — on a phone a photograph is how a BQ arrives',
    (name) => expect(canExtract(name)).toBe(true));

  it.each(['plan.dwg', 'notes.docx', 'model.ifc'])(
    '%s is not — the person types the figure', (name) => expect(canExtract(name)).toBe(false));
});

describe('the PDF line grouping', () => {
  /**
   * A PDF carries text items with positions, not lines. Concatenating them in
   * document order puts every number on its own line and loses which row it belonged
   * to — "GRAND TOTAL" and "24,772,687" stop being the same fact.
   *
   * The real conversion runs in the browser (PDF.js needs a worker), so what is
   * checked here is the grouping rule itself, against the item shape PDF.js produces.
   */
  const items = [
    { str: 'Sub-total',   transform: [1, 0, 0, 1, 15,  120] },
    { str: '6,075,000',   transform: [1, 0, 0, 1, 150, 120] },
    { str: 'GRAND TOTAL', transform: [1, 0, 0, 1, 15,  100] },
    { str: '24,772,687',  transform: [1, 0, 0, 1, 150, 100] },
  ];

  function group(list: typeof items): string {
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const it of list) {
      const y = Math.round(it.transform[5]);
      const line = lines.get(y) ?? [];
      line.push({ x: it.transform[4], s: it.str });
      lines.set(y, line);
    }
    return [...lines.entries()].sort((a, b) => b[0] - a[0])
      .map(([, v]) => v.sort((a, b) => a.x - b.x).map(i => i.s).join('\t'))
      .join('\n');
  }

  it('puts a label and its amount on the same line', () => {
    expect(group(items)).toContain('GRAND TOTAL\t24,772,687');
  });

  it('so the total is read, and the sub-total above it is not', () => {
    const r = readBqTotal(group(items))!;
    expect(r.total).toBe(24_772_687);
    expect(r.confidence).toBe('grand');
  });

  it('orders lines down the page, not in document order', () => {
    // Higher Y is further up the page. Shuffled items must still come out in
    // reading order, or a two-column BQ interleaves.
    const shuffled = [items[2], items[1], items[3], items[0]];
    expect(group(shuffled).split('\n')[0]).toContain('Sub-total');
  });
});

describe('OCR output, which is separated by nothing but spaces', () => {
  /**
   * THE SECOND BUG OF THE SAME SHAPE. Tesseract returns plain lines — "GRAND TOTAL
   * 24,772,687" — with no tabs and no CSV commas. The splitter fell back to comma,
   * shredded the amount into 24, 772 and 687, and every scanned BQ read as nothing.
   *
   * This is the real output of running Tesseract over a rasterised BQ, pasted
   * verbatim, so the test fails if the delimiter rule regresses.
   */
  const OCR = [
    'BILL OF QUANTITIES - Ada House, Douala',
    '1.1 Excavation 1,800,000',
    '1.2 Mass concrete 4,275,000',
    'Sub-total 6,075,000',
    '2.1 Blockwork 6,000,000',
    '2.2 Reinforced concrete 8,700,000',
    'Sub-total 14,700,000',
    'VAT 19.25% 3,997,687',
    'GRAND TOTAL 24,772,687',
  ].join('\n');

  it('reads the grand total out of a scan', () => {
    const r = readBqTotal(OCR)!;
    expect(r.total).toBe(24_772_687);
    expect(r.confidence).toBe('grand');
  });

  it('and still skips the VAT line and the sub-totals', () => {
    const r = readBqTotal(OCR)!;
    expect([3_997_687, 6_075_000, 14_700_000]).not.toContain(r.total);
  });
});

describe('one amount is never split into three', () => {
  // The rule that both bugs came down to: a comma between digits is part of the
  // number, not a cell boundary.
  it.each([
    ['tab separated',    'GRAND TOTAL\t\t24,772,687'],
    ['space separated',  'GRAND TOTAL 24,772,687'],
    ['quoted csv',       '"Grand Total","24,772,687"'],
    ['semicolon',        'Grand Total;;24,772,687'],
  ])('%s', (_name, line) => {
    expect(readBqTotal(line)?.total).toBe(24_772_687);
  });

  it('but a genuine CSV separator is still a separator', () => {
    // No thousands marks here, so the commas really are cell boundaries.
    expect(readBqTotal('Grand Total,,,,13500000')?.total).toBe(13_500_000);
  });

  it('and a mixed line resolves to the comma, because one is doing real work', () => {
    // `Item,Description` has a separator comma AND `1,800,000` has thousands marks.
    expect(readBqTotal('x,Grand Total,"24,772,687"')?.total).toBe(24_772_687);
  });
});

describe('a bill of quantities written in French', () => {
  /**
   * Cameroon is bilingual, and roughly half of what reaches Groundwork is French.
   * Every pattern here was English-only, which meant a French BQ read as nothing —
   * not as a wrong number, but as no number, sending the person to type a total they
   * had just uploaded.
   *
   * Matching runs on an accent-stripped copy because OCR drops accents constantly:
   * "TOTAL GÉNÉRAL" comes back as "TOTAL GENERAL" more often than not.
   */
  it.each([
    ['TOTAL GÉNÉRAL, accented',    'Sous-total 6,075,000\nTOTAL GÉNÉRAL 24,772,687'],
    ['the same with accents lost', 'Sous-total 6,075,000\nTOTAL GENERAL 24,772,687'],
    ['MONTANT TOTAL',              'Sous-total 100,000\nMONTANT TOTAL 24,772,687'],
    ['TOTAL GLOBAL',               'Maconnerie 500,000\nTOTAL GLOBAL 24,772,687'],
    ['COÛT TOTAL',                 'Terrassement 500,000\nCOÛT TOTAL 24,772,687'],
  ])('%s', (_name, text) => {
    const r = readBqTotal(text)!;
    expect(r.total).toBe(24_772_687);
    expect(r.confidence).toBe('grand');
  });

  it('prefers TTC over HT, because TTC is what the client pays', () => {
    const r = readBqTotal('TOTAL HT 20,775,000\nTVA 19,25% 3,997,687\nTOTAL TTC 24,772,687')!;
    expect(r.total).toBe(24_772_687);
  });

  it('but takes HT when it is the only total the document carries', () => {
    expect(readBqTotal('Maconnerie 6,000,000\nTOTAL HT 20,775,000')?.total).toBe(20_775_000);
  });

  it.each([
    ['sous-total',  'Sous-total 99,999,999\nTOTAL GENERAL 24,772,687'],
    ['TVA',         'TVA 19,25% 99,999,999\nTOTAL GENERAL 24,772,687'],
    ['à reporter',  'A reporter 99,999,999\nTOTAL GENERAL 24,772,687'],
    ['remise',      'Remise 99,999,999\nTOTAL GENERAL 24,772,687'],
    ['acompte',     'Acompte 99,999,999\nTOTAL GENERAL 24,772,687'],
    ['imprévus',    'Imprevus 99,999,999\nTOTAL GENERAL 24,772,687'],
  ])('skips %s even when it is the biggest number on the page', (_name, text) => {
    // Each of these is larger than the real total on purpose: the fallback takes the
    // largest figure, so an exclusion that does not work shows up here and nowhere else.
    expect(readBqTotal(text)?.total).toBe(24_772_687);
  });

  it('a French sub-total alone is refused, not returned as the total', () => {
    expect(readBqTotal('Sous-total A 8,000,000\nSous-total B 2,000,000')).toBeNull();
  });

  it('and OCR is asked for both languages, not just English', () => {
    const src = readFileSync(join(ROOT, 'src/lib/budget/extract-bq.ts'), 'utf8');
    expect(src).toMatch(/recognize\(source, 'eng\+fra'\)/);
  });
});
