import { parseAmount, readBqLineItems, readBqTotal, type BqLineItem, type BqReading } from './read-bq-total';
import type { ModelPlanReading } from './model-plan-reading';

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
async function fromPdf(file: File): Promise<{ text: string; ocr: boolean; pages: number }> {
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
    ? { text, ocr: false, pages: doc.numPages }
    : { text: await fromScannedPdf(doc as never), ocr: true, pages: doc.numPages };

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
  lineItems: BqLineItem[];
  /**
   * A storey count the BILL states about the building, from its title or headings.
   *
   * "Mr.NAS G + 1 Cost Estimate", "CONSTRUCTION ESTIMATE OF G+1 BUILDING FOR MRS
   * ROSE". A ground plan with a staircase cannot tell you how many floors there are;
   * its bill usually says so in the first line.
   */
  statedFloors: number | null;
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
      return { reading: null, lineItems: [], statedFloors: null, source, readable: false, ocr: false };
    }

    // Nothing at all is a different answer from "text, but no total in it": one means
    // the file could not be read, the other that it holds no total to find.
    if (!text.trim()) return { reading: null, lineItems: [], statedFloors: null, source, readable: false, ocr };

    return {
      reading: readBqTotal(text), lineItems: readBqLineItems(text),
      statedFloors: readStatedFloors(text).value,
      source, readable: true, ocr,
    };
  } catch {
    // Corrupt, password-protected, or a format the library will not take. All the
    // same answer to the person: type the figure.
    return { reading: null, lineItems: [], statedFloors: null, source, readable: false, ocr: false };
  }
}

/** Which files we will attempt. Anything else goes straight to "type the figure". */
export function canExtract(filename: string): boolean {
  return SPREADSHEET.test(filename) || PLAIN.test(filename)
      || PDF.test(filename) || IMAGE.test(filename);
}
// =========================================================
// Reading a floor plan.
//
// A drawing is not prose, and the first version of this read it as though it were.
// It looked for "5 bedrooms" and "Floor area: 219 m²" — sentences no architect writes
// on a plan. What a plan actually carries is a LABEL in each room ("Bed Room",
// "Toilet", "Kitchen") and a CHAIN OF DIMENSIONS along each edge. Mr Nas's ground
// plan has every one of those in a clean AutoCAD text layer, and still reported
// "floor count not extracted · area not extracted", because none of it is a sentence.
//
// So a fact can now be established three ways, and they are not equal:
//
//   STATED   the drawing says it outright — "G+1", "GROSS FLOOR AREA 219 m²".
//   COUNTED  we counted the labels. Describes THIS SHEET and nothing more.
//   DERIVED  we multiplied two spans the drawing states.
//
// A stated figure always wins: it is a claim about the building, where a count is
// only a description of one sheet. Everything carries its evidence, so a reading can
// be checked against the drawing instead of trusted.
//
// WHAT THIS STILL CANNOT TELL YOU, and does not guess at. Mr Nas's plan is three
// separate dwellings in one block — three sitting rooms, three kitchens, three
// verandas, three front doors. Nothing in the text says so; you only know by looking
// at the layout. Counting labels gives you the rooms, never the building.
// =========================================================

export interface FloorPlanFacts {
  readable: boolean;
  floors: number | null;
  areaSqm: number | null;
  footprintSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingRooms: number | null;
  kitchens: number | null;
  /**
   * A staircase is drawn, so the building has a floor this sheet does not show.
   * Deliberately NOT turned into `floors: 2` — a staircase proves there is an upper
   * floor, never how many, and a guessed storey count multiplies through the whole
   * budget. It says "ask for the other sheets", which is the honest reading.
   */
  staircase: boolean;
  /**
   * What a vision model made of the drawing, when one was asked and answered.
   *
   * Kept beside the extractor's reading rather than folded into it, because the two
   * are different kinds of claim: everything above is counted or measured off the
   * sheet, this is somebody looking at a picture. It is the only source for
   * `dwellingUnits`, which nothing on a drawing states and which decides whether this
   * is one build or three.
   */
  model?: ModelPlanReading | null;
  evidence: {
    floors: string[];
    areaSqm: string[];
    footprintSqm: string[];
    bedrooms: string[];
    bathrooms: string[];
    livingRooms: string[];
    kitchens: string[];
    staircase: string[];
  };
}

/**
 * Nothing read.
 *
 * Exported because callers need it too: `PlanQuestionStep` wrote its own copy of this
 * literal as a fallback, and it silently went stale the moment a field was added —
 * leaving `staircase` undefined on a shape that says it is a boolean.
 */
export const NO_FLOOR_PLAN_FACTS: FloorPlanFacts = {
  readable: false,
  floors: null, areaSqm: null, footprintSqm: null,
  bedrooms: null, bathrooms: null, livingRooms: null, kitchens: null,
  staircase: false,
  model: null,
  evidence: {
    floors: [], areaSqm: [], footprintSqm: [],
    bedrooms: [], bathrooms: [], livingRooms: [], kitchens: [], staircase: [],
  },
};

/**
 * Room labels as a drawing writes them, which is not how a person says them.
 *
 * No trailing `\b`. A CAD label runs straight into its instance number — "Bed Room2",
 * "M.Bed Room1" — and a word boundary after "room" refuses to match those, which on
 * this one plan would miss four bedrooms out of five.
 */
const ROOM_LABELS = {
  bedrooms:    /\b(?:m\.?\s*)?bed\s*-?\s*room|\bchambre/gi,
  bathrooms:   /\b(?:bath\s*-?\s*room|toilet|wc\b|w\.c\.|salle\s*de\s*bain)/gi,
  livingRooms: /\b(?:sitting|living)\s*-?\s*room|\b(?:lounge|parlou?r|salon|s[ée]jour)/gi,
  kitchens:    /\b(?:kitchen|cuisine)/gi,
} as const;

/** Counts a drawing states about itself. These win over anything we counted. */
const STATED_COUNTS = {
  bedrooms: [
    /\b(\d{1,2})\s*(?:bed(?:room)?s|chambres)\b/i,
    /\b(?:bed(?:room)?s|chambres)\s*[:\-]\s*(\d{1,2})\b/i,
  ],
  bathrooms: [
    /\b(\d{1,2})\s*(?:bath(?:room)?s|toilets|salles\s*de\s*bains)\b/i,
    /\b(?:bath(?:room)?s|toilets|salles\s*de\s*bains)\s*[:\-]\s*(\d{1,2})\b/i,
  ],
  livingRooms: [
    /\b(\d{1,2})\s*(?:living\s*rooms|sitting\s*rooms|lounges|salons)\b/i,
    /\b(?:living\s*rooms|sitting\s*rooms|lounges|salons)\s*[:\-]\s*(\d{1,2})\b/i,
  ],
  kitchens: [
    /\b(\d{1,2})\s*(?:kitchens|cuisines)\b/i,
    /\b(?:kitchens|cuisines)\s*[:\-]\s*(\d{1,2})\b/i,
  ],
} as const;

const STAIRCASE = /\b(?:stair\s*-?\s*case|stairs|escalier)\b/i;

/**
 * "G+1" — the way this market states a storey count, and the one to trust.
 *
 * Sought on its own and before anything else, because the alternatives below can be
 * fooled by a table and this cannot.
 */
const G_PLUS = /\b(?:G|GF|ground\s*floor)\s*\+\s*(\d{1,2})\b/i;

/**
 * "3 floors", "storeys: 2". Used only when no G+ figure is stated.
 *
 * The separator in the second pattern is MANDATORY, and neither may be followed by
 * more digits. Both rules were bought on 28 October: a bill of quantities is a table,
 * and with an optional separator "550: WALL MASONARY OF UPPER FLOOR   3,155,600" read
 * as three storeys — the word "FLOOR" and then, across the column gap, the first
 * digit of the money. Two such rows plus a real "G +1" produced a four-storey
 * building out of a bungalow's bill, and storeys multiply the budget.
 */
const STATED_FLOORS = [
  /\b(\d{1,2})\s*(?:floors?|storeys?|levels?|etages?)\b(?![\d,.])/i,
  /\b(?:floors?|storeys?|levels?|etages?)\s*[:\-]\s*(\d{1,2})\b(?![\d,.])/i,
] as const;

/** A span in metres has to be a building's, not a doorway's or a city block's. */
const MIN_SPAN_M = 2;
const MAX_SPAN_M = 200;
const MIN_FOOTPRINT_SQM = 10;
const MAX_FOOTPRINT_SQM = 20_000;

function cleanSnippet(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function extractCount(lines: string[], patterns: readonly RegExp[]): { value: number | null; evidence: string[] } {
  const hits: number[] = [];
  const evidence: string[] = [];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const n = Number(match[1]);
      if (!Number.isFinite(n) || n <= 0) continue;
      hits.push(n);
      evidence.push(cleanSnippet(line));
      break;
    }
  }
  return { value: hits.length ? Math.max(...hits) : null, evidence };
}

function extractArea(lines: string[], pattern: RegExp): { value: number | null; evidence: string[] } {
  const parsed: number[] = [];
  const evidence: string[] = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = parseAmount(match[1]);
    if (value == null || value <= 0) continue;
    parsed.push(value);
    evidence.push(cleanSnippet(line));
  }
  return { value: parsed.length ? Math.max(...parsed) : null, evidence };
}

/** How many times a room label appears, with the distinct spellings as evidence. */
function countLabels(text: string, pattern: RegExp): { value: number | null; evidence: string[] } {
  // A fresh regex per call. These patterns are module-level constants carrying /g, and
  // a shared one that kept its lastIndex would count the second plan of an upload
  // differently from the first.
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
  if (!matches.length) return { value: null, evidence: [] };
  return {
    value: matches.length,
    // The distinct spellings, not one entry per hit. A "line" here is whatever shared
    // a Y coordinate on the sheet, so quoting it would show unrelated rooms.
    evidence: [...new Set(matches.map(match => cleanSnippet(match[0])))],
  };
}

/** What a drawing states, falling back to what we counted. */
function roomTally(
  text: string, lines: string[], label: RegExp, stated: readonly RegExp[],
): { value: number | null; evidence: string[] } {
  const said = extractCount(lines, stated);
  return said.value != null ? said : countLabels(text, label);
}

/** Every number on the sheet that could be a structural span, in metres. */
function metreSpans(text: string): number[] {
  const out: number[] = [];
  // Split rather than match: a lookbehind would be the neat way to refuse "1.21.25",
  // and Safari below 16.4 throws a SyntaxError on one while PARSING the module, which
  // would take the whole wizard down rather than just this reading.
  for (const token of text.split(/[^\d.]+/)) {
    if (!/^\d{1,3}\.\d{2}$/.test(token)) continue;
    const value = Number(token);
    if (Number.isFinite(value) && value >= MIN_SPAN_M && value <= MAX_SPAN_M) out.push(value);
  }
  return out;
}

/**
 * The building's overall width and depth, off the outer dimension chain.
 *
 * A plan dimensions both of each pair of opposite edges, so an overall span is
 * written TWICE while an internal run is usually written once. Requiring the repeat
 * is what stops one long internal measurement being read as the envelope. Of what
 * repeats, the two largest are the width and the depth.
 */
function overallSpans(text: string): { width: number; depth: number } | null {
  const counts = new Map<number, number>();
  for (const value of metreSpans(text)) counts.set(value, (counts.get(value) ?? 0) + 1);
  const repeated = [...counts.entries()]
    .filter(([, seen]) => seen >= 2)
    .map(([value]) => value)
    .sort((a, b) => b - a);
  const [width, depth] = repeated;
  if (width == null || depth == null) return null;
  return { width, depth };
}

/**
 * A storey count a document states about itself — "G+1", "G + 2 + TT", "3 STOREYS".
 *
 * Deliberately ONLY the storey count, and deliberately usable on a bill of quantities
 * as well as a drawing. A bill's title page almost always names the building: "Mr.NAS
 * G + 1 Cost Estimate", "CONSTRUCTION ESTIMATE OF G+1 BUILDING FOR MRS ROSE". That is
 * a stated fact and worth having, because a ground plan with a staircase proves there
 * is an upper floor without ever saying how many.
 *
 * What must NOT be taken from a bill is the room counting. A drawing writes "Kitchen"
 * once per kitchen; a bill writes it in every trade line that touches one, so counting
 * labels there would invent rooms.
 */
export function readStatedFloors(text: string): { value: number | null; evidence: string[] } {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const plausible = (n: number | null) =>
    n != null && Number.isInteger(n) && n > 0 && n <= 20 ? n : null;

  // A G+ figure settles it. Taken on its own, never combined with a count read
  // elsewhere in the document: "G +1" plus a stray "3" off a money column is how a
  // two-storey building became four.
  const gPlus = extractCount(lines, [G_PLUS]);
  if (gPlus.value != null) {
    return { value: plausible(gPlus.value + 1), evidence: gPlus.evidence };
  }

  const stated = extractCount(lines, STATED_FLOORS);
  return { value: plausible(stated.value), evidence: stated.evidence };
}

/** Extract what a floor plan states, and what counting its labels establishes. */
export function readFloorPlanFacts(
  text: string,
  opts: { pageCount?: number } = {},
): Omit<FloorPlanFacts, 'readable'> {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const floors = readStatedFloors(text);
  const floorsValue = floors.value;

  // `(?![A-Za-z0-9])` rather than `\b` after the unit. A trailing `\b` asserts a
  // boundary, and "²" is not a word character — so "150 m²" needed a LETTER after it
  // to match, and the commonest spelling of the commonest unit never read at all.
  // "150 m2" and "150 sqm" worked, which is why it went unnoticed.
  const UNIT = String.raw`\s*(?:m²|m2|sqm)(?![A-Za-z0-9])`;
  const area = extractArea(lines, new RegExp(
    String.raw`\b(?:gross\s*floor\s*area|built[- ]?up\s*area|floor\s*area|area|superficie)\b[^0-9]{0,24}([\d][\d\s.,]*)` + UNIT, 'i'));
  const statedFootprint = extractArea(lines, new RegExp(
    String.raw`\b(?:ground\s*floor\s*(?:footprint|area)|footprint|emprise\s*au\s*sol)\b[^0-9]{0,24}([\d][\d\s.,]*)` + UNIT, 'i'));

  /**
   * Only derive from a SINGLE sheet, and only when nothing was stated.
   *
   * A one-page ground plan's outermost dimension chain is the building. A 14-page
   * set is not: it carries site plans, sections and structural details, and the two
   * largest repeated dimensions in it are no longer the envelope. Vanessa's plan
   * measured 769.7 m² that way against a true 151.75 m² a floor — and because the
   * design fee is 5,000 XAF per built m², that one number moved about $10,000 inside
   * the client's own budget.
   *
   * Nor can the stated figure be read instead: `pdftotext` flattens the CAD title
   * block, so "TOTAL SURFACE" lands twelve lines from its 151.75, while "AREA= 500
   * m2" — the PLOT — keeps its label and would be matched in its place. Reading an
   * area off a plan set is beyond what text extraction can do honestly, so on a set
   * we claim nothing and the summary asks for it.
   */
  const singleSheet = opts.pageCount == null || opts.pageCount === 1;
  const spans = statedFootprint.value == null && singleSheet ? overallSpans(text) : null;
  const derived = spans ? Math.round(spans.width * spans.depth * 100) / 100 : null;
  const derivedOk = derived != null
    && derived >= MIN_FOOTPRINT_SQM && derived <= MAX_FOOTPRINT_SQM;

  const stair = text.match(STAIRCASE);

  const bedrooms    = roomTally(text, lines, ROOM_LABELS.bedrooms,    STATED_COUNTS.bedrooms);
  const bathrooms   = roomTally(text, lines, ROOM_LABELS.bathrooms,   STATED_COUNTS.bathrooms);
  const livingRooms = roomTally(text, lines, ROOM_LABELS.livingRooms, STATED_COUNTS.livingRooms);
  const kitchens    = roomTally(text, lines, ROOM_LABELS.kitchens,    STATED_COUNTS.kitchens);

  return {
    floors: floorsValue != null && Number.isInteger(floorsValue) && floorsValue > 0 ? floorsValue : null,
    areaSqm: area.value != null && area.value > 0 ? area.value : null,
    footprintSqm: statedFootprint.value ?? (derivedOk ? derived : null),
    bedrooms: bedrooms.value,
    bathrooms: bathrooms.value,
    livingRooms: livingRooms.value,
    kitchens: kitchens.value,
    staircase: stair != null,
    evidence: {
      floors: floors.evidence,
      areaSqm: area.evidence,
      // Language-neutral on purpose: "21.25 × 10.3 m" reads the same to everyone and
      // shows the two numbers that were multiplied, so the derivation can be checked.
      footprintSqm: statedFootprint.value != null
        ? statedFootprint.evidence
        : derivedOk && spans ? [`${spans.width} × ${spans.depth} m`] : [],
      bedrooms: bedrooms.evidence,
      bathrooms: bathrooms.evidence,
      livingRooms: livingRooms.evidence,
      kitchens: kitchens.evidence,
      staircase: stair ? [cleanSnippet(stair[0])] : [],
    },
  };
}

/** Read a plan PDF or image and return what it states, plus what its labels count to. */
export async function extractFloorPlanFacts(file: File): Promise<FloorPlanFacts> {
  const isPdf = PDF.test(file.name);
  const isImage = IMAGE.test(file.name);
  if (!isPdf && !isImage) return { ...NO_FLOOR_PLAN_FACTS };

  try {
    const out = isPdf ? await fromPdf(file) : { text: await ocrImage(file), ocr: true };
    return {
      readable: !!out.text.trim(),
      ...readFloorPlanFacts(out.text, { pageCount: 'pages' in out ? out.pages : 1 }),
    };
  } catch {
    return { ...NO_FLOOR_PLAN_FACTS };
  }
}
