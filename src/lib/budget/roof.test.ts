import { describe, expect, it } from 'vitest';
import { ROOF_FORMS, ROOF_OPTIONS, isFlatRoof, roofMultipliers, roofOption, roofsOfForm } from './roof';
import { CM_RATE_FALLBACK } from './model';
import { buildLegacyRate } from './legacy';
import { runTakeoff } from './engine';
import { CAMEROON_BQS } from './__fixtures__/cameroon-bqs';

/**
 * Roof cost lived in three places that disagreed:
 *
 *   model.ts   clay 1.10  concrete 1.08  shingle 1.05
 *   legacy.ts  clay 1.05  concrete 1.03  shingle 1.04
 *   the wizard clay +5%   concrete +3%   shingle +4%
 *
 * A Cameroonian client picking clay tiles was shown "+5%" and charged "+10%". All three
 * now derive from ROOF_OPTIONS; these assertions are what keeps them derived.
 */

describe('roof taxonomy', () => {
  it('gives every option a form, and every form at least one option', () => {
    for (const opt of ROOF_OPTIONS) {
      expect(['pitched', 'flat']).toContain(opt.form);
    }
    for (const f of ROOF_FORMS) {
      expect(roofsOfForm(f.form).length).toBeGreaterThan(0);
    }
    // Every option is reachable from exactly one form, so the two-step wizard cannot
    // strand a roof type behind a fork it never appears under.
    expect(roofsOfForm('pitched').length + roofsOfForm('flat').length)
      .toBe(ROOF_OPTIONS.length);
  });

  it('has exactly one base-cost option', () => {
    expect(ROOF_OPTIONS.filter(o => o.costDeltaPct === 0 && !o.provisional)).toHaveLength(1);
    expect(roofOption('long_span_aluminum')!.costDeltaPct).toBe(0);
  });

  it('keeps both rate cards on the same multipliers', () => {
    // The whole point. buildLegacyRate synthesises a row for countries with no BQ;
    // CM_RATE_FALLBACK is the calibrated Cameroon row. Roof uplift must not depend on
    // which one you happened to load.
    const legacy = buildLegacyRate({ country: 'NG' }).roof_type_multipliers;
    expect(CM_RATE_FALLBACK.roof_type_multipliers).toEqual(roofMultipliers());
    expect(legacy).toEqual(roofMultipliers());
  });

  it('derives each multiplier from its stated percentage', () => {
    const mult = roofMultipliers();
    for (const opt of ROOF_OPTIONS) {
      // What the badge says and what the engine charges are the same number.
      expect(mult[opt.value]).toBeCloseTo(1 + opt.costDeltaPct / 100, 10);
    }
  });

  it('classifies flat roofs, including the new aluminium deck', () => {
    expect(isFlatRoof('concrete_flat')).toBe(true);
    expect(isFlatRoof('aluminium_deck')).toBe(true);
    expect(isFlatRoof('long_span_aluminum')).toBe(false);
    expect(isFlatRoof('clay_tiles')).toBe(false);
    expect(isFlatRoof('shingle')).toBe(false);
    expect(isFlatRoof(null)).toBe(false);
  });

  it('prices an aluminium deck as a flat roof, not a pitched one', () => {
    // The reason isFlatRoof exists. `=== 'concrete_flat'` inline would have given the new
    // value a pitched roof's sheet area — 1.30x the footprint instead of 0.30x plus slab.
    const base = { ...CAMEROON_BQS[0].input };
    const rate = CM_RATE_FALLBACK;

    const deck    = runTakeoff({ ...base, roofType: 'aluminium_deck' },     rate)!;
    const slab    = runTakeoff({ ...base, roofType: 'concrete_flat' },      rate)!;
    const pitched = runTakeoff({ ...base, roofType: 'long_span_aluminum' }, rate)!;

    expect(deck.sectionsLocal.roof).toBe(slab.sectionsLocal.roof);
    expect(deck.sectionsLocal.roof).not.toBe(pitched.sectionsLocal.roof);
  });
});
