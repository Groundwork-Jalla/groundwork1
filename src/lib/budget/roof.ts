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
  /**
   * Withdrawn from the picker but still resolvable, so projects already saved with this
   * covering keep pricing. Never delete a member of a persisted enum.
   */
  retired?: boolean;
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
    // The "Abuja sheet" — aluminium coated in tar and stone granules. Added Aug 2026 on
    // Vanessa's Q1 answer, which is also where the number comes from: the Rose document
    // was read as an outlier (806 m³ of roof timber on a 125 m² house) when it is a real
    // build — a 45 degree hip roof in stone-coated sheet, where her other three sit at
    // 10 degrees in plain aluminium. Her instruction: "use rose roof to determine the
    // price for those who will desire the abuja style roof."
    //
    // 138% is Rose's roof section over what our long-span model prices for the same
    // house: 6,006,200 / 2,525,000. HONEST CAVEAT, and it is on the list to put back to
    // her: that figure bundles the covering with the 45 degree pitch, because the wizard
    // has no pitch input to separate them. Someone wanting stone-coated sheet at a
    // conventional 25-30 degrees is over-quoted by whatever share of the premium is
    // pitch rather than material.
    value: 'stone_coated', form: 'pitched', costDeltaPct: 138,
    labelKey: 'wizard.roof.stoneCoated', descKey: 'wizard.roof.stoneCoatedDesc',
  },
  {
    value: 'concrete_flat', form: 'flat', costDeltaPct: 8,
    labelKey: 'wizard.roof.concreteFlat', descKey: 'wizard.roof.concreteFlatDesc',
  },
  {
    // Added Aug 2026, withdrawn Aug 2026. We invented it: no BQ covered it, and when
    // asked directly Vanessa answered "I really don't understand what you mean by
    // aluminium deck" (Q12). A covering no Cameroonian quantity surveyor recognises has
    // no business in a picker. Kept resolvable for any project saved with it.
    value: 'aluminium_deck', form: 'flat', costDeltaPct: 0, provisional: true,
    retired: true,
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
  return ROOF_OPTIONS.filter(o => o.form === form && !o.retired);
}

/**
 * Cost multiplier for the ROOF SECTION — items 501-504 — not for the whole build.
 *
 * This is the correction to a bug Vanessa found while testing: "the prices still did not
 * change when i switched between roof types". They did not, for Cameroon, because the
 * take-off engine never read `roof_type_multipliers` at all — only `isFlatRoof`. Every
 * pitched covering priced identically, and a flat roof came out 5% CHEAPER than
 * long-span when it is meant to be 8% dearer.
 *
 * Applied to the roof section rather than the whole total, which is where legacy.ts puts
 * it. Legacy is a single blanket multiplier over a fitted rate and its own header says
 * not to calibrate against it; choosing clay over aluminium does not make your foundation
 * more expensive. The badge in the wizard says "on the roof" for the same reason.
 */
export function roofCostMultiplier(type: RoofType | null | undefined): number {
  return 1 + (roofOption(type)?.costDeltaPct ?? 0) / 100;
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
