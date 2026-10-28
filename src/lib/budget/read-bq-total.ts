// =========================================================
// Reading the construction total out of an uploaded bill of quantities.
//
// ── What this is for ────────────────────────────────────────────────────────────────
// On the architecture-plan path there is nothing to estimate: real drawings and a
// priced BQ exist, so the BQ is the budget. That figure then runs through
// `decomposeBudget` and `apply_budget_milestones`, exactly as a typed budget does, and
// becomes the stage payment schedule.
//
// ── Which is why it is never used without being confirmed ───────────────────────────
// This returns a SUGGESTION. A number lifted out of a spreadsheet and used unseen would
// set what a contractor is paid at each of ten stages, and a BQ can carry a subtotal, a
// VAT line, a provisional sum and a grand total within four rows of each other. Reading
// the wrong one is not a rendering bug, it is the wrong amount of money.
//
// So: the caller shows the figure, says which row it came from, and the person either
// accepts it or types the right one. `confidence` exists to decide how loudly to ask.
//
// ── What it can and cannot read ─────────────────────────────────────────────────────
// CSV and tab-separated text, which is what Excel and LibreOffice export and what most
// BQs in this market arrive as once exported. A native .xlsx is a ZIP of XML and a PDF
// may be a scan of a printout; neither is parsed here, and for those the person types
// the total. That is a smaller lie than a parser that guesses at a binary format.
// =========================================================

/** A total we think we found, and why we think so. */
export interface BqReading {
  /** Amount as written in the document. Always a positive finite number. */
  total: number;
  /** The row the figure came from, shown to the person so they can check it. */
  label: string;
  /**
   * `grand` — a row that names itself as the overall total.
   * `sum`   — no such row; the largest figure present, which is a guess.
   */
  confidence: 'grand' | 'sum';
  /** Explicitly detected currency. Null means the document did not identify one. */
  currencyCode?: string | null;
}

export interface BqLineItem {
  label: string;
  amount: number;
}

/** Rows that name themselves as the whole job. Ordered: earlier wins. */
/**
 * Lower-case and strip accents before matching.
 *
 * Two reasons, and both are ordinary here. Cameroon is bilingual, so half the bills
 * of quantities that reach Groundwork are French — and OCR drops accents constantly,
 * reading "TOTAL GÉNÉRAL" as "TOTAL GENERAL". Matching the stripped form means one
 * pattern covers both the accented original and whatever the scanner made of it.
 */
function normalise(line: string): string {
  return line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Rows that name themselves as the whole job, best first.
 *
 * English and French together, because a Cameroonian QS writes in whichever the
 * client reads and the document does not say which it will be. Tested against the
 * NORMALISED line, so these carry no accents.
 *
 * Order matters where a document has several: a French BQ often lists TOTAL HT, then
 * TVA, then TOTAL TTC. TTC is what the client pays, so it is sought before the bare
 * "total ht" further down.
 */
const GRAND_TOTAL = [
  // ── English ──
  /\bgrand\s*total\b/,
  /\btotal\s+(?:project|contract|construction)\s+(?:cost|sum|amount|value)\b/,
  /\b(?:project|contract)\s+total\b/,
  /\btotal\s+amount\b/,
  /\btotal\s+cost\b/,
  // ── French ──
  /\btotal\s+general\b/,
  /\btotal\s+ttc\b/,
  /\bmontant\s+total\b/,
  /\btotal\s+global\b/,
  /\btotal\s+(?:du\s+)?(?:projet|marche|devis)\b/,
  /\bcout\s+total\b/,
  /\brecapitulatif\s+general\b/,
  // Lowest-priority real totals: the works figure before tax. Taken only when the
  // document carries no TTC or général line, because then it IS the total.
  /\btotal\s+h\.?t\.?\b/,
  /\btotal\s+hors\s+taxes?\b/,
];

/**
 * Rows that look like a total but are not the one we want.
 *
 * A BQ commonly carries per-section subtotals, a VAT or tax line, and "carried to
 * summary" rows. Any of them can be the largest number on the page, and taking one
 * would silently inflate or deflate every stage payment.
 */
const NOT_THE_TOTAL = new RegExp(
  '\\b(' + [
    // ── English ──
    'sub[\\s-]?total', 'vat', 'tax', 'carried', 'brought\\s+forward', 'page\\s+total',
    'provisional', 'contingenc', 'less', 'discount', 'deposit', 'retention',
    // ── French ──
    'sous[\\s-]?total',      // the commonest false positive of all
    'total\\s+partiel',
    't\\.?v\\.?a\\.?',           // taxe sur la valeur ajoutee
    'a\\s+reporter', 'report\\b', 'reporte',   // carried forward
    'provision', 'imprevus',  // contingency
    'remise', 'rabais',       // discount
    'acompte',                // deposit
    'retenue',                // retention
  ].join('|') + ')\\b');

/** Column headings that identify a priced line total rather than its inputs. */
const AMOUNT_COLUMN = /^(?:total)$|\b(?:amount|montant|line\s+total|total\s+(?:amount|cost|value|price)|extended\s+(?:amount|cost|price)|cost|value|price|prix|cout|somme|debours)\b/;
const NOT_AMOUNT_COLUMN = /\b(?:qty|quantity|quantite|unit|unite|rate|unit\s+price|unit\s+cost|pu|vat|tva|tax|discount|percentage|percent)\b/;
const TABLE_HEADER = /\b(?:item|description|designation|desc|qty|quantity|quantite|unit|unite|rate|code|no\.?)\b/;

function findAmountColumn(row: string[]): number | null {
  const names = row.map(cell => normalise(cell.trim()));
  if (!names.some(name => TABLE_HEADER.test(name))) return null;

  const candidates = names
    .map((name, index) => ({ index, name }))
    .filter(({ name }) => AMOUNT_COLUMN.test(name) && !NOT_AMOUNT_COLUMN.test(name));

  if (!candidates.length) return null;

  // Prefer an explicit amount/montant heading, then a line/extended total, then a
  // generic total/cost/value heading. If two equally specific columns exist, the
  // later one is usually the extended line amount rather than the unit rate.
  const rank = (name: string): number =>
    /\b(?:amount|montant)\b/.test(name) ? 0
      : /\b(?:line\s+total|extended\s+(?:amount|cost|price)|total\s+(?:amount|cost|value|price))\b/.test(name) ? 1
      : 2;
  return candidates
    .sort((a, b) => rank(a.name) - rank(b.name) || b.index - a.index)[0].index;
}

/** Pull a number out of a cell: "12,500,000.00", "XAF 12 500 000", "(1 234)". */
export function parseAmount(cell: string): number | null {
  const raw = cell.trim();
  if (!raw) return null;

  // Strip currency words and symbols, keep digits and separators.
  const cleaned = raw
    .replace(/[A-Za-z $€£₦]/g, ' ')
    .replace(/[()]/g, ' ')
    .trim();
  if (!/\d/.test(cleaned)) return null;

  // Which separator is the decimal point? The LAST one, if it leaves 1–2 digits after
  // it. "1.234.567,89" and "1,234,567.89" both resolve correctly this way, and
  // "1,234,567" (no decimals) is left whole rather than read as 1.234567.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);
  let normalised: string;
  if (sep > -1 && /^\d{1,2}$/.test(cleaned.slice(sep + 1).replace(/\s/g, ''))) {
    normalised = cleaned.slice(0, sep).replace(/[^\d]/g, '')
      + '.' + cleaned.slice(sep + 1).replace(/[^\d]/g, '');
  } else {
    normalised = cleaned.replace(/[^\d]/g, '');
  }

  const n = Number(normalised);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Is a comma on this line acting as a separator, or as a thousands mark?
 *
 * `1,800,000` is one number; `Excavation,1800000` is two cells. Telling them apart is
 * the whole question, and the test is simple: remove every comma that sits between a
 * digit and exactly three more digits, and see whether any comma is left.
 */
function commaSeparates(line: string): boolean {
  return line.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '').includes(',');
}

/**
 * Split a line into cells.
 *
 * ONE delimiter per line, chosen by what the line actually contains. Getting this
 * wrong has cost two real bugs, both the same shape — a thousands separator read as a
 * cell boundary, turning `24,772,687` into 24, 772 and 687, each below the
 * plausibility floor, so an ordinary BQ produced no total at all:
 *
 *   · a SPREADSHEET is flattened tab-separated, and its amounts contain commas;
 *   · OCR OUTPUT is separated by nothing but spaces, and its amounts contain commas.
 *
 * So the order is: tab, then semicolon, then comma but only where a comma is doing a
 * separator's job, and failing all that, whitespace. Whitespace last because a
 * description has spaces in it and splitting on them is only right when there is
 * nothing better — which is exactly the OCR case.
 */
function cells(line: string): string[] {
  if (line.includes('\t')) return splitOn(line, '\t');
  if (line.includes(';'))  return splitOn(line, ';');
  if (commaSeparates(line)) return splitOn(line, ',');
  // Whitespace runs. `parseAmount` puts the number back together from one cell, so
  // over-splitting a description costs nothing and under-splitting a number costs
  // the total.
  return line.split(/\s+/).filter(Boolean);
}

function splitOn(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    // A quoted cell may contain the separator — "Blockwork, rendered" is one cell.
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function detectCurrencyCode(text: string): string | null {
  const upper = text.toUpperCase();
  const currencies: Array<[RegExp, string]> = [
    [/\bXAF\b|\bFCFA\b|\bCFA\b/, 'XAF'],
    [/\bXOF\b/, 'XOF'],
    [/\bNGN\b|₦/, 'NGN'],
    [/\bGHS\b/, 'GHS'],
    [/\bKES\b/, 'KES'],
    [/\bUGX\b/, 'UGX'],
    [/\bTZS\b/, 'TZS'],
    [/\bRWF\b/, 'RWF'],
    [/\bETB\b/, 'ETB'],
    [/\bZAR\b/, 'ZAR'],
    [/\bZMW\b/, 'ZMW'],
    [/\bMZN\b/, 'MZN'],
    [/\bBWP\b/, 'BWP'],
    [/\bCDF\b/, 'CDF'],
    [/\bMAD\b/, 'MAD'],
    [/\bEGP\b/, 'EGP'],
    [/\bUSD\b/, 'USD'],
    [/\bEUR\b|€/, 'EUR'],
    [/\bGBP\b|£/, 'GBP'],
  ];
  return currencies.find(([pattern]) => pattern.test(upper))?.[1] ?? null;
}

/**
 * Extract priced rows without allocating them into model-generated trade categories.
 *
 * A line is included only when its own row contains a readable description and amount.
 * Subtotals and carry-forward lines are excluded so they cannot be mistaken for work
 * items or counted twice.
 */
export function readBqLineItems(text: string): BqLineItem[] {
  if (!text || !/\d/.test(text)) return [];

  const items: BqLineItem[] = [];
  let amountColumn: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;

    const row = cells(raw);
    const detectedColumn = findAmountColumn(row);
    if (detectedColumn !== null) {
      amountColumn = detectedColumn;
      continue;
    }

    const cleaned = normalise(raw);
    if (NOT_THE_TOTAL.test(cleaned) || GRAND_TOTAL.some(pattern => pattern.test(cleaned))) continue;

    const amount = amountColumn !== null
      ? parseAmount(row[amountColumn] ?? '')
      : lastAmount(row);

    if (amount === null) continue;
    const label = row
      .filter(cell => parseAmount(cell) === null)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!/[a-z\u00c0-\u024f]/i.test(label)) continue;

    items.push({ label, amount });
  }
  return items;
}

/** The last numeric cell is conventionally the extended amount in a BOQ row. */
function lastAmount(row: string[]): number | null {
  for (let i = row.length - 1; i >= 0; i--) {
    const amount = parseAmount(row[i]);
    if (amount !== null) return amount;
  }
  return null;
}

/**
 * Read a construction total out of delimited BQ text.
 *
 * Returns null when nothing usable is there — an empty file, a PDF's binary, a BQ with
 * no priced column. Null means "ask them to type it", which is a fine answer.
 */
export function readBqTotal(text: string): BqReading | null {
  if (!text || !/\d/.test(text)) return null;

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return null;

  /** Matched against the accent-stripped, lower-cased line; shown as written. */
  const normalised = lines.map(normalise);

  /** Track each table's priced column, so quantity/rate cannot win by being larger. */
  const amountColumns: Array<number | null> = [];
  let amountColumn: number | null = null;
  for (const line of lines) {
    const row = cells(line);
    const detectedColumn = findAmountColumn(row);
    // Whitespace-separated OCR has no stable cell positions: description words
    // shift the amount column from row to row. Use a detected index only for genuine
    // table delimiters; plain OCR lines use their final numeric value instead.
    if (detectedColumn !== null
        && (line.includes('\t') || line.includes(';') || commaSeparates(line))) {
      amountColumn = detectedColumn;
    }
    amountColumns.push(amountColumn);
  }

  const rowAmount = (line: string, index: number, allowFallback = false): number | null => {
    const row = cells(line);
    const column = amountColumns[index];
    const columnAmount = column !== null && row.length > column
      ? parseAmount(row[column] ?? '')
      : null;
    return columnAmount ?? (column === null || allowFallback ? lastAmount(row) : null);
  };

  // ── First choice: a row that calls itself the grand total ──
  for (const pattern of GRAND_TOTAL) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pattern.test(normalised[i]) || NOT_THE_TOTAL.test(normalised[i])) continue;
      const amount = rowAmount(line, i, true);
      if (amount !== null && amount >= MIN_PLAUSIBLE_TOTAL) {
        return {
          total: amount, label: line.trim().slice(0, 120), confidence: 'grand',
          currencyCode: detectCurrencyCode(line) ?? detectCurrencyCode(text),
        };
      }
    }
  }

  // ── Otherwise: the largest figure that is not an excluded row ──
  //
  // A guess, flagged as one. On a well-formed BQ the biggest number IS the total, but
  // on a BQ whose sections were never summed it is merely the biggest section.
  let best: { total: number; label: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (NOT_THE_TOTAL.test(normalised[i])) continue;
    const amount = rowAmount(line, i);
    if (amount !== null && amount >= MIN_PLAUSIBLE_TOTAL
        && (best === null || amount > best.total)) {
      best = { total: amount, label: line.trim().slice(0, 120) };
    }
  }
  return best ? {
    ...best, confidence: 'sum', currencyCode: detectCurrencyCode(best.label) ?? detectCurrencyCode(text),
  } : null;
}

/**
 * Below this, it is not a building.
 *
 * Found by a test: `%PDF-1.4` parsed as a total of 1.4, which would have become the
 * construction budget and been split across ten stage payments. Any stray decimal in a
 * file header, a version string or a page number does the same.
 *
 * A bill of quantities for a house is in the millions of XAF or the tens of thousands
 * of USD. A thousand is comfortably beneath any real BQ in either unit and comfortably
 * above the noise, and anything rejected here just means the person types the figure —
 * which is the safe failure.
 */
const MIN_PLAUSIBLE_TOTAL = 1000;

/** File types `readBqTotal` can actually read. Anything else: the person types it. */
export const READABLE_BQ_TYPES = ['.csv', '.tsv', '.txt'] as const;

export function looksReadable(filename: string): boolean {
  return READABLE_BQ_TYPES.some(ext => filename.toLowerCase().endsWith(ext));
}
