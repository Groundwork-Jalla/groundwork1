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
    // amounts differ because the slab carries an 8% build uplift and the retired deck
    // carries none.
    const qtys = (t: typeof deck) =>
      t.lines.filter(l => l.section === 'roof').map(l => [l.code, l.qty]);
    expect(qtys(deck)).toEqual(qtys(slab));
    expect(qtys(deck)).not.toEqual(qtys(pitched));

    // The deck, at a 0% uplift, is cheaper than pitched because it buys no timber and
    // 30% of the sheet. NOT evidence the concrete deck itself is priced — it is not; see
    // the note on suspended slabs.
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
  const BASE_INPUT = base;

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

  it('moves the ROOF SECTION by exactly the stated percentage', () => {
    // costDeltaPct is a percentage of the roof. Asserted where it applies, so the two
    // wrong placements — into the section as a build percentage, and across the whole
    // build — both fail here rather than only showing up as a drifted fixture schedule.
    const roofOf = (roofType: RoofType) =>
      runTakeoff({ ...BASE_INPUT, roofType }, CM_RATE_FALLBACK)!.sectionsLocal.roof;
    for (const t of ['clay_tiles', 'shingle'] as RoofType[]) {
      // Pitched only: a flat roof emits different LINES, so its section is not a
      // multiple of the long-span one.
      const want = 1 + roofOption(t)!.costDeltaPct / 100;
      expect(roofOf(t) / roofOf('long_span_aluminum'), t).toBeCloseTo(want, 6);
    }
  });

  it('moves the build by much less than the roof percentage, and says so', () => {
    // The reason the wizard badge is computed rather than labelled. A "+10%" covering
    // moves a typical build by well under 1%, because the roof is 2-10% of a build —
    // 10.1% on Rose, 2.3% on Naka, 2.2% on Mpangou.
    const build = cost('clay_tiles') / cost('long_span_aluminum') - 1;
    expect(build).toBeGreaterThan(0);
    expect(build).toBeLessThan(roofOption('clay_tiles')!.costDeltaPct / 100 / 3);
  });

  it('leaves the plumbing fixture schedule untouched', () => {
    // Scaling the whole build was the other wrong placement, and this is what caught it:
    // the fixture schedule reproduces three of the four documents to the franc, and a
    // roof choice has no business moving it.
    const plumbing = (roofType: RoofType) =>
      runTakeoff({ ...BASE_INPUT, roofType }, CM_RATE_FALLBACK)!.sectionsLocal.plumbing;
    expect(plumbing('clay_tiles')).toBe(plumbing('long_span_aluminum'));
    expect(plumbing('stone_coated')).toBe(plumbing('long_span_aluminum'));
  });

  it('keeps a retired covering priceable', () => {
    // aluminium_deck is out of the picker but still a persisted enum value.
    expect(cost('aluminium_deck')).toBeGreaterThan(0);
    expect(roofsOfForm('flat').some(o => o.value === 'aluminium_deck')).toBe(false);
  });
});

// ── The stone-coated "Abuja" roof (Q1) ───────────────────
describe('stone-coated sheet reproduces the Rose roof', () => {
  it('closes most of the gap on the Rose total', () => {
    // 7.7% was derived from this document, so this is a regression lock rather than
    // evidence. What it locks is the TOTAL, not the roof line: the uplift is spread over
    // the build, so Rose's roof section stays near our long-span figure while her
    // document puts the money in the roof.
    //
    // That is a known imprecision, and the honest one available. Placing it in the roof
    // instead needs a real per-covering roof rate, which is Q15 territory — and placing
    // a build-level percentage in one section is what produced a 6,566,686 roof line on
    // Naka against a document that prices it at 953,440.
    const rose = CAMEROON_BQS.find(b => b.name.startsWith('Rose'))!;
    const err = (roofType: RoofType) =>
      Math.abs(runTakeoff({ ...rose.input, roofType }, CM_RATE_FALLBACK)!.totalLocal / rose.actualTotal - 1);
    expect(err('stone_coated')).toBeLessThan(err('long_span_aluminum'));
    expect(err('stone_coated')).toBeLessThan(0.16);
  });

  it('is dearer than plain aluminium, and pitched', () => {
    expect(roofOption('stone_coated')!.form).toBe('pitched');
    expect(roofOption('stone_coated')!.costDeltaPct).toBeGreaterThan(0);
  });
});
