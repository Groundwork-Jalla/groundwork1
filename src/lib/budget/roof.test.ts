import { describe, expect, it } from 'vitest';
import { ROOF_FORMS, ROOF_OPTIONS, isFlatRoof, roofMultipliers, roofOption, roofsOfForm } from './roof';
import { CM_RATE_FALLBACK } from './model';
import { buildLegacyRate } from './legacy';
import { runTakeoff } from './engine';
import { calculateBudget } from './index';
import type { RoofType } from '@/types/project';
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
    // Retired options are excluded on purpose: they stay resolvable for projects already
    // saved with them, but must not appear under either fork.
    expect(roofsOfForm('pitched').length + roofsOfForm('flat').length)
      .toBe(ROOF_OPTIONS.filter(o => !o.retired).length);
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

    // Same QUANTITIES as the concrete slab — that is what isFlatRoof decides. The
    // amounts now differ because the slab carries an 8% covering uplift and the deck
    // carries none; before the covering was priced at all, these two were identical,
    // and that equality is what this test used to assert.
    const qtys = (t: typeof deck) =>
      t.lines.filter(l => l.section === 'roof').map(l => [l.code, l.qty]);
    expect(qtys(deck)).toEqual(qtys(slab));
    expect(qtys(deck)).not.toEqual(qtys(pitched));

    // And a flat roof is still cheaper than a pitched one here, because it buys no
    // timber and 30% of the sheet. Worth stating: it is NOT evidence the slab is priced.
    // It is not — see the note on suspended slabs in engine.ts.
    expect(deck.sectionsLocal.roof).toBeLessThan(pitched.sectionsLocal.roof);
  });
});

// ── Regression: the covering must actually change the price ──
//
// Found by Vanessa in testing, 17 Aug 2026: "the prices still did not change when i
// switched between roof types". For Cameroon — the only country with a take-off model,
// and the only corridor we sell in — that was exactly true. runTakeoff read `isFlatRoof`
// and nothing else, so `roof_type_multipliers` was dead code on every real project.
describe('covering affects the Cameroon take-off', () => {
  const base = {
    country: 'CM', sqm: 120, floors: 2, finishLevel: 'standard' as const,
    bedrooms: 4, bathrooms: 3, buildingType: 'single_family' as const,
    livingRooms: 1, kitchens: 1, offices: 0, hasBoysQuarters: false,
  };
  const cost = (roofType: RoofType) => calculateBudget({ ...base, roofType }).construction;

  it('prices every pitched covering differently', () => {
    const seen = new Set(
      (['long_span_aluminum', 'clay_tiles', 'shingle'] as RoofType[]).map(cost),
    );
    expect(seen.size).toBe(3);
  });

  it('orders them by costDeltaPct', () => {
    expect(cost('clay_tiles')).toBeGreaterThan(cost('shingle'));
    expect(cost('shingle')).toBeGreaterThan(cost('long_span_aluminum'));
  });

  it('leaves the rest of the build alone', () => {
    // The uplift is on the roof section, not the total — so a 10% dearer covering must
    // move the build by well under 10%. If this ever fails, someone has reattached it to
    // the whole total the way legacy.ts does.
    const delta = cost('clay_tiles') / cost('long_span_aluminum') - 1;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(0.03);
  });

  it('keeps a retired covering priceable', () => {
    // aluminium_deck is out of the picker but still a persisted enum value.
    expect(cost('aluminium_deck')).toBeGreaterThan(0);
    expect(roofsOfForm('flat').some(o => o.value === 'aluminium_deck')).toBe(false);
  });
});
