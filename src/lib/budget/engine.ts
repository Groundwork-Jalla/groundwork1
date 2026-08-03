import type {
  CityRate, ConstructionRate, TakeoffModel, WizardFormData,
} from '@/types/project';
import { CITY_RATES, CM_TAKEOFF, resolveCityRate } from './model';
import { countBedrooms, countLivingRooms, deriveQuantities } from './geometry';
import { plumbingCost } from './fixtures';

/** The nine sections a Cameroonian BQ is written in, in BQ order. */
export const SECTION_KEYS = [
  'preliminary', 'foundation', 'ground_floor', 'upper_floor', 'roof',
  'joinery', 'electrical', 'plumbing', 'finishing',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionAmounts = Record<SectionKey, number>;

export interface TakeoffResult {
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
  data: Partial<WizardFormData>,
  rate: ConstructionRate,
  cityRate?: CityRate | null,
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

  // ── 100 Preliminary ──
  const preliminary = (250_000 + A * 1_600) * ci;

  // ── 200 Foundation ──
  const foundation =
      A * g.exc_m3_per_m2 * r.excavation_m3 * ci
    + A * g.exc_m3_per_m2 * 0.8 * r.backfill_m3 * ci
    + A * g.lean_m3_per_m2 * city.lean_concrete
    + A * g.footing_m3_per_m2 * (1 + g.footing_floor_uplift * upperCount) * city.rc_350
    + q.groundSlabVolume * city.rc_250
    + q.perimeter * 0.6 * r.fdn_block_m2 * ci
    + A * (r.dpm_m2 + r.sand_bed_m2) * ci;

  // ── 300 / 400 Structure. One function, so an upper floor is priced exactly like the
  // ground floor minus the ground-only items (deck slab, soffit plaster, staircase). ──
  const bathsPerFloor = (data.bathrooms ?? 0) / floors;
  const floorShell = (isGround: boolean): number => {
    let v =
        A * g.col_m3_per_m2 * city.rc_350
      + A * g.beam_m3_per_m2 * city.rc_350
      + q.wallPerFloor * r.blockwork_m2 * ci
      + q.plasterPerFloor * r.plaster_m2 * ci
      + A * r.floor_tiles_m2 * ci
      + bathsPerFloor * 12 * r.wall_tiles_m2 * ci               // splashbacks
      + A * r.ceiling_m2 * Math.max(0, finishMult - 1) / 0.7 * ci; // ceilings above standard only
    if (isGround) {
      v += q.slabVolume * city.rc_350
         + A * r.deck_plaster_m2 * ci
         + (floors > 1 ? g.stair_m3 * city.rc_350 : 0);
    }
    return v;
  };
  const ground_floor = floorShell(true);
  const upper_floor  = floorShell(false) * upperCount;

  // ── 500 Roof ──
  const roof = data.roofType === 'concrete_flat'
    ? (q.perimeter * r.parapet_ml
        + A * g.flat_roof_sheet_frac * r.roof_sheet_m2
        + r.roof_accessories) * ci
    : (A * g.pitched_roof_factor * (r.roof_sheet_m2 + r.roof_timber_m2)
        + r.roof_accessories) * ci;

  // ── 600 Joinery ──
  const doors   = q.rooms + 1;                                   // one per room + entrance
  const windows = countBedrooms(data) + countLivingRooms(data) + 1;
  const joinery = (doors * r.door_avg
                 + windows * r.window
                 + upperCount * g.railing_ml_per_floor * r.railing_ml) * ci;

  // ── 700 Electrical ──
  const electrical = floors * (model.electrical.per_floor
                             + q.roomsPerFloor * model.electrical.per_room) * ci;

  // ── 800 Plumbing ──
  const plumbing = plumbingCost(data, rate.fixture_prices) * ci;

  // ── 900 Finishing — painting, decoration, contingency ──
  const works = preliminary + foundation + ground_floor + upper_floor
              + roof + joinery + electrical + plumbing;
  const finishing = q.plasterPerFloor * floors * r.paint_m2 * ci
                  + 500_000 * finishMult
                  + works * g.contingency_pct;

  const sectionsLocal: SectionAmounts = {
    preliminary, foundation, ground_floor, upper_floor,
    roof, joinery, electrical, plumbing, finishing,
  };

  return {
    sectionsLocal,
    totalLocal: Object.values(sectionsLocal).reduce((s, v) => s + v, 0),
    cityRate: city,
    model,
  };
}
