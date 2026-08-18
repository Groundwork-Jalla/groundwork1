import { describe, expect, it } from 'vitest';
import { runTakeoff, SECTION_KEYS } from './engine';
import { applyOverrides, sectionsFromLines, totalFromLines } from './lines';
import { BQ_ITEMS, bqItem } from './bq-items';
import { CM_RATE_FALLBACK, CITY_RATES } from './model';
import { CAMEROON_BQS, PLUMBING_CHECKS } from './__fixtures__/cameroon-bqs';
import { en } from '@/lib/i18n/en';
import type { TakeoffLine } from './lines';

/**
 * The engine used to compute each section as one closed-form expression. It now emits
 * BQ lines and sums them, so a contractor can override a rate rather than a subtotal.
 *
 * Everything here exists to prove that change moved no money. The four real BQs already
 * have tolerance tests at the total level (engine.test.ts); those would happily pass if
 * two lines cancelled each other out, so these assert at line level instead.
 */

const RATE = CM_RATE_FALLBACK;
const byCode = (lines: readonly TakeoffLine[], code: string) => lines.filter(l => l.code === code);
const one    = (lines: readonly TakeoffLine[], code: string) => {
  const hits = byCode(lines, code);
  expect(hits, `expected exactly one ${code}`).toHaveLength(1);
  return hits[0];
};

describe('lines reconcile with sections', () => {
  it.each(CAMEROON_BQS)('$name — sections are exactly the sum of their lines', bq => {
    const t = runTakeoff(bq.input, RATE)!;
    const summed = sectionsFromLines(t.lines, SECTION_KEYS);

    for (const key of SECTION_KEYS) {
      // Float addition, so not bit-equality: splitting (250_000 + A*1_600)*ci into two
      // lines can differ from the single expression by a ULP.
      expect(summed[key]).toBeCloseTo(t.sectionsLocal[key], 6);
    }
    expect(totalFromLines(t.lines)).toBeCloseTo(t.totalLocal, 6);
  });

  it.each(CAMEROON_BQS)('$name — every line carries a positive qty and rate', bq => {
    for (const l of runTakeoff(bq.input, RATE)!.lines) {
      if (l.kind === 'percentage') continue;
      expect(l.qty).toBeGreaterThan(0);
      expect(l.rate).toBeGreaterThan(0);
      expect(l.amount).toBeCloseTo(l.qty * l.rate, 6);
    }
  });

  it('gives every emitted code a catalogue entry and a translation', () => {
    for (const bq of CAMEROON_BQS) {
      for (const l of runTakeoff(bq.input, RATE)!.lines) {
        expect(bqItem(l.code), `no catalogue entry for ${l.code}`).toBeDefined();
        expect(l.section).toBe(bqItem(l.code)!.section);
      }
    }
    // Every catalogue entry is translated — an untranslated line renders as a raw key
    // in the middle of a document a contractor is meant to quote against.
    //
    // Keyed on labelKey, not on code: the 400-series deliberately reuses the 300-series
    // labels, because "blockwork to walls" is the same trade on an upper floor.
    const dict = en.bq as Record<string, string>;
    for (const [code, item] of Object.entries(BQ_ITEMS)) {
      const key = item.labelKey.replace('bq.', '');
      expect(dict[key], `en.bq.${key} missing (item ${code})`).toBeTruthy();
    }
  });
});

describe('plumbing as lines', () => {
  // The old test recomputed the fixture formula in its own body, which asserted
  // arithmetic rather than the engine. These read 801-810 off the take-off itself.
  const FIXTURE_BY_NAME = Object.fromEntries(CAMEROON_BQS.map(b => [b.name.split(' ')[0], b]));

  // Mpangou is excluded deliberately — see the test below it.
  const REPRODUCED = PLUMBING_CHECKS.filter(c => c.name !== 'Mpangou');

  it.each(REPRODUCED)('$name reproduces its fixture schedule', check => {
    const bq = Object.values(FIXTURE_BY_NAME).find(b => b.name.startsWith(check.name));
    expect(bq, `no fixture named ${check.name}`).toBeDefined();
    const lines = runTakeoff(bq!.input, RATE, CITY_RATES.YAOUNDE)!.lines;

    const qty = (code: string) => byCode(lines, code).reduce((s, l) => s + l.qty, 0);
    expect(qty('805')).toBe(check.wc);
    expect(qty('806')).toBe(check.sink);
    expect(qty('807')).toBe(check.mirror);
    expect(qty('808')).toBe(check.shower);
    expect(qty('809')).toBe(check.tub);
    expect(qty('810')).toBe(check.kitchenSink);

    // Yaoundé has index 1.0 (the baseline moved there in 045), so the section total is
    // the document's figure unindexed.
    const plumbing = lines.filter(l => l.section === 'plumbing')
                          .reduce((s, l) => s + l.amount, 0);
    expect(plumbing).toBeCloseTo(check.total, 6);
  });

  it('diverges from Mpangou on mirrors, and Vanessa says our rule is right', () => {
    // Found by writing this file: Mpangou is a luxury G+3 whose document lists NO mirrors
    // (BQ 807) while `fixtureSchedule` gives one to every bathroom above standard finish.
    // Three of the four documents reproduce to the franc; this one did not.
    //
    // RESOLVED 17 Aug 2026 (Q10). Not an error in either direction — the omission was
    // deliberate: "the client proposed to import them by himself from China. So i
    // preferred to let pass than put china prices on cameroun estimate." So the schedule
    // is right and the document is a special case, and this stays a divergence rather
    // than becoming a rule. Kept as a test because a future change to fixtureSchedule
    // should still have to look at Mpangou and decide on purpose.
    const check = PLUMBING_CHECKS.find(c => c.name === 'Mpangou')!;
    const bq    = CAMEROON_BQS.find(b => b.name.startsWith('Mpangou'))!;
    const lines = runTakeoff(bq.input, RATE, CITY_RATES.YAOUNDE)!.lines;

    const mirrors = lines.filter(l => l.code === '807').reduce((s, l) => s + l.qty, 0);
    expect(check.mirror).toBe(0);
    expect(mirrors).toBe(3);   // our schedule; the document's 0 is the client's import
  });
});

describe('measured quantities against the source documents', () => {
  it('plasters Rose at 825.60 m² and Naka at 777.60 m²', () => {
    // BQ 306. These two are the documents that measured internal partitions and painted
    // the whole building, which is why the model was calibrated on them.
    const rose = CAMEROON_BQS.find(b => b.name.startsWith('Rose'))!;
    const naka = CAMEROON_BQS.find(b => b.name.startsWith('Naka'))!;

    // BQ 306 is ONE floor's plaster — both faces of every wall on that storey. The
    // documents quote it per floor, so 406 (the upper-floor line) is not added in.
    const plasterFor = (bq: typeof rose) =>
      byCode(runTakeoff(bq.input, RATE)!.lines, '306').reduce((s, l) => s + l.qty, 0);

    // Within 15% of the documents' own measured areas: Rose comes out 6.5% under its
    // 825.60, Naka 14.4% under its 777.60. Tighten when docs/BQ-QUESTIONS.md is answered.
    expect(plasterFor(rose)).toBeGreaterThan(825.60 * 0.85);
    expect(plasterFor(rose)).toBeLessThan(825.60 * 1.15);
    expect(plasterFor(naka)).toBeGreaterThan(777.60 * 0.85);
    expect(plasterFor(naka)).toBeLessThan(777.60 * 1.15);
  });

  it('emits upper-floor lines as quantity, not as a scaled subtotal', () => {
    // 400-series quantities carry the floor count. A three-storey build is three times
    // the blockwork AREA at one rate — which is how a contractor reads it — rather than a
    // ground-floor subtotal multiplied by two.
    const base = { ...CAMEROON_BQS[0].input, floors: 3 };
    const lines = runTakeoff(base, RATE)!.lines;

    const ground = one(lines, '305');
    const upper  = one(lines, '405');
    expect(upper.rate).toBe(ground.rate);
    expect(upper.qty).toBeCloseTo(ground.qty * 2, 6);
  });

  it('emits no upper-floor section for a bungalow', () => {
    const lines = runTakeoff({ ...CAMEROON_BQS[0].input, floors: 1 }, RATE)!.lines;
    expect(lines.filter(l => l.section === 'upper_floor')).toHaveLength(0);
  });
});

describe('overrides', () => {
  const build = () => runTakeoff(CAMEROON_BQS[0].input, RATE)!;

  it('moves the total by exactly the difference on one line', () => {
    const before = build();
    const block  = one(before.lines, '305');

    const after = runTakeoff(CAMEROON_BQS[0].input, RATE, null, {
      '305': { rate: block.rate * 2 },
    })!;

    const delta = after.totalLocal - before.totalLocal;
    // The line itself, plus the contingency that is calculated on it.
    expect(delta).toBeCloseTo(block.amount * (1 + RATE.takeoff!.geometry.contingency_pct), 4);
  });

  it('an overridden rate MUST move the contingency', () => {
    // The ordering trap: evaluate percentage lines before applying overrides and this
    // stays flat, the total changes by less than it should, and nothing says why.
    const before = build();
    const after  = runTakeoff(CAMEROON_BQS[0].input, RATE, null, {
      '305': { rate: one(before.lines, '305').rate * 3 },
    })!;

    expect(one(after.lines, '999').amount)
      .toBeGreaterThan(one(before.lines, '999').amount);
  });

  it('flags overridden lines and leaves the rest alone', () => {
    const t = runTakeoff(CAMEROON_BQS[0].input, RATE, null, { '305': { rate: 4_200 } })!;
    expect(one(t.lines, '305').overridden).toBe(true);
    expect(one(t.lines, '301').overridden).toBeUndefined();
  });

  it('falls back to the model value for garbage, never leaking it to the total', () => {
    const clean = build();
    for (const bad of [NaN, Infinity, -1, -0.5]) {
      const t = runTakeoff(CAMEROON_BQS[0].input, RATE, null, {
        '305': { rate: bad, qty: bad },
      })!;
      expect(Number.isFinite(t.totalLocal)).toBe(true);
      expect(t.totalLocal).toBeCloseTo(clean.totalLocal, 6);
    }
  });

  it('ignores an override for a code this build never emitted', () => {
    const clean = build();
    const t = runTakeoff(CAMEROON_BQS[0].input, RATE, null, {
      '501': { rate: 999_999 },   // parapet — this fixture has a pitched roof
      'not-a-code': { rate: 1 },
    })!;
    expect(t.totalLocal).toBeCloseTo(clean.totalLocal, 6);
  });

  it('overriding a quantity works as well as a rate', () => {
    const before = build();
    const doors  = one(before.lines, '601');
    const after  = runTakeoff(CAMEROON_BQS[0].input, RATE, null, {
      '601': { qty: doors.qty + 4 },
    })!;
    expect(one(after.lines, '601').amount)
      .toBeCloseTo((doors.qty + 4) * doors.rate, 6);
  });
});

describe('geometry from real dimensions', () => {
  const base = { ...CAMEROON_BQS[0].input, sqm: 144, floors: 2 };

  it('reproduces today’s numbers exactly when no dimensions are given', () => {
    // The backwards-compatibility lock: the client wizard never supplies L and W, and
    // must keep pricing exactly as it did.
    const a = runTakeoff(base, RATE)!;
    const b = runTakeoff({ ...base, lengthM: undefined, widthM: undefined }, RATE)!;
    expect(b.totalLocal).toBe(a.totalLocal);
  });

  it('uses 2(L+W) when dimensions are supplied', () => {
    // 12 x 12 = 144 m², perimeter 48 — exactly what 4 x sqrt(144) assumes, so a square
    // plan must price identically.
    const square = runTakeoff({ ...base, lengthM: 12, widthM: 12 }, RATE)!;
    expect(square.totalLocal).toBeCloseTo(runTakeoff(base, RATE)!.totalLocal, 4);

    // 24 x 6 is the same area with 12 m more wall, so it must cost more.
    const oblong = runTakeoff({ ...base, lengthM: 24, widthM: 6 }, RATE)!;
    expect(oblong.totalLocal).toBeGreaterThan(square.totalLocal);
  });

  it('prefers a measured perimeter over L x W', () => {
    const t = runTakeoff({ ...base, lengthM: 12, widthM: 12, perimeterM: 60 }, RATE)!;
    expect(one(t.lines, '206').qty).toBeCloseTo(60 * 0.6, 6);
  });

  it('ignores nonsense dimensions rather than corrupting the perimeter', () => {
    const clean = runTakeoff(base, RATE)!;
    for (const bad of [0, -5, NaN, Infinity]) {
      const t = runTakeoff({ ...base, lengthM: bad, widthM: bad, perimeterM: bad }, RATE)!;
      expect(t.totalLocal).toBe(clean.totalLocal);
    }
  });
});

describe('applyOverrides in isolation', () => {
  it('is a pure function — the input lines are not mutated', () => {
    const lines = runTakeoff(CAMEROON_BQS[0].input, RATE)!.lines;
    const snapshot = JSON.parse(JSON.stringify(lines));
    applyOverrides(lines, { '305': { rate: 1 } });
    expect(JSON.parse(JSON.stringify(lines))).toEqual(snapshot);
  });

  it('handles a null override map', () => {
    const lines = runTakeoff(CAMEROON_BQS[0].input, RATE)!.lines;
    expect(totalFromLines(applyOverrides(lines, null)))
      .toBeCloseTo(totalFromLines(lines), 6);
  });
});
