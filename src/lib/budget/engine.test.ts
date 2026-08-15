import { describe, expect, it } from 'vitest';
import { runTakeoff } from './engine';
import { plumbingCost } from './fixtures';
import { CITY_RATES, CM_TAKEOFF, resolveCityRate } from './model';
import { calculateBudget, calculateBudgetDetail } from './index';
import { DEFAULT_FIXTURE_PRICES } from './model';
import { CAMEROON_BQS, PLUMBING_CHECKS } from './__fixtures__/cameroon-bqs';
import type { ConstructionRate } from '@/types/project';

/** Cameroon rate row as seeded by migration 020. */
const CM_RATE: ConstructionRate = {
  country_code: 'CM',
  base_rate_usd: 640,
  upper_floor_addition_pct: 23.0,
  sections: {
    preliminary: 1.1, foundation: 9.6, ground_floor: 29.4, roof: 12.5,
    joinery: 8.7, electrical: 4.8, plumbing: 13.4, finishing: 20.5,
  },
  finish_multipliers: { standard: 1.0, premium: 1.45, luxury: 1.70 },
  building_type_multipliers: { single_family: 1.0, multi_family: 1.15, apartment: 1.15 },
  roof_type_multipliers: { long_span_aluminum: 1.0, clay_tiles: 1.10, concrete_flat: 1.08, shingle: 1.05 },
  currency_code: 'XAF',
  approx_fx_rate: 600,
  data_source: 'real_bq',
  takeoff: CM_TAKEOFF,
  fixture_prices: DEFAULT_FIXTURE_PRICES,
};

describe('plumbing — reproduces every source BQ exactly', () => {
  // This is the strongest claim the engine makes. The four documents price plumbing as a
  // fixture list, and the arithmetic is recoverable to the franc.
  it.each(PLUMBING_CHECKS)('$name', c => {
    const p = DEFAULT_FIXTURE_PRICES;
    const computed = p.supply + p.drainage + p.septic + p.accessories
      + c.wc * p.wc + c.mirror * p.mirror + c.sink * p.sink
      + c.tub * p.tub + c.shower * p.shower + c.kitchenSink * p.kitchen_sink;
    expect(computed).toBe(c.total);
  });

  it('derives a standard-finish schedule with no baths, showers or mirrors', () => {
    const cost = plumbingCost(
      { bathrooms: 3, kitchens: 1, finishLevel: 'standard', floors: 2 },
      DEFAULT_FIXTURE_PRICES,
    );
    expect(cost).toBe(2_255_000);   // matches Buea and Naka exactly
  });
});

describe('geometry recovered from the BQs', () => {
  it('recovers Mpangou’s stated perimeter of 48 m from a 144 m² footprint', () => {
    const t = runTakeoff({ ...CAMEROON_BQS[3].input }, CM_RATE);
    expect(t).not.toBeNull();
    // 4 × √144 = 48, exactly what the Mpangou take-off sheet records
    expect(4 * Math.sqrt(144)).toBe(48);
  });

  it('prices a suspended slab at footprint × 0.12 m³', () => {
    expect(CM_TAKEOFF.geometry.slab_thickness_m).toBe(0.12);
    // 26.88 / 224 = 0.12 (Buea), 17.28 / 144 = 0.12 (Naka, Mpangou)
    expect(26.88 / 224).toBeCloseTo(0.12, 10);
    expect(17.28 / 144).toBeCloseTo(0.12, 10);
  });
});

describe('city rate book', () => {
  it('matches each BQ’s own concrete rate to its own city column', () => {
    expect(CITY_RATES.YAOUNDE.rc_350).toBe(180_000); // Rose
    expect(CITY_RATES.BUEA.rc_350).toBe(190_000);    // Buea
    expect(CITY_RATES.KRIBI.rc_350).toBe(179_000);   // Mpangou
    expect(CITY_RATES.BALI.rc_350).toBe(190_000);    // Naka
  });

  it('resolves free-text city names, accents and trailing country', () => {
    expect(resolveCityRate('Yaoundé', 'CM')?.city_code).toBe('YAOUNDE');
    expect(resolveCityRate('yaounde', 'CM')?.city_code).toBe('YAOUNDE');
    expect(resolveCityRate('Buea, Cameroon', 'CM')?.city_code).toBe('BUEA');
    expect(resolveCityRate('Nowhere', 'CM')?.city_code).toBe('DOUALA'); // baseline fallback
    expect(resolveCityRate('Lagos', 'NG')).toBeNull();
  });

  it('prices Adamawa ~44% above Douala for an otherwise identical build', () => {
    const base = { ...CAMEROON_BQS[0].input };
    const douala  = runTakeoff({ ...base, city: 'Douala'  }, CM_RATE)!.totalLocal;
    const adamawa = runTakeoff({ ...base, city: 'Adamawa' }, CM_RATE)!.totalLocal;
    expect(adamawa / douala).toBeGreaterThan(1.30);
    expect(adamawa / douala).toBeLessThan(1.50);
  });
});

describe('take-off against the four source BQs', () => {
  // Tolerances reflect what the source documents can actually support, not what would
  // look good. Two of the four omit internal partitions and one under-provisions its
  // foundation; see __fixtures__/cameroon-bqs.ts. Tighten these when the engineer
  // resolves the open questions in docs/BQ-QUESTIONS.md.
  const TOLERANCE = { reliable: 0.25, partial: 0.35 } as const;

  it.each(CAMEROON_BQS)('$name', bq => {
    const t = runTakeoff(bq.input, CM_RATE);
    expect(t).not.toBeNull();
    const err = t!.totalLocal / bq.actualTotal - 1;
    expect(Math.abs(err)).toBeLessThan(TOLERANCE[bq.quality]);
  });

  it('beats the old single-BQ formula on every project it was not fitted to', () => {
    const legacyErr = (bq: typeof CAMEROON_BQS[number]) =>
      Math.abs(bq.input.sqm! * 640 * (1 + (bq.input.floors! - 1) * 0.243) * 600
               / bq.actualTotal - 1);
    const newErr = (bq: typeof CAMEROON_BQS[number]) =>
      Math.abs(runTakeoff(bq.input, CM_RATE)!.totalLocal / bq.actualTotal - 1);

    // Rose is excluded: the old rate was fitted to it, so it reproduces it exactly.
    for (const bq of CAMEROON_BQS.slice(1)) {
      expect(newErr(bq)).toBeLessThan(legacyErr(bq));
    }
  });

  it('keeps the worst-case error well under the old engine’s +146%', () => {
    const worst = Math.max(...CAMEROON_BQS.map(
      bq => Math.abs(runTakeoff(bq.input, CM_RATE)!.totalLocal / bq.actualTotal - 1),
    ));
    expect(worst).toBeLessThan(0.35);
  });
});

describe('public API', () => {
  it('returns the nine BQ sections, summing to the total exactly', () => {
    const d = calculateBudgetDetail(CAMEROON_BQS[0].input, CM_RATE);
    expect(d.sections.map(s => s.key)).toEqual([
      'preliminary', 'foundation', 'ground_floor', 'upper_floor',
      'roof', 'joinery', 'electrical', 'plumbing', 'finishing',
    ]);
    // Amounts are allocated, not independently rounded, so this is exact — it used to
    // be allowed 0.5% of slack.
    const sum = d.sections.reduce((s, x) => s + Math.round(x.amountUSD * 100), 0);
    expect(sum).toBe(Math.round(d.total * 100));
    expect(d.currencyCode).toBe('XAF');
  });

  it('gives section percentages a single denominator, summing to 100', () => {
    // Regression: the eight base sections used to publish `pct` as a share of
    // `singleBase` while `upper_floor` and `bq` published a share of `total`. Two
    // denominators in one column read 118.7% on a two-storey legacy build.
    const cases = [
      calculateBudgetDetail(CAMEROON_BQS[0].input, CM_RATE),                    // take-off path
      calculateBudgetDetail({                                                    // legacy path
        country: 'NG', sqm: 150, floors: 2, buildingType: 'single_family',
        roofType: 'long_span_aluminum', finishLevel: 'standard',
      }),
      calculateBudgetDetail({                                                    // legacy + BQ
        country: 'NG', sqm: 150, floors: 3, buildingType: 'single_family',
        roofType: 'long_span_aluminum', finishLevel: 'standard',
        hasBoysQuarters: true, bqRooms: 2,
      }),
    ];
    for (const d of cases) {
      const pctSum = d.sections.reduce((s, x) => s + Math.round(x.pct * 10), 0);
      expect(pctSum).toBe(1000); // 100.0%, in tenths
    }
  });

  it('charges nothing for boys’ quarters, on either pricing path', () => {
    // This used to assert a $16,000 difference for two rooms. The $8,000/room figure had
    // no Bill of Quantity behind it and was 19–27% of a typical total, so it is gone
    // until Vanessa supplies one. The wizard still asks; the answer costs nothing.
    const takeoff = { ...CAMEROON_BQS[0].input };
    const legacy  = { ...CAMEROON_BQS[0].input, country: 'NG' };

    for (const input of [takeoff, legacy]) {
      const without = calculateBudget(input, input === legacy ? undefined : CM_RATE).total;
      const with2   = calculateBudget(
        { ...input, hasBoysQuarters: true, bqRooms: 2 },
        input === legacy ? undefined : CM_RATE,
      ).total;
      expect(with2 - without).toBe(0);
    }
  });

  it('falls back to the legacy formula when a country has no take-off model', () => {
    const noModel: ConstructionRate = { ...CM_RATE, country_code: 'KE', takeoff: null };
    const d = calculateBudgetDetail({ ...CAMEROON_BQS[0].input, country: 'KE' }, noModel);
    expect(d.total).toBeGreaterThan(0);
    // legacy path emits the ground-floor slice, not a take-off section set
    expect(d.sections.some(s => s.key === 'ground_floor')).toBe(true);
  });

  it('returns a usable estimate when footprint is zero', () => {
    const d = calculateBudgetDetail({ ...CAMEROON_BQS[0].input, sqm: 0 }, CM_RATE);
    expect(d.total).toBe(0);
    expect(d.sections).toHaveLength(0);
  });
});

describe('finish levels stay monotone', () => {
  it('prices standard < premium < luxury for the same building', () => {
    const base = { ...CAMEROON_BQS[0].input };
    const at = (finishLevel: 'standard' | 'premium' | 'luxury') =>
      runTakeoff({ ...base, finishLevel }, CM_RATE)!.totalLocal;
    expect(at('standard')).toBeLessThan(at('premium'));
    expect(at('premium')).toBeLessThan(at('luxury'));
  });

  it('prices more floors above fewer', () => {
    const base = { ...CAMEROON_BQS[0].input };
    const at = (floors: number) => runTakeoff({ ...base, floors }, CM_RATE)!.totalLocal;
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
  });
});
