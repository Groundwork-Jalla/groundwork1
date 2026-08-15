import type {
  CityRate, ConstructionRate, TakeoffModel, WizardFormData,
} from '@/types/project';
import { CITY_RATES, CM_TAKEOFF, resolveCityRate } from './model';
import { countBedrooms, countLivingRooms, deriveQuantities, type DetailedTakeoffInput } from './geometry';
import { plumbingLines } from './fixtures';
import { isFlatRoof } from './roof';
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
    ?? CITY_RATES.DOUALA;

  const g = model.geometry;
  const r = model.rates;
  const q = deriveQuantities(data, g);

  if (q.footprint <= 0) return null;

  const A          = q.footprint;
  const floors     = q.floors;
  const upperCount = floors - 1;
  // Non-concrete trades (labour, blocks, tiles, paint) move with the city too. The
  // concrete grades are read from the book directly; everything else is indexed off it.
  const ci = city.index_vs_baseline;
  const finishMult = rate.finish_multipliers[data.finishLevel ?? 'standard'] ?? 1.0;

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
  add('203', A * g.lean_m3_per_m2,      city.lean_concrete);
  add('204', A * g.footing_m3_per_m2 * (1 + g.footing_floor_uplift * upperCount), city.rc_350);
  add('205', q.groundSlabVolume,        city.rc_250);
  add('206', q.perimeter * 0.6,         r.fdn_block_m2 * ci);
  add('207', A, r.dpm_m2 * ci);
  add('208', A, r.sand_bed_m2 * ci);

  // ── 300 / 400 Structure ──
  // An upper floor is priced exactly like the ground floor minus the ground-only items
  // (deck slab, soffit plaster, staircase). The multiplier goes on the QUANTITY, not on a
  // section subtotal — three floors of blockwork is three times the area at one rate.
  const bathsPerFloor = (data.bathrooms ?? 0) / floors;
  const ceilingRate   = r.ceiling_m2 * Math.max(0, finishMult - 1) / 0.7 * ci;

  add('301', A * g.col_m3_per_m2,  city.rc_350);
  add('302', A * g.beam_m3_per_m2, city.rc_350);
  add('305', q.wallPerFloor,       r.blockwork_m2 * ci);
  add('306', q.plasterPerFloor,    r.plaster_m2 * ci);
  add('309', A,                    r.floor_tiles_m2 * ci);
  add('310', bathsPerFloor * 12,   r.wall_tiles_m2 * ci);
  add('311', A,                    ceilingRate);
  // Ground-only
  add('303', q.slabVolume,                        city.rc_350);
  add('307', A,                                   r.deck_plaster_m2 * ci);
  add('308', floors > 1 ? g.stair_m3 : 0,         city.rc_350);

  if (upperCount > 0) {
    add('401', A * g.col_m3_per_m2  * upperCount, city.rc_350);
    add('402', A * g.beam_m3_per_m2 * upperCount, city.rc_350);
    add('405', q.wallPerFloor       * upperCount, r.blockwork_m2 * ci);
    add('406', q.plasterPerFloor    * upperCount, r.plaster_m2 * ci);
    add('409', A                    * upperCount, r.floor_tiles_m2 * ci);
    add('410', bathsPerFloor * 12   * upperCount, r.wall_tiles_m2 * ci);
    add('411', A                    * upperCount, ceilingRate);
  }

  // ── 500 Roof ──
  if (isFlatRoof(data.roofType)) {
    add('501', q.perimeter,                  r.parapet_ml * ci);
    add('503', A * g.flat_roof_sheet_frac,   r.roof_sheet_m2 * ci);
  } else {
    add('502', A * g.pitched_roof_factor,    r.roof_timber_m2 * ci);
    add('503', A * g.pitched_roof_factor,    r.roof_sheet_m2 * ci);
  }
  add('504', 1, r.roof_accessories * ci);

  // ── 600 Joinery ──
  add('601', q.rooms + 1,                                        r.door_avg * ci);
  add('605', countBedrooms(data) + countLivingRooms(data) + 1,   r.window * ci);
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
  // Contingency is a percentage of the works BEFORE finishing — the section it sits in.
  // Emitted last so `applyOverrides` evaluates it against final line amounts.
  L.push({
    code: '999', section: 'finishing', labelKey: BQ_ITEMS['999'].labelKey,
    unit: '%', kind: 'percentage', rateSource: 'estimated',
    qty: 0, rate: g.contingency_pct, amount: 0, pct: g.contingency_pct * 100,
    basis: CONTINGENCY_BASIS,
  });

  const lines         = applyOverrides(L, overrides);
  const sectionsLocal = sectionsFromLines(lines, SECTION_KEYS);

  return {
    lines,
    sectionsLocal,
    totalLocal: totalFromLines(lines),
    cityRate: city,
    model,
  };
}
