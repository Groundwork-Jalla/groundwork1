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
  /** Decimal source value before currency conversion or payment rounding. */
  sourceAmount?: string;
  source?: { sheet?: string; cell?: string; row?: number; page?: number };
}

/** Keep numeric spreadsheet cells numeric, together with their original coordinates. */
export interface BqSourceRow {
  cells: Array<string | number | null>;
  sheet?: string;
  row?: number;
  page?: number;
  addresses?: string[];
  stableColumns?: boolean;
}

export interface BqLineItem {
  label: string;
  amount: number;
}

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
 * Labels used for project totals. `totalTier` assigns their semantic priority.
 *
 * English and French together, because a Cameroonian QS writes in whichever the
 * client reads and the document does not say which it will be. Tested against the
 * NORMALISED line, so these carry no accents.
 *
 * French bills commonly list HT, TVA, then TTC. TTC names the final payable amount.
 */
const GRAND_TOTAL = [
  // ── What is actually payable ──
  // Sought FIRST, for the same reason TTC is sought before HT: it is the figure the
  // client pays and the contractor is owed.
  //
  // Mr Nas's estimate, Limbe, read on 28 October: the summary lists twelve trade
  // sections, then "TOTAL 19,037,728" — which is their sum and is MATERIALS ONLY —
  // then LABOUR 7,500,000, TRANSPORTATION 150,000, and "NET PAYABLE 26,687,728",
  // written out in words underneath to leave no doubt. The bare-"total" pattern below
  // matched the first of those, so Groundwork read the bill 7,650,000 light, 28.7%
  // under, and said "We read this total from the document" while doing it. At
  // `grand` confidence that figure carries into the budget and becomes the payment at
  // every stage of the build.
  // French tax-inclusive rows, before any "total general" so that a HT row listed
  // above its TTC row does not win. TTC is what the client pays.
  /\b(?:total|montant)\s+(?:general\s+)?(?:de\s+l\W?(?:offre|operation)\s+)?(?:ttc|t\.t\.c\.?)(?:\s|$)/,
  /\bnet\s+payable\b/,
  /\b(?:amount|total|sum)\s+payable\b/,
  /\bnet\s+total\b/,
  /\bnet\s+a\s+payer\b/,
  /\bmontant\s+net\b/,
  /\btotal\s+a\s+payer\b/,
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
  /\b(?:total|montant)\s+(?:de\s+)?l\W?(?:offre|operation)\b/,
  /\bsomme\s+totale\b/,
  /\btotal\s+des\s+(?:lots|travaux)\b/,
  /\bmontant\s+(?:ht|hors\s+taxes?)\b/,
  /\btotal\s+global\b/,
  /\btotal\s+(?:du\s+)?(?:projet|marche|devis)\b/,
  /\bcout\s+total\b/,
  /\brecapitulatif\s+general\b/,
  // Some spreadsheets label their final summary row simply "TOTAL", while
  // section rows say "TOTAL FOUNDATION", "TOTAL PAINTING", and so on.
  /(?:^|\t)total(?:\t|$)/,
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
    'total\\s+des\\s+postes',
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
const TABLE_HEADER = /\b(?:item|description|designation|desc|libelle|article|art|qty|qte|quantity|quantite|unit|unite|rate|code|no\.?)\b/;

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

/** Parse a monetary cell without fusing unrelated words, percentages or digits. */
export function parseAmount(cell: string | number): number | null {
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell <= 0) return null;
    const cents = Math.round(cell * 100) / 100;
    return Math.abs(cell - cents) <= Number.EPSILON * Math.max(1, cell) * 2 ? cents : cell;
  }
  const raw = cell.trim();
  if (!raw) return null;
  if (/^\s*\(/.test(raw)) return null; // Accounting parentheses represent a negative value.
  const cleaned = raw
    .replace(/\b(?:XAF|XOF|FCFA|CFA|USD|EUR|GBP|NGN|GHS|KES|UGX|TZS|RWF|ETB|ZAR|ZMW|MZN|BWP|CDF|MAD|EGP)\b/gi, '')
    .replace(/[$€£₦]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!/^[+]?\d[\d\s.,'’]*$/.test(cleaned)) return null;
  const numericText = cleaned.replace(/[\s'’]/g, '');

  // Formula caches occasionally contain IEEE-754 residue. Only remove actual noise.
  if (/^\d+\.\d{3,}$/.test(numericText)) {
    const numeric = Number(numericText);
    const cents = Math.round(numeric * 100) / 100;
    if (Number.isFinite(numeric)
        && Math.abs(numeric - cents) <= Number.EPSILON * Math.max(1, numeric) * 2) return cents;
  }

  const lastDot = numericText.lastIndexOf('.');
  const lastComma = numericText.lastIndexOf(',');
  const separator = Math.max(lastDot, lastComma);
  let decimal = false;
  if (separator >= 0) {
    const fraction = numericText.slice(separator + 1);
    const whole = numericText.slice(0, separator);
    const bothSeparators = lastDot >= 0 && lastComma >= 0;
    const sameSeparatorCount = (numericText.match(lastDot > lastComma ? /\./g : /,/g) ?? []).length;
    // A single 3-digit group such as 1,234 is ambiguous: retain the established
    // thousands convention. A long ungrouped integer or a separately grouped integer
    // makes 1414073374.524 / 1 414 073 374,524 unambiguous decimals.
    decimal = /^\d{1,6}$/.test(fraction) && (fraction.length !== 3 || bothSeparators
      || (sameSeparatorCount === 1 && (whole.length > 3 || /[\s'’]/.test(cleaned))));
  }
  const normalised = decimal
    ? numericText.slice(0, separator).replace(/[.,]/g, '') + '.' + numericText.slice(separator + 1)
    : numericText.replace(/[.,]/g, '');
  // Repeated punctuation is grouping only when every group has three digits.
  // Reject malformed numbers instead of joining e.g. 1.2.3 into 123.
  const integerText = decimal ? numericText.slice(0, separator) : numericText;
  if (/[.,]/.test(integerText)
      && !/^\+?\d{1,3}(?:,\d{3})+$/.test(integerText)
      && !/^\+?\d{1,3}(?:\.\d{3})+$/.test(integerText)) return null;
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
  // Numeric commas can be grouping marks or French decimal separators. A real CSV
  // row still has a comma beside a label, quote, or another delimiter.
  return line.replace(/(?<=\d),(?=\d)/g, '').includes(',');
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
  // OCR emits French grouped amounts separated only by spaces. Keep the complete
  // numeric tail of a labelled total together; otherwise 1 414 073 374,524 would
  // become an apparently confident total of 374,524.
  if (totalTier(normalise(line)) !== null) {
    const groupedTail = line.match(/^(.*?\D)\s+(\d{1,3}(?:[\s'’]+\d{3})+(?:[.,]\d{1,6})?)(?:\s*(XAF|XOF|FCFA|CFA|USD|EUR|GBP|NGN|GHS|KES|UGX|TZS|RWF|ETB|ZAR|ZMW|MZN|BWP|CDF|MAD|EGP))?\s*$/i);
    if (groupedTail) return [groupedTail[1], groupedTail[2] + (groupedTail[3] ? ` ${groupedTail[3]}` : '')];
  }
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

    // Sheet numbers (0.1, 0.2) and fused digits are not priced work.
    if (amount === null || amount < 1 || amount > MAX_PLAUSIBLE_TOTAL) continue;
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
  return readBqTotalRows(text.split(/\r?\n/).map((line, index) => ({
    cells: cells(line), row: index + 1,
    stableColumns: line.includes('\t') || line.includes(';') || commaSeparates(line),
  })), text);
}

/** A semantic tier, rather than regex declaration order deciding the payable sum. */
function totalTier(label: string): number | null {
  const structuralSubtotal = /\b(?:sub[\s-]?total|sous[\s-]?total|total\s+partiel|page\s+total|carried|brought\s+forward|a\s+reporter|reporte)\b/.test(label);
  if (structuralSubtotal) return null;
  if (!GRAND_TOTAL.some(pattern => pattern.test(label))
      && !/^\s*total\b.*\b(?:h\.?t\.?|ttc)\s*(?:\t|$)/.test(label)) return null;
  // A payable total can explicitly say that tax or a discount is included. Those
  // words exclude standalone adjustment rows, not the final total they describe.
  const explicitOverall = /\b(?:grand\s*total|total\s+(?:general|global)|net\s+payable|(?:amount|total|sum)\s+payable|net\s+a\s+payer|montant\s+net|total\s+a\s+payer)\b/.test(label);
  const inclusiveTax = /\b(?:incl(?:uding|usive)?\s+(?:vat|tax(?:es)?)|(?:vat|tax(?:es)?)\s+included|tva\s+(?:comprise|incluse)|toutes?\s+taxes?\s+comprises?)\b/.test(label);
  if (NOT_THE_TOTAL.test(label) && !explicitOverall && !inclusiveTax) return null;
  if (/\b(?:ttc|t\.t\.c\.?|payable)\b|\bnet\s+(?:total|a\s+payer)\b|\bmontant\s+net\b|\btotal\s+a\s+payer\b/.test(label)) return 0;
  if (/\bh\.?t\.?\b|\bhors\s+taxes?\b/.test(label)) return 3;
  if (/(?:^|\t)total(?:\t|$)/.test(label)) return 2;
  return 1;
}

/** Read workbook rows without a lossy numeric-to-locale-text round trip. */
export function readBqTotalRows(rows: BqSourceRow[], currencyText?: string): BqReading | null {
  const text = currencyText ?? rows.map(row => row.cells.join('\t')).join('\n');
  let amountColumn: number | null = null;
  let currentSheet: string | undefined;
  const candidates: Array<{ row: BqSourceRow; label: string; tier: number; amount: number | null; column: number | null }> = [];
  let guess: BqReading | null = null;

  for (const row of rows) {
    if (row.sheet !== currentSheet) { amountColumn = null; currentSheet = row.sheet; }
    const values = row.cells;
    const label = values.map(value => value == null ? '' : String(value)).join('\t');
    if (!label.trim()) continue;
    const normalised = normalise(label);
    const detected = findAmountColumn(values.map(value => value == null ? '' : String(value)));
    if (detected !== null) {
      if (row.stableColumns !== false) amountColumn = detected;
      continue;
    }
    const tier = totalTier(normalised);
    let column = amountColumn;
    let amount = column !== null ? parseAmount(values[column] ?? '') : null;
    // Merged summary rows need not share the detailed table's column positions.
    if (amount === null && (column === null || tier !== null)) {
      for (let i = values.length - 1; i >= 0; i--) {
        const parsed = parseAmount(values[i] ?? '');
        if (parsed !== null) { amount = parsed; column = i; break; }
      }
    }
    if (tier !== null) {
      candidates.push({ row, label, tier, amount, column });
      continue;
    }
    if (NOT_THE_TOTAL.test(normalised) || amount === null
        || amount < MIN_PLAUSIBLE_TOTAL || amount > MAX_PLAUSIBLE_TOTAL) continue;
    if (!guess || amount > guess.total) guess = makeReading(row, label, amount, column, 'sum', text);
  }

  if (candidates.length) {
    // An explicit workbook summary describes the job, even if detail tabs follow it.
    const summary = candidates.filter(candidate => /^(?:summary|recap(?:itulatif)?(?:general)?|sommaire|synthese)$/
      .test(normalise(candidate.row.sheet ?? '').replace(/[\s_-]/g, '')));
    const scoped = summary.length ? summary : candidates;
    const strongest = Math.min(...scoped.map(candidate => candidate.tier));
    // Equivalent totals later in the document supersede earlier summaries, even if
    // the final value is unreadable. Never silently substitute an earlier HT figure.
    const chosen = scoped.filter(candidate => candidate.tier === strongest).at(-1)!;
    if (chosen.amount === null || chosen.amount < MIN_PLAUSIBLE_TOTAL || chosen.amount > MAX_PLAUSIBLE_TOTAL) return null;
    return makeReading(chosen.row, chosen.label, chosen.amount, chosen.column, 'grand', text);
  }
  return guess;
}

function makeReading(row: BqSourceRow, label: string, total: number, column: number | null,
  confidence: BqReading['confidence'], text: string): BqReading {
  return {
    total, sourceAmount: String(total), label: label.trim().slice(0, 120), confidence,
    currencyCode: detectCurrencyCode(label) ?? detectCurrencyCode(text),
    source: {
      ...(row.sheet ? { sheet: row.sheet } : {}),
      ...(row.row ? { row: row.row } : {}),
      ...(row.page ? { page: row.page } : {}),
      ...(column !== null && row.addresses?.[column] ? { cell: row.addresses[column] } : {}),
    },
  };
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

/** Above this, digits from separate cells were fused into one number; the person types it. */
const MAX_PLAUSIBLE_TOTAL = 1e12;

/** File types `readBqTotal` can actually read. Anything else: the person types it. */
export const READABLE_BQ_TYPES = ['.csv', '.tsv', '.txt'] as const;

export function looksReadable(filename: string): boolean {
  return READABLE_BQ_TYPES.some(ext => filename.toLowerCase().endsWith(ext));
}
