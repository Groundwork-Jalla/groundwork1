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
  /** USD. Always a positive finite number. */
  total: number;
  /** The row the figure came from, shown to the person so they can check it. */
  label: string;
  /**
   * `grand` — a row that names itself as the overall total.
   * `sum`   — no such row; the largest figure present, which is a guess.
   */
  confidence: 'grand' | 'sum';
}

/** Rows that name themselves as the whole job. Ordered: earlier wins. */
const GRAND_TOTAL = [
  /\bgrand\s*total\b/i,
  /\btotal\s+(?:project|contract|construction)\s+(?:cost|sum|amount|value)\b/i,
  /\b(?:project|contract)\s+total\b/i,
  /\btotal\s+amount\b/i,
  /\btotal\s+cost\b/i,
];

/**
 * Rows that look like a total but are not the one we want.
 *
 * A BQ commonly carries per-section subtotals, a VAT or tax line, and "carried to
 * summary" rows. Any of them can be the largest number on the page, and taking one
 * would silently inflate or deflate every stage payment.
 */
const NOT_THE_TOTAL =
  /\b(sub[\s-]?total|vat|tax|t\.?v\.?a\.?|carried|brought\s+forward|page\s+total|provisional|contingenc|excl|less\b|discount)\b/i;

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

/** Split a line into cells, for comma, semicolon or tab separated text. */
function cells(line: string): string[] {
  // Quoted cells may contain the separator. Good enough for a BQ export, and the
  // person confirms the result regardless.
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
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

  /** The largest number on a row, which is where a BQ puts the amount. */
  const rowAmount = (row: string[]): number | null => {
    let best: number | null = null;
    for (const c of row) {
      const n = parseAmount(c);
      if (n !== null && (best === null || n > best)) best = n;
    }
    return best;
  };

  // ── First choice: a row that calls itself the grand total ──
  for (const pattern of GRAND_TOTAL) {
    for (const line of lines) {
      if (!pattern.test(line) || NOT_THE_TOTAL.test(line)) continue;
      const amount = rowAmount(cells(line));
      if (amount !== null && amount >= MIN_PLAUSIBLE_TOTAL) {
        return { total: amount, label: line.trim().slice(0, 120), confidence: 'grand' };
      }
    }
  }

  // ── Otherwise: the largest figure that is not an excluded row ──
  //
  // A guess, flagged as one. On a well-formed BQ the biggest number IS the total, but
  // on a BQ whose sections were never summed it is merely the biggest section.
  let best: { total: number; label: string } | null = null;
  for (const line of lines) {
    if (NOT_THE_TOTAL.test(line)) continue;
    const amount = rowAmount(cells(line));
    if (amount !== null && amount >= MIN_PLAUSIBLE_TOTAL
        && (best === null || amount > best.total)) {
      best = { total: amount, label: line.trim().slice(0, 120) };
    }
  }
  return best ? { ...best, confidence: 'sum' } : null;
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
