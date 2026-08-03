import type { WizardFormData } from '@/types/project';

/**
 * The four real Cameroonian bills of quantities the engine is calibrated against.
 * Source workbooks live in docs/.
 *
 * HOW THE INPUTS WERE DERIVED
 * ---------------------------
 * footprint  Reinforced concrete slab volume ÷ 0.12 (BQ item 304), cross-checked against
 *            "plastering for slab" (307) and "floor tiles" (309). Mpangou's take-off
 *            states it outright: L 12, W 12, perimeter 48, A 144.
 * rooms      Inferred from the fixture and joinery schedules — toilet seats and sinks
 *            (803/805) give bathrooms, kitchen sinks (808) give kitchens, door counts
 *            (601-604) bound the room total. These are inferences, not stated figures.
 * finish     Buea and Naka have no ceiling staffing, no bath, minimal wall tiling.
 *            Rose has staffing on both floors, 2 baths, 5 mirrors and 1.5M of decoration.
 *            Mpangou has 5 baths and 5 kitchen sinks across 4 levels.
 * roof       Rose is a pitched aluminium roof (252.60 m² of sheet). The other three are
 *            parapet/flat — Buea 42.67 m², Naka 48 m², Mpangou 96 m² of sheet plus a
 *            parapet line item.
 *
 * KNOWN DEFECTS IN THE SOURCE DOCUMENTS — do not calibrate these away
 * ------------------------------------------------------------------
 * Buea     Plastering of 388.80 m²/floor is external faces only (perimeter 59.9 m ×
 *          3 m × 2 = 360 m²). Internal partitions are not measured. Its roof lists
 *          42.67 m² of sheet on a 224 m² footprint.
 * Mpangou  Footings 0.69 m³ against Naka's 11.66 m³ for the same footprint and twice the
 *          height. Preliminary 170,000 for a G+3 against Buea's 650,000 for a G+1.
 *          Paints 259.20 m², one floor of four. Its upper-floor section is one floor's
 *          quantities × 4 while labelled "first till 3rd".
 * Rose     Roof timber 806.20 m³ + 520 m³ on a 125 m² house — roughly 500 tonnes.
 *          Almost certainly linear metres recorded as m³.
 */

export interface BqFixture {
  name: string;
  file: string;
  /** How completely the document was measured. Drives the assertion tolerance. */
  quality: 'reliable' | 'partial';
  input: Partial<WizardFormData>;
  /** Section totals in XAF, straight from the SUMMARY block. */
  actual: {
    preliminary: number;
    foundation: number;
    ground_floor: number;
    upper_floor: number;
    roof: number;
    joinery: number;
    electrical: number;
    plumbing: number;
    finishing: number;
  };
  actualTotal: number;
}

export const CAMEROON_BQS: BqFixture[] = [
  {
    name: 'Rose Ndum Kenah — Yaoundé G+1',
    file: 'CONSTRUCTION ESTIMATE OF G+1 BUILDING .xlsx',
    quality: 'reliable',
    input: {
      country: 'CM', city: 'Yaoundé', sqm: 125, floors: 2,
      finishLevel: 'premium', roofType: 'long_span_aluminum', buildingType: 'single_family',
      bedrooms: 4, bathrooms: 5, kitchens: 1, livingRooms: 2, floorRooms: [],
    },
    actual: {
      preliminary:    550_000,
      foundation:   4_619_200,
      ground_floor:14_119_650,
      upper_floor: 11_674_380,
      roof:         6_006_200,
      joinery:      4_187_130,
      electrical:   2_326_600,
      plumbing:     6_450_000,
      finishing:    9_742_120,
    },
    actualTotal: 59_675_280,
  },
  {
    name: 'Buea Residence — Buea G+1',
    file: 'BUEA RESIDENCE ESTIMATE.xlsx',
    quality: 'partial',
    input: {
      country: 'CM', city: 'Buea', sqm: 224, floors: 2,
      finishLevel: 'standard', roofType: 'concrete_flat', buildingType: 'single_family',
      bedrooms: 3, bathrooms: 3, kitchens: 1, livingRooms: 2, floorRooms: [],
    },
    actual: {
      preliminary:    650_000,
      foundation:   5_808_947,
      ground_floor:17_875_066,
      upper_floor:  7_850_042,
      roof:         1_235_280,
      joinery:      1_635_500,
      electrical:   2_326_600,
      plumbing:     2_255_000,
      finishing:    3_774_520,
    },
    actualTotal: 43_410_955,
  },
  {
    name: 'Naka School — Bali G+1',
    file: 'NI PAS CONSTRUCTION ESTIMATE OF G+1 SCHOOL.xlsx',
    quality: 'reliable',
    input: {
      country: 'CM', city: 'Bali', sqm: 144, floors: 2,
      finishLevel: 'standard', roofType: 'concrete_flat', buildingType: 'single_family',
      bedrooms: 0, bathrooms: 3, kitchens: 0, livingRooms: 6, floorRooms: [],
    },
    actual: {
      preliminary:    830_000,
      foundation:   5_475_789,
      ground_floor:14_414_531,
      upper_floor:  8_537_787,
      roof:           953_440,
      joinery:      1_546_680,
      electrical:   2_326_600,
      plumbing:     2_255_000,
      finishing:    5_874_040,
    },
    actualTotal: 42_213_867,
  },
  {
    name: 'Mpangou — Kribi G+3',
    file: 'MPANGOU.xlsx',
    quality: 'partial',
    input: {
      country: 'CM', city: 'Kribi', sqm: 144, floors: 4,
      finishLevel: 'luxury', roofType: 'concrete_flat', buildingType: 'multi_family',
      bedrooms: 8, bathrooms: 3, kitchens: 5, livingRooms: 4, floorRooms: [],
    },
    actual: {
      preliminary:    170_000,
      foundation:   2_046_693,
      ground_floor:10_299_572,
      upper_floor: 24_514_368,
      roof:         1_397_680,
      joinery:      6_133_000,
      electrical:   5_677_600,
      plumbing:    10_955_000,
      finishing:    3_074_680,
    },
    actualTotal: 64_268_593,
  },
];

/**
 * Plumbing fixture schedules read directly off BQ items 801-810. Used to assert the
 * fixture formula reproduces each document to the franc.
 */
export const PLUMBING_CHECKS = [
  { name: 'Buea',    wc: 3, mirror: 0, sink: 3, tub: 0, shower: 0, kitchenSink: 0, total:  2_255_000 },
  { name: 'Rose',    wc: 5, mirror: 5, sink: 5, tub: 2, shower: 5, kitchenSink: 1, total:  6_450_000 },
  { name: 'Mpangou', wc: 3, mirror: 0, sink: 3, tub: 5, shower: 8, kitchenSink: 5, total: 10_955_000 },
  { name: 'Naka',    wc: 3, mirror: 0, sink: 3, tub: 0, shower: 0, kitchenSink: 0, total:  2_255_000 },
];
