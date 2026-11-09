// =========================================================
// Which sheet is this, and does this file contain a floor plan at all?
//
// ── Why this exists ─────────────────────────────────────────────────────────────────
// "Qualified Projects are those that are already ongoing or starting within 60 days,
// and the contractor has uploaded their bill of quantities and floor plan."
//
// To answer that, something has to KNOW a floor plan when it sees one. Until 179 every
// drawing was filed as `other`, and even with a `floor_plan` category the filing is a
// contractor ticking a box: of the eleven drawings in production on 9 Nov 2026, seven
// were not floor plans at all. Two were site layouts, two were foundation plans, two
// were structural sets and one was a sheet of elevations. A plan set is many sheets and
// the person uploading it does not sort them.
//
// ── Why a title beats a room label ──────────────────────────────────────────────────
// A drawing says what it is, in its own title block, in the project's own language:
// GROUND PLAN, PLAN ETAGE 2 ET 3, PLAN DE FONDATION, PLAN D'AMENAGEMENT, FACADE SUD.
// That is the architect's own statement and it is checked first. Room labels are the
// fallback, for the sheet whose title block flattened badly or never had one — a plan
// view is the only drawing that labels CHAMBRE, SALON and CUISINE where the rooms are.
//
// ── What this must never do ─────────────────────────────────────────────────────────
// Contradict the drawing. Everything here is read off the sheet's own text; nothing is
// inferred from the file name, because a file is called whatever it was saved as —
// "R14.pdf" is a floor plan and "HIPE PROPOSED PLAN 2.pdf" is a site layout.
// =========================================================

export type SheetKind =
  | 'floor_plan'
  | 'site_plan'
  | 'foundation'
  | 'structural'
  | 'elevation'
  | 'section'
  | 'roof_plan'
  | 'schedule'
  | 'unknown';

export interface SheetReading {
  kind: SheetKind;
  /** The words on the sheet that decided it. Quoted so a wrong call can be argued with. */
  basis: string[];
}

/**
 * Sheet titles, most specific first. ORDER CARRIES MEANING.
 *
 * `PLAN DE COFFRAGE RADIER` contains "radier", a raft foundation — but a formwork
 * drawing of a raft is a structural sheet, so the formwork rule has to be reached
 * before the foundation one. Likewise `SITE-SECTION-ROOF` is one title block covering
 * three sheet kinds, and whichever matches is enough: none of them is a floor plan.
 */
const TITLES: { kind: SheetKind; pattern: RegExp }[] = [
  // Formwork and reinforcement. Requires the words a structural sheet actually carries
  // — NOT a bare "poteau", which an architectural plan also prints beside a column.
  { kind: 'structural', pattern: /\b(?:coffrage|ferraillage|reinforcement|rebar|nomenclature\s+poteaux|plan\s+de\s+b[eé]ton|beam\s+(?:layout|plan)|floor\s+beam|slab\s+(?:layout|reinforcement))\b/i },
  // A sheet that NAMES itself a foundation plan. Split from the bare word below on
  // purpose: a section sheet prints "-1 FONDATION" in its level legend, and that is the
  // legend talking about a level, not the sheet saying what it is.
  { kind: 'foundation', pattern: /\b(?:plan\s+de\s+(?:fondation|radier)|foundation\s+(?:plan|layout)|footing\s+(?:plan|layout))\b/i },
  // A site layout shows where the building SITS. It is the drawing most often mistaken
  // for a plan, because it is drawn in plan view and is sometimes the only sheet sent.
  { kind: 'site_plan', pattern: /\b(?:plan\s+de\s+masse|plan\s+d['’]am[eé]nagement|implantation|site\s+plan|plot\s+plan|layout\s+plan|block\s+plan|masterplan)\b/i },
  { kind: 'roof_plan', pattern: /\b(?:plan\s+de\s+(?:toiture|charpente)|roof\s+(?:plan|framing)|charpente)\b/i },
  { kind: 'elevation', pattern: /\b(?:fa[cç]ades?|elevation\s+views?|elevations?)\b/i },
  { kind: 'section', pattern: /\b(?:coupe\s*(?:[A-Z]\s*[-–]\s*[A-Z]|longitudinale|transversale|\d)|cross[- ]?section|section\s+\d)\b/i },
  // The bare word, reached only after a section has had its chance to claim the sheet.
  { kind: 'foundation', pattern: /\b(?:fondations?|semelles?)\b/i },
  // The one we are looking for. "PLAN" alone is never enough — every sheet above is a
  // "plan" in French — so each alternative names the LEVEL the plan is of.
  { kind: 'floor_plan', pattern: /\b(?:ground\s+(?:floor\s+)?plan|floor\s+plans?|plan\s+(?:du\s+|de\s+)?(?:rdc|rez[- ]de[- ]chauss[eé]e)|plan\s+(?:d['’])?[eé]tages?|plan\s+niveau|plan\s+de\s+(?:distribution|niveau)|(?:first|second|third|upper|typical|mezzanine)\s+floor\s+plan|plan\s+r\s*\+\s*\d)\b/i },
  // A door/window schedule or a bar bending schedule is a table, not a drawing.
  { kind: 'schedule', pattern: /\b(?:door\s+and\s+window\s+schedule|schedule\s+of\s+(?:doors|windows|finishes)|bar\s+bending\s+schedule)\b/i },
];

/**
 * Rooms, by the family of label they belong to.
 *
 * Counted as FAMILIES, not occurrences: one sheet printing "CHAMBRE" nine times is one
 * kind of evidence, and a section drawing can carry a stray room name. Two different
 * families — a kitchen and a living room, a bedroom and a bathroom — is a laid-out
 * interior, which only a plan view shows.
 */
const ROOM_FAMILIES: Record<string, RegExp> = {
  bedroom: /\b(?:bed\s*-?\s*room|m\.?\s*bed\s*room|master['’]?s?\s+room|chambre)\b/i,
  living: /\b(?:sitting\s*-?\s*room|living\s*-?\s*room|lounge|parlou?r|salon|s[eé]jour)\b/i,
  kitchen: /\b(?:kitchen|kitchin|cuisine)\b/i,
  bathroom: /\b(?:bath\s*-?\s*room|toilets?|toil\.?|wc|w\.c\.|salle\s+de\s+bain)\b/i,
  circulation: /\b(?:veranda|v[eé]randa|terrasse|balcon|balcony|hall|lobby|porch|couloir)\b/i,
  workspace: /\b(?:offices?|bureaux?|open\s*-?\s*space|r[eé]ception|reception|meeting\s+room|salle\s+de\s+r[eé]union|shop\s+space|boutique)\b/i,
  service: /\b(?:dinn?ing|salle\s+[aà]\s+manger|s\.?a\.?m\.?|garage|store|r[eé]serve|laundry|buanderie|pantry)\b/i,
};

/** Families that, on their own, mean somebody could live or work in this layout. */
const OCCUPIED = new Set(['bedroom', 'living', 'kitchen', 'workspace']);

/**
 * Is this page a DRAWING at all?
 *
 * ── The false positive this exists to stop ──────────────────────────────────────────
 * A bill of quantities names rooms. A devis descriptif names them in sentences — "03
 * appartements: 01 Salon d'une superficie de 25,01m2, 01 cuisine de 6,50m2, 01 chambre
 * principale..." — and a priced bill names them in its rows. Both read exactly like a
 * floor plan to anything that only looks for room words, and on 9 Nov 2026 both did:
 * two bills of quantities in production came back as floor plans.
 *
 * A room NAMED IN A SENTENCE is not a room LABELLED ON A SHEET.
 *
 * ── What separates them, measured on the real files ─────────────────────────────────
 * A drawing states its scale, or prints a field of bare dimension strings — "3.15",
 * "4.35", "1.20", one per line, because that is what a CAD dimension flattens to. The
 * five plan sheets in production run 33–65% such lines; the two bills run 0–1%, and
 * neither states a scale. The gap is not marginal, which is why this is a gate and not
 * a score.
 */
function looksLikeDrawing(text: string): boolean {
  // "ECHELLE: 1/100è", "1 : 50", "SCALE 1:200". A sheet that states its scale is a
  // sheet, full stop — no drawing omits it and no prose page carries it.
  if (/\b(?:[eé]chelle|scale)\b/i.test(text)) return true;
  if (/\b1\s*[:\/]\s*(?:10|20|25|50|75|100|200|250|500|1000)\b/.test(text)) return true;

  // Otherwise: enough bare dimension strings, and enough of the page made of them. Both
  // conditions, because a bill's quantity column also holds decimals — what it does not
  // hold is a page that is MOSTLY them.
  //
  // Split on TABS as well as newlines. The same sheet arrives in two shapes: `pdftotext`
  // puts every dimension on its own line, while the browser extractor groups text items
  // by their printed Y and joins a line with tabs — so a dimension chain reaches here as
  // "3.15\t2.15\t4.35" from one reader and as three lines from the other. Counting only
  // newlines would see a drawing as a drawing on the server and as prose in the wizard,
  // which is the worst possible place for the two to disagree.
  const tokens = text.split(/[\r\n\t]+/).map(t => t.trim()).filter(Boolean);
  if (tokens.length < 12) return false;
  const dims = tokens.filter(t => /^\d{1,3}[.,]\d{1,2}$/.test(t)).length;
  return dims >= 8 && dims / tokens.length >= 0.15;
}

function titleOf(text: string): SheetReading | null {
  for (const rule of TITLES) {
    const hit = text.match(rule.pattern);
    if (hit) return { kind: rule.kind, basis: [hit[0].replace(/\s+/g, ' ').trim()] };
  }
  return null;
}

/** The families this sheet names, in a stable order. */
function familiesOn(text: string): { family: string; label: string }[] {
  const out: { family: string; label: string }[] = [];
  for (const [family, pattern] of Object.entries(ROOM_FAMILIES)) {
    const hit = text.match(pattern);
    if (hit) out.push({ family, label: hit[0].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/**
 * What one sheet is.
 *
 * `text` is that page's text layer, as `pdftotext` or OCR produced it. CAD title blocks
 * flatten into loose lines, so nothing here depends on position — only on the words
 * being somewhere on the sheet.
 */
export function classifySheet(text: string): SheetReading {
  if (!text.trim()) return { kind: 'unknown', basis: [] };

  // Before anything else: a page of prose is not a sheet. A devis descriptif has
  // chapters called IMPLANTATION and CHARPENTE and a bill has rows naming every room
  // in the building, and neither is a drawing of one.
  if (!looksLikeDrawing(text)) return { kind: 'unknown', basis: [] };

  const titled = titleOf(text);
  if (titled) return titled;

  // No title we recognise. A laid-out interior is the one thing room labels can prove:
  // two different families of room, at least one of them somewhere a person would be.
  const families = familiesOn(text);
  const occupied = families.filter(f => OCCUPIED.has(f.family));
  if (families.length >= 2 && occupied.length >= 1) {
    return { kind: 'floor_plan', basis: families.slice(0, 4).map(f => f.label) };
  }
  return { kind: 'unknown', basis: [] };
}

export interface DocumentReading {
  /** True when at least one sheet in the file is a plan of a level. */
  isFloorPlan: boolean;
  /** One reading per page, in page order. */
  sheets: SheetReading[];
  /** The sheet kinds present, deduplicated — what this file actually contains. */
  contains: SheetKind[];
  /** Why the verdict went the way it did, quoting the sheet. */
  basis: string[];
}

/**
 * Does this FILE contain a floor plan?
 *
 * A plan set is one upload and many sheets: the Kalla duplex is ten pages, of which
 * three are plans of a level and seven are a site layout, a foundation plan, a roof
 * plan, four elevations and a section. One qualifying sheet makes the file a floor
 * plan, because that is what the person was asked for and what they sent.
 */
export function readPlanDocument(pageTexts: string[]): DocumentReading {
  const sheets = pageTexts.map(classifySheet);
  const first = sheets.find(s => s.kind === 'floor_plan');
  const contains: SheetKind[] = [];
  for (const sheet of sheets) if (!contains.includes(sheet.kind)) contains.push(sheet.kind);
  return {
    isFloorPlan: first != null,
    sheets,
    contains,
    basis: first ? first.basis : [],
  };
}

/** What a set of uploaded drawings adds up to, for saying so on screen. */
/** Every sheet kind except the one that means "we could not tell". */
export type NamedSheetKind = Exclude<SheetKind, 'unknown'>;

export interface UploadReading {
  /** True when at least one drawing in the upload holds a plan of a level. */
  hasFloorPlan: boolean;
  /**
   * What was found instead, deduplicated, when none of them does.
   *
   * Typed without `unknown` so "we could not identify this sheet" cannot be reported
   * as a finding — a caller mapping these to words would otherwise need a label for it,
   * and there is nothing truthful to put there.
   */
  insteadFound: NamedSheetKind[];
  /** True when nothing could be read at all — a scan, a photograph, a flattened export. */
  unreadable: boolean;
}

/**
 * Read a whole upload: did they give us a floor plan, and if not, what did they give us?
 *
 * ── Why this is said out loud ───────────────────────────────────────────────────────
 * On 9 Nov 2026, of the eleven drawings contractors had uploaded as their plan, SEVEN
 * were not floor plans. Nobody was being careless — a site layout and a foundation plan
 * are both drawn in plan view, so they look exactly like the thing that was asked for,
 * and three projects reached a budget and a stage schedule on the strength of sheets
 * that show no rooms at all. Nothing ever told anyone, so nothing could be fixed.
 *
 * ── What it must NOT do ─────────────────────────────────────────────────────────────
 * Block. A contractor may genuinely have only those sheets, and the honest response to
 * that is to say so and carry on — the drawing they have is still the drawing they
 * have. Refusing the upload would turn a reading into a gate, and a gate on a reading
 * that can be wrong is worse than no reading. It also must not say "not a floor plan"
 * about a file nothing could read: `undefined` is "we did not find out", and that is a
 * different sentence.
 */
export function readUpload(
  readings: { isFloorPlan?: boolean; sheets?: SheetReading[] }[],
): UploadReading {
  const answered = readings.filter(r => r.isFloorPlan != null);
  if (!readings.length || !answered.length) {
    return { hasFloorPlan: false, insteadFound: [], unreadable: readings.length > 0 };
  }
  if (answered.some(r => r.isFloorPlan)) {
    return { hasFloorPlan: true, insteadFound: [], unreadable: false };
  }
  const insteadFound: NamedSheetKind[] = [];
  for (const reading of answered) {
    for (const sheet of reading.sheets ?? []) {
      if (sheet.kind !== 'unknown' && !insteadFound.includes(sheet.kind)) {
        insteadFound.push(sheet.kind);
      }
    }
  }
  return { hasFloorPlan: false, insteadFound, unreadable: false };
}
