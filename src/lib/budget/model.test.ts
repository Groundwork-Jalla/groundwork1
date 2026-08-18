import { describe, expect, it } from 'vitest';
import { runTakeoff } from './engine';
import type { DetailedTakeoffInput } from './engine';
import { CITY_RATES, CM_CITY_CODES, CM_RATE_FALLBACK } from './model';

// ── City re-baseline (migration 044) ─────────────────────
//
// The claim these lock is Vanessa's, not ours: an identical building in Douala costs 5%
// less than in Yaoundé, in Bamenda 10% more, and so on. `index_vs_baseline` is solved to
// realise that, because concrete bypasses the index — so asserting on the index would
// test our arithmetic while leaving the claim untested.
describe('city cost deltas realise Vanessa 17 Aug 2026', () => {
  const REF = {
    country: 'CM', sqm: 120, floors: 2, finishLevel: 'standard' as const,
    bedrooms: 4, bathrooms: 3, buildingType: 'single_family' as const,
    roofType: 'long_span_aluminum' as const,
    livingRooms: 1, kitchens: 1, offices: 0, hasBoysQuarters: false,
  };
  const totalIn = (code: string, shape: Partial<typeof REF> = REF) =>
    runTakeoff(shape as DetailedTakeoffInput, CM_RATE_FALLBACK, CITY_RATES[code])!.totalLocal;

  it('hits each stated delta on the reference build', () => {
    const base = totalIn('YAOUNDE');
    for (const code of CM_CITY_CODES) {
      const want = CITY_RATES[code].cost_delta_pct!;
      const got  = (totalIn(code) / base - 1) * 100;
      expect(got, `${code}: wanted ${want}%, got ${got.toFixed(2)}%`).toBeCloseTo(want, 1);
    }
  });

  it('stays close on other building shapes', () => {
    // Calibrated on one build, so other shapes drift. Measured worst case is Adamawa and
    // Garoua at 2.3pp on a large G+2 — their concrete gap is the widest, so shape moves
    // them most. Anything beyond 3pp means the solve needs redoing, not the tolerance.
    const SHAPES = [
      { ...REF, sqm: 90,  floors: 1, bedrooms: 2, bathrooms: 1 },
      { ...REF, sqm: 200, floors: 3, bedrooms: 6, bathrooms: 4 },
      { ...REF, finishLevel: 'luxury' as const },
      { ...REF, roofType: 'concrete_flat' as const },
    ];
    for (const shape of SHAPES) {
      const base = totalIn('YAOUNDE', shape);
      for (const code of CM_CITY_CODES) {
        const drift = Math.abs((totalIn(code, shape) / base - 1) * 100 - CITY_RATES[code].cost_delta_pct!);
        expect(drift, `${code} on ${shape.sqm}m² G+${shape.floors - 1}`).toBeLessThan(3);
      }
    }
  });

  it('keeps Yaoundé as the only baseline', () => {
    const zero = CM_CITY_CODES.filter(c => CITY_RATES[c].cost_delta_pct === 0);
    // Buea is also 0% — same cost as Yaoundé — so "baseline" is about the index.
    expect(CITY_RATES.YAOUNDE.index_vs_baseline).toBe(1);
    expect(zero).toContain('YAOUNDE');
  });
});
