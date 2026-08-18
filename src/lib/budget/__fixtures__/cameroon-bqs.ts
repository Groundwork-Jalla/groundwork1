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
 * roof       Rose is a pitched roof (252.60 m² of sheet). Buea is pitched too — 217.3 m²
 *            of sheet, not the 42.67 m² printed, which is a concrete section for roof
 *            drainage and the water tank (Q2). A PARAPET LINE DOES NOT MEAN A FLAT ROOF:
 *            "Most buildings in Cameroon carry a parapet line... camerounians use
 *            parapet walls to shield their roofs from access to wind." We had read the
 *            parapet as evidence of a slab, which was wrong.
 *
 * WHAT THE DOCUMENTS DO AND DO NOT PRICE — answered by Vanessa, 17 Aug 2026
 * -------------------------------------------------------------------------
 * Every variance we could not read a year ago now has an answer, and most of them are
 * not errors. They are scope. `notComparable` below records which sections of which
 * document cannot be held against an estimate of the whole building, and why — see
 * `comparableSections`. Naka, the one document that measured everything, lands at -1.4%.
 *
 * Buea     Internal partitions deliberately excluded (Q6): some walls are glass, and the
 *          drywall interior was to be built years later — "keep away what does not have
 *          to do with the present work. Only areas with water fixtures like bath and
 *          kitchen were considered." So plaster, paint and blockwork are not comparable.
 * Mpangou  Vanessa took the project over from a technician whose structure had failed,
 *          and priced only her own continuation (Q4): "My estimate for mpangou included
 *          wholly only what my work continues with... it was incomplete." That covers
 *          preliminaries and foundation. Painting covers one floor of four and should be
 *          x4 (Q7). Partitions excluded — an American open plan where only bath and
 *          stairs are walled (Q6). Mirrors omitted because the client was importing them
 *          from China (Q10). G+3+tt: four levels above ground, the top being a concrete
 *          roof terrace tiled and furnished like a floor (Q3).
 * Rose     Roof timber of 806.20 m³ is REAL, not a unit error (Q1): a 45 degree hip roof
 *          where the others are at 10 degrees, covered in stone-coated sheet ("the abuja
 *          roofing sheet"), not plain aluminium. Vanessa: "use rose roof to determine the
 *          price for those who will desire the abuja style roof." We do not carry that
 *          covering yet, so our roof reads 58% under hers.
 */

export interface BqFixture {
  name: string;
  file: string;
  /** How completely the document was measured. Drives the assertion tolerance. */
  quality: 'reliable' | 'partial';
  input: Partial<WizardFormData>;
  /**
   * Sections this document does not price on the same basis as a whole-building
   * estimate, with the reason. Excluded from the accuracy assertions rather than
   * silently widening the tolerance for everyone — a document that leaves out internal
   * walls is not evidence that our walls are wrong.
   */
  notComparable?: Partial<Record<keyof BqFixture['actual'], string>>;
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
      // Stone-coated, not plain aluminium (Q1). This is the building Vanessa described:
      // a 45 degree hip roof in "abuja" sheet. Note the circularity — `stone_coated`'s
      // +138% was derived from this document's roof section, so the roof line here is
      // reproduced by construction and is a regression lock, not evidence.
      finishLevel: 'premium', roofType: 'stone_coated', buildingType: 'single_family',
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
      // Pitched, not flat. We had inferred a slab from the parapet line; Q2 says the
      // 42.67 m² is a concrete section for drainage and the water tank, the sheet is
      // 217.3 m², and parapets are standard on Cameroonian pitched roofs as a windbreak.
      finishLevel: 'standard', roofType: 'long_span_aluminum', buildingType: 'single_family',
      bedrooms: 3, bathrooms: 3, kitchens: 1, livingRooms: 2, floorRooms: [],
    },
    notComparable: {
      ground_floor: 'Q6: internal partitions excluded — glass walls and drywall deferred.',
      upper_floor:  'Q6: same.',
      finishing:    'Q6: plaster and paint follow the partitions that were left out.',
      roof:         'Q2: the document prints 42.67 m² of sheet where the real figure is 217.3 m², and Vanessa confirmed the error. Its roof money follows the wrong quantity, so there is nothing to compare against.',
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
      // G+3+tt (Q3): ground, 1st, 2nd, 3rd, and a concrete roof terrace "treated as a
      // floor because it has tiles and furnitures with luxurious lighting". That is why
      // the elevation section totals exactly 4x one floor while reading "first till 3rd"
      // — the tt is the fourth level in it.
      //
      // Still FOUR here, not five. The terrace is finishes on a slab: tiles, lighting,
      // furniture. It has no walls, windows or doors, and `floors` in our model means a
      // walled storey — pricing it as one adds blockwork and joinery that do not exist.
      // The consequence is that upper_floor is not comparable: their four levels against
      // our three.
      country: 'CM', city: 'Kribi', sqm: 144, floors: 4,
      finishLevel: 'luxury', roofType: 'concrete_flat', buildingType: 'multi_family',
      bedrooms: 8, bathrooms: 3, kitchens: 5, livingRooms: 4, floorRooms: [],
    },
    notComparable: {
      preliminary:  'Q4: Vanessa took the project over mid-build and priced only her own continuation.',
      foundation:   'Q4: "it was incomplete" — the existing structure was surveyed, not re-priced.',
      finishing:    'Q7: paints one floor of four, and Q6: no internal partitions to plaster.',
      ground_floor: 'Q6: American open plan — only bath and stairs are walled.',
      upper_floor:  'Q6: same; and Q3: their section spans four levels including the roof terrace, ours three walled storeys.',
      plumbing:     'Q10: mirrors omitted because the client was importing them from China.',
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
