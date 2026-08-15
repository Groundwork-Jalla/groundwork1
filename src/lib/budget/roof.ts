import type { RoofType } from '@/types/project';
import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// Roof taxonomy — form first, then material.
//
// Vanessa's review: a builder decides pitched-or-flat before they decide what to cover it
// with, and the wizard asked both at once as a flat grid of four. This file holds the
// shape of that decision so the UI, the engine and the rate cards all read it from one
// place.
//
// It also settles a three-way disagreement that had been live for months:
//
//   model.ts   clay 1.10  concrete 1.08  shingle 1.05     (calibrated on real BQs)
//   legacy.ts  clay 1.05  concrete 1.03  shingle 1.04     (synthesised fallback)
//   the UI     clay +5%   concrete +3%   shingle +4%      (hardcoded badges)
//
// So a Cameroonian client picking clay tiles was shown "+5%" and charged "+10%".
// `COST_DELTA_PCT` below is now the only place these live; both rate cards and the badge
// derive from it, which is what stops them drifting apart again.
//
// The real-BQ figures win — legacy.ts is explicitly marked `estimated_index` and its own
// header says not to calibrate anything new against it.
// =========================================================

export type RoofForm = 'pitched' | 'flat';

export interface RoofOption {
  value: RoofType;
  form: RoofForm;
  labelKey: TKey;
  descKey: TKey;
  /** Cost uplift over long-span aluminium, in percent. 0 is the base case. */
  costDeltaPct: number;
  /**
   * True when we have no Bill of Quantity behind the uplift. Surfaced in the UI as a
   * softer badge — a contractor who spots one invented figure discards the whole
   * document, so a guess has to look like a guess.
   */
  provisional?: boolean;
}

export const ROOF_OPTIONS: readonly RoofOption[] = [
  {
    value: 'long_span_aluminum', form: 'pitched', costDeltaPct: 0,
    labelKey: 'wizard.roof.longSpan', descKey: 'wizard.roof.longSpanDesc',
  },
  {
    value: 'clay_tiles', form: 'pitched', costDeltaPct: 10,
    labelKey: 'wizard.roof.clayTiles', descKey: 'wizard.roof.clayTilesDesc',
  },
  {
    value: 'shingle', form: 'pitched', costDeltaPct: 5,
    labelKey: 'wizard.roof.shingle', descKey: 'wizard.roof.shingleDesc',
  },
  {
    value: 'concrete_flat', form: 'flat', costDeltaPct: 8,
    labelKey: 'wizard.roof.concreteFlat', descKey: 'wizard.roof.concreteFlatDesc',
  },
  {
    // Added Aug 2026. Priced at the long-span base because it is the same aluminium
    // sheet, decked rather than pitched — NOT because we measured it. No BQ covers this
    // build-up yet, so it ships provisional.
    value: 'aluminium_deck', form: 'flat', costDeltaPct: 0, provisional: true,
    labelKey: 'wizard.roof.aluminiumDeck', descKey: 'wizard.roof.aluminiumDeckDesc',
  },
];

export const ROOF_FORMS: readonly { form: RoofForm; labelKey: TKey; descKey: TKey }[] = [
  { form: 'pitched', labelKey: 'wizard.roof.formPitched', descKey: 'wizard.roof.formPitchedDesc' },
  { form: 'flat',    labelKey: 'wizard.roof.formFlat',    descKey: 'wizard.roof.formFlatDesc'    },
];

const BY_VALUE = new Map(ROOF_OPTIONS.map(o => [o.value, o]));

export function roofOption(type: RoofType | null | undefined): RoofOption | undefined {
  return type ? BY_VALUE.get(type) : undefined;
}

/**
 * Whether this roof is built as a deck rather than a pitch.
 *
 * The engine branches on this to decide between a slab-plus-partial-sheet build-up and a
 * pitched sheet area (engine.ts). It used to test `=== 'concrete_flat'` inline, which
 * silently gave the new aluminium deck a pitched roof's quantities.
 */
export function isFlatRoof(type: RoofType | null | undefined): boolean {
  return roofOption(type)?.form === 'flat';
}

export function roofsOfForm(form: RoofForm): readonly RoofOption[] {
  return ROOF_OPTIONS.filter(o => o.form === form);
}

/**
 * The multiplier map a `ConstructionRate` carries, built from `costDeltaPct`.
 *
 * Both model.ts and legacy.ts call this rather than typing the numbers out, so the two
 * rate cards cannot disagree with each other or with the badge in the wizard.
 */
export function roofMultipliers(): Record<string, number> {
  return Object.fromEntries(
    ROOF_OPTIONS.map(o => [o.value, 1 + o.costDeltaPct / 100]),
  );
}
