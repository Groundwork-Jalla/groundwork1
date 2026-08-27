import type {
  CityRate, ConstructionRate, TakeoffModel, WizardFormData,
} from '@/types/project';
import { BASELINE_CITY, CITY_RATES, CM_TAKEOFF, resolveCityRate } from './model';
import { countOpenings, deriveQuantities, type DetailedTakeoffInput } from './geometry';
import { plumbingLines } from './fixtures';
import { isFlatRoof, roofCoveringDelta } from './roof';
import { BQ_ITEMS, type BqCode } from './bq-items';
import {
  applyOverrides, sectionsFromLines, totalFromLines,
  type OverrideMap, type TakeoffLine,
} from './lines';

/**
 * Sections the contingency is taken over — everything except `finishing`, the section it
 * lives in. Declared here rather than inline so the ordering rule in `applyOverrides` has
 * something explicit to read.
 */
const CONTINGENCY_BASIS = [
  'preliminary', 'foundation', 'ground_floor', 'upper_floor',
  'roof', 'joinery', 'electrical', 'plumbing',
] as const;

/** The nine sections a Cameroonian BQ is written in, in BQ order. */
export const SECTION_KEYS = [
  'preliminary', 'foundation', 'ground_floor', 'upper_floor', 'roof',
  'joinery', 'electrical', 'plumbing', 'finishing',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionAmounts = Record<SectionKey, number>;

export interface TakeoffResult {
  /** Every priced line, in BQ order. Section totals are the sum of these. */
  lines: TakeoffLine[];
  /** Section costs in LOCAL currency (XAF for Cameroon). */
  sectionsLocal: SectionAmounts;
  totalLocal: number;
  /** The city whose rates were used. */
  cityRate: CityRate;
  model: TakeoffModel;
}

/**
 * Price a project by quantity take-off — the way the engineers who wrote the source BQs
 * price one. Quantities come from geometry and room composition; unit rates come from the
 * city rate book and the prices quoted in those documents.
 *
 * Returns local currency because that is the currency the whole rate card is expressed
 * in. Callers convert to USD via the country's approx_fx_rate.
 */
export function runTakeoff(
  data: DetailedTakeoffInput,
  rate: ConstructionRate,
  cityRate?: CityRate | null,
  overrides?: OverrideMap | null,
): TakeoffResult | null {
  const model = rate.takeoff ?? (rate.country_code === 'CM' ? CM_TAKEOFF : null);
  if (!model) return null;

  const city = cityRate
    ?? resolveCityRate(data.city, rate.country_code, CITY_RATES)
    ?? CITY_RATES[BASELINE_CITY];

  const g = model.geometry;
  const r = model.rates;
  const q = deriveQuantities(data, g);

  if (q.footprint <= 0) return null;

  const A          = q.footprint;
  const floors     = q.floors;
  const upperCount = floors - 1;
  const finishMult = rate.finish_multipliers[data.finishLevel ?? 'standard'] ?? 1.0;

  // ── Pricing this building in a given city, at a given trade index ──
  //
  // Extracted so the engine can price the SAME building more than once and solve for a
  // figure, rather than carrying a precomputed constant. Two things are solved below:
  // the city's trade index, and the roof covering's uplift. Neither is stored anywhere.
  //
  // `ci` scales the non-concrete trades only. Concrete grades come from the city's own
  // rc_350 / rc_250 / lean columns, which are measured data and must not be scaled.
  const priceAt = (cityBook: CityRate, ci: number, roofType = data.roofType): TakeoffLine[] => {

  // ── Line emission ───────────────────────────────────────
  //
  // Every section is the SUM of its lines. The arithmetic is unchanged from the
  // closed-form version this replaces — each expression has simply been split at its `+`
  // signs into the quantity and the rate a quantity surveyor would actually write down.
  //
  // City index `ci` is folded into the RATE, not kept separate: a contractor overriding
  // "blockwork per m²" means the price where they are, which is the indexed one.
  const L: TakeoffLine[] = [];
  const add = (
    code: BqCode, qty: number, rate: number,
    extra?: Partial<Pick<TakeoffLine, 'basis' | 'pct'>>,
  ) => {
    const meta = BQ_ITEMS[code];
    // Zero-quantity lines are dropped rather than rendered as 0 x rate rows: a single
    // storey has no upper floor, a pitched roof has no parapet.
    if (!(qty > 0) || !(rate > 0)) return;
    L.push({
      code, section: meta.section, labelKey: meta.labelKey, unit: meta.unit,
      kind: meta.kind, qty, rate, amount: qty * rate,
      rateSource: 'provisional' in meta && meta.provisional ? 'estimated' : 'real_bq',
      ...extra,
    });
  };

  // ── 100 Preliminary ──   was (250_000 + A * 1_600) * ci
  add('101', 1, 250_000 * ci);
  add('102', A, 1_600 * ci);

  // ── 200 Foundation ──
  add('201', A * g.exc_m3_per_m2,       r.excavation_m3 * ci);
  add('202', A * g.exc_m3_per_m2 * 0.8, r.backfill_m3 * ci);
  add('203', A * g.lean_m3_per_m2,      cityBook.lean_concrete);
  add('204', A * g.footing_m3_per_m2 * (1 + g.footing_floor_uplift * upperCount), cityBook.rc_350);
  add('205', q.groundSlabVolume,        cityBook.rc_250);
  add('206', q.perimeter * 0.6,         r.fdn_block_m2 * ci);
  add('207', A, r.dpm_m2 * ci);
  add('208', A, r.sand_bed_m2 * ci);

  // ── 300 / 400 Structure ──
  // An upper floor is priced exactly like the ground floor minus the ground-only items
  // (deck slab, soffit plaster, staircase). The multiplier goes on the QUANTITY, not on a
  // section subtotal — three floors of blockwork is three times the area at one rate.
  const bathsPerFloor = (data.bathrooms ?? 0) / floors;
  const ceilingRate   = r.ceiling_m2 * Math.max(0, finishMult - 1) / 0.7 * ci;

  add('301', A * g.col_m3_per_m2,  cityBook.rc_350);
  add('302', A * g.beam_m3_per_m2, cityBook.rc_350);
  add('305', q.wallPerFloor,       r.blockwork_m2 * ci);
  add('306', q.plasterPerFloor,    r.plaster_m2 * ci);
  add('309', A,                    r.floor_tiles_m2 * ci);
  add('310', bathsPerFloor * 12,   r.wall_tiles_m2 * ci);
  add('311', A,                    ceilingRate);
  // Ground-only
  add('303', q.slabVolume,                        cityBook.rc_350);
  add('307', A,                                   r.deck_plaster_m2 * ci);
  add('308', floors > 1 ? g.stair_m3 : 0,         cityBook.rc_350);

  if (upperCount > 0) {
    add('401', A * g.col_m3_per_m2  * upperCount, cityBook.rc_350);
    add('402', A * g.beam_m3_per_m2 * upperCount, cityBook.rc_350);
    add('405', q.wallPerFloor       * upperCount, r.blockwork_m2 * ci);
    add('406', q.plasterPerFloor    * upperCount, r.plaster_m2 * ci);
    add('409', A                    * upperCount, r.floor_tiles_m2 * ci);
    add('410', bathsPerFloor * 12   * upperCount, r.wall_tiles_m2 * ci);
    add('411', A                    * upperCount, ceilingRate);
  }

  // ── 500 Roof ──
  //
  // Emitted at the LONG-SPAN rate. The covering's uplift is applied further down, once
  // the rest of the build is priced — it is expressed against the total, so there is
  // nothing to take a percentage of yet. See the roof-uplift block below.
  if (isFlatRoof(roofType)) {
    add('501', q.perimeter,                  r.parapet_ml * ci);
    add('503', A * g.flat_roof_sheet_frac,   r.roof_sheet_m2 * ci);
  } else {
    add('502', A * g.pitched_roof_factor,    r.roof_timber_m2 * ci);
    add('503', A * g.pitched_roof_factor,    r.roof_sheet_m2 * ci);
  }
  add('504', 1, r.roof_accessories * ci);

  // ── 600 Joinery ──
  const openings = countOpenings(data);
  add('601', openings.doors,   r.door_avg * ci);
  add('605', openings.windows, r.window * ci);
  add('606', upperCount * g.railing_ml_per_floor,                r.railing_ml * ci);

  // ── 700 Electrical ──
  // floors x (per_floor + roomsPerFloor x per_room) expands to a per-floor line and a
  // per-room line, since floors x roomsPerFloor is exactly the room count.
  add('701', floors,   model.electrical.per_floor * ci);
  add('702', q.rooms,  model.electrical.per_room * ci);

  // ── 800 Plumbing ──
  for (const line of plumbingLines(data, rate.fixture_prices)) {
    add(line.code, line.qty, line.rate * ci);
  }

  // ── 900 Finishing ──
  add('901', q.plasterPerFloor * floors, r.paint_m2 * ci);
  add('907', 1, 500_000 * finishMult);
  // ── Roof covering uplift ─────────────────────────────
  //
  // `costDeltaPct` is a percentage of the WHOLE BUILD (roof.ts). It is charged to the
  // roof section, so the section multiplier has to be solved rather than assumed.
  //
  // Adding X to the roof adds X to the works AND X x c to the contingency, because roof
  // is in CONTINGENCY_BASIS. So to move the total by `delta`:
  //
  //     X (1 + c) = T0 x delta      =>      X = T0 x delta / (1 + c)
  //
  // where T0 is the total at the long-span rate. That makes the realised total exactly
  // T0 x (1 + delta) — asserted in roof.test.ts rather than left to trust.
  //
  // Must run BEFORE the contingency line is pushed, so applyOverrides evaluates it over
  // the uplifted basis. Moving it after would leave the contingency priced on a roof
  // nobody is building.
  // Contingency is a percentage of the works BEFORE finishing — the section it sits in.
  // Emitted last so `applyOverrides` evaluates it against final line amounts.
  L.push({
    code: '999', section: 'finishing', labelKey: BQ_ITEMS['999'].labelKey,
    unit: '%', kind: 'percentage', rateSource: 'estimated',
    qty: 0, rate: g.contingency_pct, amount: 0, pct: g.contingency_pct * 100,
    basis: CONTINGENCY_BASIS,
  });

    return L;
  };

  // ── Solve the city's trade index ─────────────────────────
  //
  // Nothing is stored for this. `cost_delta_pct` is the datum — Vanessa's statement that
  // an identical building in Douala costs 5% less than in Yaoundé — and the index that
  // realises it is computed here, for THIS building.
  //
  // It has to be computed rather than looked up because the concrete columns are not
  // indexed: how much of a build is concrete depends on the building, so one stored index
  // lands on the stated figure for one shape and drifts on every other. Solving per build
  // makes every city land exactly on its percentage, for every building.
  //
  //   T(ci) = C + O·ci        C = concrete + un-indexed, O = indexed trades at ci = 1
  //   T(1) and T(2) give O = T(2) − T(1) and C = T(1) − O
  const sum = (ls: TakeoffLine[]) => totalFromLines(applyOverrides(ls, null));
  const baseline = CITY_RATES[BASELINE_CITY] ?? city;
  const delta    = (city.cost_delta_pct ?? 0) / 100;

  let ci = 1;
  if (city.city_code !== baseline.city_code || delta !== 0) {
    const t1 = sum(priceAt(city, 1));
    const t2 = sum(priceAt(city, 2));
    const O  = t2 - t1;
    const C  = t1 - O;
    const target = sum(priceAt(baseline, 1)) * (1 + delta);
    // O is the indexed share and is never zero for a real building; the guard is for a
    // degenerate input that emitted nothing but concrete.
    if (O > 0) ci = Math.max(0, (target - C) / O);
  }

  // ── Apply the roof covering's uplift ─────────────────────
  //
  // Scales the ROOF SECTION. Two other placements were tried against the real documents
  // and both are wrong, which is worth recording so they are not tried again:
  //
  //   Charging a build-level percentage INTO the roof section wrecks the section. On
  //   Naka, whose document prices its flat roof at 953,440, +8% of the build produced a
  //   roof line of 6,566,686. We print this as a line-by-line BQ for contractors to lay
  //   beside a real quotation; one absurd line discards the document.
  //
  //   Scaling the WHOLE BUILD instead inflates lines that must not move — the plumbing
  //   fixture schedule reproduces three of the four documents to the franc, and a 10%
  //   uplift on the roof has no business touching it.
  //
  // The deciding evidence is the roof's share of a real build: 10.1% on Rose, 2.3% on
  // Naka, 2.2% on Mpangou. A covering premium of "+10%" cannot be a percentage of the
  // build — at Naka's share that would be four times the entire roof. Vanessa was
  // answering a table of roof coverings, so it is a percentage of the roof.
  //
  // The consequence is that a covering choice moves a TOTAL by well under its badge, so
  // the badge must not print the raw number. Step7RoofType asks the engine what the
  // choice actually costs this build. See roofCoveringDelta in roof.ts.
  const priced    = priceAt(city, ci);
  const roofScale = 1 + roofCoveringDelta(data.roofType);
  if (roofScale !== 1) {
    for (const l of priced) {
      if (l.section !== 'roof') continue;
      l.rate   *= roofScale;
      l.amount *= roofScale;
    }
  }

  const lines         = applyOverrides(priced, overrides);
  const sectionsLocal = sectionsFromLines(lines, SECTION_KEYS);

  return {
    lines,
    sectionsLocal,
    totalLocal: totalFromLines(lines),
    cityRate: city,
    model,
  };
}
