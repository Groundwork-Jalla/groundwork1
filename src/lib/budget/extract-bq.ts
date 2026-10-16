import { readBqTotal, type BqReading } from './read-bq-total';

// =========================================================
// Getting the rows out of a bill of quantities, whatever it arrived as.
//
// A BQ in this market turns up as a spreadsheet somebody exported, a spreadsheet
// somebody emailed, or a PDF their quantity surveyor printed. Reading only CSV meant
// reading almost none of them in practice, so all three are handled here and the
// answer always goes through the same `readBqTotal` afterwards — one set of rules
// about which row is the total, no matter which reader produced the rows.
//
// ── The libraries are loaded on demand ──────────────────────────────────────────────
// SheetJS and PDF.js are large, and most people never upload a BQ at all. Both are
// dynamically imported the moment a file is actually picked, so they are a separate
// chunk rather than weight in everybody's first page load.
//
// ── What still cannot be read, and is said rather than guessed ──────────────────────
// A SCANNED PDF — a photograph of a printed BQ — has no text layer. PDF.js returns
// nothing for it, and nothing is what this reports: `null`, which the caller turns
// into "type the figure in". Pretending otherwise would need OCR, and an OCR'd digit
// read wrongly becomes a stage payment.
// =========================================================

/** Delimited text that `readBqTotal` already understands. */
function rowsToText(rows: unknown[][]): string {
  return rows
    .map(row => row.map(cell => (cell == null ? '' : String(cell))).join('\t'))
    .join('\n');
}

/** Every sheet in a workbook, flattened. A BQ is often split a section per tab. */
async function fromSpreadsheet(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const book = XLSX.read(data, { type: 'array' });

  const parts: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    // `header: 1` gives raw rows rather than guessing a header line — a BQ's first
    // row is as often a title as a set of column names.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    parts.push(rowsToText(rows));
  }
  return parts.join('\n');
}

/**
 * A PDF's text, laid out roughly as it appears.
 *
 * Items are grouped into lines by their vertical position, because a BQ is a table and
 * the description and its amount only mean anything together. Concatenating the items
 * in document order instead would put every number on its own line and lose which row
 * each belonged to.
 */
async function fromPdf(file: File): Promise<{ text: string; ocr: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  // The worker is bundled beside the library; Vite resolves this to a real URL.
  pdfjs.GlobalWorkerOptions.workerSrc =
    (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  let anyText = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    if (content.items.length > 0) anyText = true;

    // Group by rounded Y. PDF text items carry a transform matrix whose last entry is
    // the vertical position; items on the same printed line share it within a point
    // or two, which the rounding absorbs.
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      const t = item as { str?: string; transform?: number[] };
      if (!t.str || !t.transform) continue;
      const y = Math.round(t.transform[5]);
      const x = t.transform[4] ?? 0;
      const line = lines.get(y) ?? [];
      line.push({ x, s: t.str });
      lines.set(y, line);
    }

    pages.push([...lines.entries()]
      .sort((a, b) => b[0] - a[0])                       // top of the page downwards
      .map(([, items]) => items.sort((a, b) => a.x - b.x) // left to right within a line
        .map(i => i.s).join('\t'))
      .join('\n'));
  }

  // No text layer at all means a scan — a photograph of a printed BQ. That used to be
  // the end of it; now the pages are rendered and read as pictures.
  const text = anyText ? pages.join('\n') : '';
  const out = text.trim()
    ? { text, ocr: false }
    : { text: await fromScannedPdf(doc as never), ocr: true };

  // Release the worker's copy of the document. `cleanup()` is the public surface in
  // pdfjs 6; a leaked document keeps its page data alive for the life of the tab.
  await doc.cleanup();
  return out;
}

/**
 * Read a page image with Tesseract.
 *
 * Dynamically imported: the engine and its language data are tens of megabytes, and
 * almost nobody uploads a scan. Loading it when one actually appears costs that person
 * a wait; loading it always would cost everybody the page.
 */
async function ocrImage(source: HTMLCanvasElement | File): Promise<string> {
  // Interop, deliberately. tesseract.js ships CommonJS, so a named import resolves
  // under one bundler and is `undefined` under another — Node refuses it outright
  // ("Named export 'recognize' not found"). Reading it off the namespace and the
  // default works either way.
  const mod = await import('tesseract.js');
  const recognize = (mod as { recognize?: typeof mod.recognize }).recognize
    ?? (mod as { default?: { recognize?: typeof mod.recognize } }).default?.recognize;
  if (!recognize) throw new Error('tesseract.js: no recognize export');
  // Both languages at once. Cameroon is bilingual and a bill of quantities arrives in
  // whichever the quantity surveyor writes in — Tesseract takes several and picks per
  // word, so this costs one extra language download rather than a guess about which
  // document we are looking at. Reading a French BQ with the English model alone
  // mangles the accented words the total is named by.
  const { data } = await recognize(source, 'eng+fra');
  return data.text ?? '';
}

/**
 * A scanned PDF: render each page and read the picture.
 *
 * ── Last page first ─────────────────────────────────────────────────────────────────
 * A BQ puts its grand total on a summary page at the end. OCR takes seconds per page,
 * so a fifty-page document read front to back is a minute of staring at a spinner for
 * a number that was on the last sheet. Pages are read from the back, and the moment a
 * grand total appears the rest are skipped.
 *
 * Capped, because the alternative to a cap is a tab that hangs on a document nobody
 * expected. Past the cap the person types the figure, which is the same answer they
 * had before any of this existed.
 */
const OCR_PAGE_CAP = 8;

async function fromScannedPdf(doc: {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: Record<string, unknown>) => { promise: Promise<void> };
  }>;
}): Promise<string> {
  const order: number[] = [];
  for (let n = doc.numPages; n >= 1 && order.length < OCR_PAGE_CAP; n--) order.push(n);

  const seen: string[] = [];
  for (const n of order) {
    const page = await doc.getPage(n);
    // Scale 2: Tesseract reads small print badly, and a BQ's amount column is small
    // print. Rendering at twice the nominal size is the cheapest accuracy there is.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const text = await ocrImage(canvas);
    seen.push(text);
    // Found what we came for; the earlier pages are line items.
    if (readBqTotal(text)?.confidence === 'grand') break;
  }
  // Reversed, so what is handed on reads in page order like every other source.
  return seen.reverse().join('\n');
}

export type BqSource = 'spreadsheet' | 'pdf' | 'text' | 'image';

export interface BqExtraction {
  reading: BqReading | null;
  source: BqSource;
  /** False when the file yielded no text at all — an empty sheet, or an unreadable scan. */
  readable: boolean;
  /**
   * The text came from OCR rather than from the file itself.
   *
   * Worth saying out loud wherever the figure is shown. Optical recognition confuses
   * 8 with 3 and 1 with 7, and the number it produces becomes the budget and then ten
   * stage payments. A digit read wrongly here is money, so the person is told where
   * the figure came from and asked to check it rather than glance at it.
   */
  ocr: boolean;
}

const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;
const PLAIN       = /\.(csv|tsv|txt)$/i;
const PDF         = /\.pdf$/i;
const IMAGE       = /\.(jpe?g|png|webp|heic|heif|tiff?|bmp)$/i;

/**
 * Read a construction total out of a bill of quantities.
 *
 * Always a SUGGESTION. The caller shows it with the row it came from and a person
 * accepts or corrects it, because this figure becomes the budget and then the payment
 * at each of ten stages. A number lifted out of a document and used unseen is the
 * wrong amount of money, repeatedly.
 */
export async function extractBqTotal(file: File): Promise<BqExtraction> {
  const name = file.name;
  const source: BqSource =
    SPREADSHEET.test(name) ? 'spreadsheet'
    : PDF.test(name)       ? 'pdf'
    : IMAGE.test(name)     ? 'image'
    :                        'text';

  try {
    let text = '';
    let ocr = false;

    if (source === 'spreadsheet') {
      text = await fromSpreadsheet(file);
    } else if (source === 'pdf') {
      const out = await fromPdf(file);
      text = out.text;
      ocr  = out.ocr;
    } else if (source === 'image') {
      // Somebody photographed their BQ, which on a phone is the likeliest way it
      // arrives at all. There is no text in a photograph; it is read or it is not.
      text = await ocrImage(file);
      ocr  = true;
    } else if (PLAIN.test(name)) {
      text = await file.text();
    } else {
      return { reading: null, source, readable: false, ocr: false };
    }

    // Nothing at all is a different answer from "text, but no total in it": one means
    // the file could not be read, the other that it holds no total to find.
    if (!text.trim()) return { reading: null, source, readable: false, ocr };

    return { reading: readBqTotal(text), source, readable: true, ocr };
  } catch {
    // Corrupt, password-protected, or a format the library will not take. All the
    // same answer to the person: type the figure.
    return { reading: null, source, readable: false, ocr: false };
  }
}

/** Which files we will attempt. Anything else goes straight to "type the figure". */
export function canExtract(filename: string): boolean {
  return SPREADSHEET.test(filename) || PLAIN.test(filename)
      || PDF.test(filename) || IMAGE.test(filename);
}
