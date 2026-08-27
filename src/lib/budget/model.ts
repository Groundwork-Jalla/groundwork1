import type { CityRate, ConstructionRate, FixturePrices, TakeoffModel } from '@/types/project';
import { roofMultipliers } from './roof';

/**
 * Default quantity take-off model for Cameroon.
 *
 * Calibrated against four real bills of quantities (docs/*.xlsx):
 *   Rose Ndum Kenah, Yaoundé  G+1  125 m²  59,675,280 XAF
 *   Buea Residence,  Buea     G+1  224 m²  43,410,955 XAF
 *   Naka school,     Naka     G+1  144 m²  42,213,867 XAF
 *   Mpangou,         Kribi    G+3  144 m²  64,268,593 XAF
 *
 * Unit rates below are prices QUOTED in those documents, not values fitted to make the
 * totals line up. Geometry coefficients come from engineering practice, except
 * `footing_m3_per_m2` and `paint_m2`, which are measured directly from the two
 * internally consistent documents (Rose and Naka — the two that measured internal
 * partitions and painted the whole building).
 *
 * This mirrors migration 020_bq_calibration.sql. The DB copy wins when present; this one
 * keeps the wizard working offline and on a cold start.
 */
export const CM_TAKEOFF: TakeoffModel = {
  version: '2026.08-cm-4bq',
  geometry: {
    storey_height_m:         3.0,
    slab_thickness_m:        0.12,  // slab m³ ÷ 0.12 recovers the footprint in all four BQs
    ground_slab_thickness_m: 0.07,
    partition_m_per_room:    14.0,  // Rose measured 15.5 m/room, Naka 18
    perimeter_factor:        4.0,   // square-ish plan; Mpangou states L12 W12 perimeter 48
    exc_m3_per_m2:           0.55,
    lean_m3_per_m2:          0.011,
    footing_m3_per_m2:       0.115, // measured: Rose 0.105, Naka 0.143
    footing_floor_uplift:    0.18,  // taller buildings need bigger pads
    col_m3_per_m2:           0.024,
    beam_m3_per_m2:          0.045,
    stair_m3:                2.5,
    flat_roof_sheet_frac:    0.30,
    pitched_roof_factor:     1.30,  // 30° pitch + 600 mm overhang
    railing_ml_per_floor:    12.0,
    contingency_pct:         0.05,
  },
  rates: {
    excavation_m3:      1_500,
    backfill_m3:          800,
    dpm_m2:             1_000,
    sand_bed_m2:        1_000,
    fdn_block_m2:       4_000,
    blockwork_m2:       7_800,   // BQ 305, Rose — the only file measuring wall in m²
    plaster_m2:         2_600,   // BQ 306, Rose 2,500 ground / 2,700 first
    deck_plaster_m2:    3_000,   // BQ 307
    floor_tiles_m2:    10_900,   // BQ 309, identical in all four files
    wall_tiles_m2:      9_000,   // BQ 310
    ceiling_m2:        13_000,   // BQ 311 staffing, 14,000 ground / 12,500 first
    paint_m2:           2_790,   // BQ 901-906: Rose 2,767, Naka 2,813 — agree to 1.7%
    roof_sheet_m2:      7_500,   // BQ 503, identical in all four files
    roof_timber_m2:     6_500,
    roof_accessories: 250_000,   // BQ 504, identical in all four files
    parapet_ml:         4_500,
    door_avg:         110_000,   // BQ 601-604: 75k / 100k / 220k / 85k
    window:            55_000,   // BQ 605
    railing_ml:        24_700,   // BQ 606-607, identical in all four files
  },
  // Rose, Buea and Naka are byte-identical at 2,326,600 despite having 12, 9 and 9 rooms,
  // so in this data electrical tracks floors, not rooms. Mpangou (4 floors) is 5,677,600.
  // The per-room term is small and deliberate, so a 10-bedroom house still prices above
  // a 2-bedroom one.
  electrical: { per_floor: 700_000, per_room: 90_000 },
};

/** BQ 801-810. Reproduces the plumbing total of all four documents exactly. */
export const DEFAULT_FIXTURE_PRICES: FixturePrices = {
  supply:       250_000,
  drainage:     300_000,
  septic:     1_000_000,
  accessories:  300_000,
  wc:           120_000,
  mirror:       120_000,
  sink:          15_000,
  tub:        1_500_000,
  shower:        25_000,
  kitchen_sink: 200_000,
};

/**
 * Canonical Cameroon rate row, mirroring what migration 020 seeds.
 *
 * This is the single source of truth for offline and no-rate-passed paths. Several call
 * sites (project detail, the costing tab, the PDF export) price synchronously without
 * fetching, and they must not fall through to a row whose finish multipliers are all 1.0
 * — that would silently flatten standard, premium and luxury into the same number.
 */
export const CM_RATE_FALLBACK: ConstructionRate = {
  country_code: 'CM',
  base_rate_usd: 640,                 // legacy only; the take-off does not use it
  upper_floor_addition_pct: 23.0,     // mean across all four BQs (20.6 / 22.1 / 24.3 / 25.4)
  sections: {
    preliminary: 1.1, foundation: 9.6, ground_floor: 29.4, roof: 12.5,
    joinery: 8.7, electrical: 4.8, plumbing: 13.4, finishing: 20.5,
  },
  finish_multipliers: { standard: 1.0, premium: 1.45, luxury: 1.70 },
  building_type_multipliers: {
    single_family: 1.0, bungalow: 1.0, townhouse: 1.05, semi_detached: 1.03,
    duplex: 1.05, multi_family: 1.15, apartment: 1.15, office: 1.25,
    retail: 1.20, warehouse_commercial: 0.75, hotel: 1.45, guest_house: 1.25,
    villa: 1.15, commercial: 1.20, mixed_residential_commercial: 1.22,
    live_work: 1.12, mixed_retail_residential: 1.18, transit_oriented: 1.30,
    factory: 0.85, warehouse_industrial: 0.75, industrial_complex: 0.90,
    distribution_centre: 0.78,
  },
  roof_type_multipliers: roofMultipliers(),
  currency_code: 'XAF',
  approx_fx_rate: 600,
  data_source: 'real_bq',
  notes: 'CM quantity take-off calibrated on 4 real BQs, Aug 2026',
  takeoff: CM_TAKEOFF,
  fixture_prices: DEFAULT_FIXTURE_PRICES,
};

/**
 * City rate book, verbatim from the `unit cost calculation` sheet shared by three of the
 * four workbooks. Mirrors the seed in migration 020; used when the DB is unreachable.
 */
export const CITY_RATES: Record<string, CityRate> = {
  // Baseline moved from Douala to Yaoundé in 045, on Vanessa's 17 Aug list. The two had
  // sat tied at 1.0000, which is why the Douala-vs-Yaoundé question stayed open so long.
  //
  // TWO KINDS OF NUMBER, and only one of them is data.
  //
  // The concrete columns and `cost_delta_pct` are measured: the rates come from the
  // source workbooks (each document's concrete rate matches its own city's column) and
  // the percentage is Vanessa's statement of what a build costs in that city.
  //
  // `index_vs_baseline` is NOT data and is not read by the engine any more. It used to
  // hold a value solved offline on one reference building, which meant every other shape
  // drifted off the stated percentage by up to 2.3 points. runTakeoff now solves it per
  // build from `cost_delta_pct`, so every city lands exactly on its figure for every
  // building. The column is kept only because the DB row has it and older cached books
  // carry it; treat it as vestigial.
  YAOUNDE: cm('YAOUNDE', 'Yaoundé', 180_000,  67_250, 48_500,  69_750,   0),
  DOUALA:  cm('DOUALA',  'Douala',  180_000,  70_750, 52_000,  67_250,  -5),
  BUEA:    cm('BUEA',    'Buea',    190_000,  72_875, 52_250,  72_625,   0),
  LIMBE:   cm('LIMBE',   'Limbe',   190_000,  71_250, 51_000,  70_750,  -3),
  // Renamed from BALI. Same physical rate set — Vanessa's point was that the city on the
  // list should be Bamenda, not that Bali's numbers were wrong. Legacy 'Bali' still
  // resolves here via CITY_ALIASES below.
  BAMENDA: cm('BAMENDA', 'Bamenda', 190_000,  71_000, 48_500,  72_875,  10),
  KRIBI:   cm('KRIBI',   'Kribi',   179_000,  72_625, 54_250,  66_875,   5),
  // Adamawa and Garoua carry the only unverified concrete columns in the book —
  // Vanessa's verification table covers Yaoundé, Buea, Bamenda and Kribi only. Their
  // solved indices land below 1.0, i.e. northern trades cheaper than Yaoundé offsetting
  // concrete 44% dearer. The total is hers; that split is ours.
  ADAMAWA: cm('ADAMAWA', 'Adamawa', 260_000,  86_125, 61_750,  88_375,   7),
  // New in 045. On Vanessa's list, absent from our book. Concrete copied from Adamawa.
  GAROUA:  cm('GAROUA',  'Garoua',  260_000,  86_125, 61_750,  88_375,  10),
  // `estimated_index`, not `real_bq`. There is no Nigerian Bill of Quantity — asking for
  // one is still an open item in docs/BQ-QUESTIONS.md, and we hold three unreconciled
  // Nigerian base rates (672, 1,600 and 180 USD/m²). Mislabelled as verified until
  // 25 Aug 2026, which put a "Verified data" shield on step 9 over a number nobody can
  // defend. The rates below stay as they are; only the claim about them changes.
  ABUJA:   { city_code: 'ABUJA', country_code: 'NG', city_name: 'Abuja',
             rc_350: 450_000, rc_250: 119_000, lean_concrete: 77_750, mortar: 135_750,
             index_vs_baseline: 2.5000, currency_code: 'NGN', data_source: 'estimated_index' },
};

function cm(
  code: string, name: string,
  rc350: number, rc250: number, lean: number, mortar: number,
  deltaPct: number,
): CityRate {
  return {
    city_code: code, country_code: 'CM', city_name: name,
    rc_350: rc350, rc_250: rc250, lean_concrete: lean, mortar,
    // Vestigial — see the note above the table. The engine solves its own.
    index_vs_baseline: 1, cost_delta_pct: deltaPct,
    currency_code: 'XAF',
    // Adamawa and Garoua concrete is a northern estimate; the rest is measured.
    data_source: code === 'ADAMAWA' || code === 'GAROUA' ? 'estimated_index' : 'real_bq',
  };
}

/** Cities we hold real rates for, in the order the wizard should offer them. */
export const CM_CITY_CODES = [
  'YAOUNDE', 'DOUALA', 'BUEA', 'LIMBE', 'BAMENDA', 'KRIBI', 'GAROUA', 'ADAMAWA',
] as const;

/**
 * Cities that have been renamed, old name → current code.
 *
 * `city` is stored as free text on every project (see resolveCityRate), so a rename that
 * only touched the rate book would stop matching those rows — they would fall through to
 * the Douala baseline and quietly re-price by −5.3%. A budget that moves because we
 * relabelled a dropdown is exactly the kind of silent number change migration 020 refuses
 * to make.
 */
const CITY_ALIASES: Record<string, string> = {
  BALI: 'BAMENDA',
};

/**
 * The city an unrecognised Cameroonian city falls back to, and the city every
 * `cost_delta_pct` is measured against.
 *
 * Moved from Douala in 045. It has to move with the baseline: Douala is now solved at
 * 0.9282, so leaving the fallback there would have quietly priced every project with an
 * unmatched city 7% below where it had been the day before.
 */
export const BASELINE_CITY = 'YAOUNDE';

/**
 * Resolve a free-text city to a rate row. Existing projects store city as free text, and
 * the wizard still allows it outside Cameroon, so this has to degrade gracefully:
 * exact code → name match → country baseline → null.
 */
export function resolveCityRate(
  city: string | null | undefined,
  countryCode: string,
  book: Record<string, CityRate> = CITY_RATES,
): CityRate | null {
  if (city) {
    const key = city.trim().toUpperCase();
    if (book[key]) return book[key];
    if (CITY_ALIASES[key] && book[CITY_ALIASES[key]]) return book[CITY_ALIASES[key]];

    // "Buea, Cameroon" / "Yaoundé" / "yaounde"
    const norm = stripAccents(key);
    const hit = Object.values(book).find(
      r => r.country_code === countryCode && stripAccents(r.city_name.toUpperCase()) === norm,
    ) ?? Object.values(book).find(
      r => r.country_code === countryCode && norm.startsWith(stripAccents(r.city_name.toUpperCase())),
    );
    if (hit) return hit;

    // "Bali, Cameroon" — an old name carrying a country suffix, which neither the exact
    // alias lookup nor the current-name prefix match above can catch.
    for (const [old, code] of Object.entries(CITY_ALIASES)) {
      if (norm.startsWith(old) && book[code]) return book[code];
    }
  }
  if (countryCode === 'CM') return book[BASELINE_CITY] ?? null;
  return null;
}

function stripAccents(s: string): string {
  // U+0300-U+036F is the combining diacritical marks block, so "Yaoundé" matches "yaounde".
  // Written as escapes rather than literal marks so re-encoding the file can't break it.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Does this country have a real Bill of Quantity behind its rates?
 *
 * Cameroon does — four documents from Vanessa Gwanvoma, and the take-off model is
 * calibrated line by line against them. Everywhere else is a regional index derived from
 * country-level cost data, which is a guess with a method rather than a measurement.
 *
 * Read off `data_source` rather than a hand-kept country list, so a country cannot be
 * called verified in one place and estimated in another — which is exactly what happened
 * to Nigeria, whose ABUJA row claimed `real_bq` while docs/BQ-QUESTIONS.md was still
 * asking for a Nigerian BQ.
 */
export function hasLocalBq(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  const code = countryCode.toUpperCase();
  return Object.values(CITY_RATES).some(
    c => c.country_code === code && c.data_source === 'real_bq',
  );
}
