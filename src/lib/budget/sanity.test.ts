import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEstimate, UNDER_ESTIMATE_RATIO } from './sanity';
import { calculateBudget, projectBudget } from './index';
import { CITY_RATES, CM_CITY_CODES, CM_RATE_FALLBACK, resolveCityRate } from './model';
import type { CityRate, ConstructionRate } from '@/types/project';

const RATE     = CM_RATE_FALLBACK;
const FX       = RATE.approx_fx_rate;
const BASELINE = RATE.rule_of_thumb_per_m2!;
const yaounde  = CITY_RATES.YAOUNDE;

/** A total landing exactly at `ratio` × the reference, in USD. */
function totalAtRatio(ratio: number, sqm: number, floors: number, city: CityRate = yaounde) {
  const rate = BASELINE * (1 + (city.cost_delta_pct ?? 0) / 100);
  return ratio * rate * sqm * floors / FX;
}

const check = (
  total: number | null, sqm: number, floors: number,
  city: CityRate | null = yaounde, rate: ConstructionRate | null = RATE,
) => checkEstimate(total, { sqm, floors, rate, cityRate: city });

describe('checkEstimate', () => {
  it('fires below half the reference and not above it', () => {
    expect(check(totalAtRatio(0.49, 200, 6), 200, 6).low).toBe(true);
    expect(check(totalAtRatio(0.51, 200, 6), 200, 6).low).toBe(false);
  });

  it('treats exactly half as acceptable, not as a warning', () => {
    // Strictly-below, so the boundary is not a coin toss on a floating-point remainder.
    expect(check(totalAtRatio(UNDER_ESTIMATE_RATIO, 200, 6), 200, 6).low).toBe(false);
  });

  it('reads the reference off the rate row, not off a constant', () => {
    // The figure is `construction_rates.rule_of_thumb_per_m2` (migration 073), so a
    // quantity surveyor can revise it without a deploy. Double it and the same money
    // that passed must now warn.
    const money = totalAtRatio(0.6, 200, 6);
    expect(check(money, 200, 6, yaounde, RATE).low).toBe(false);
    expect(check(money, 200, 6, yaounde, { ...RATE, rule_of_thumb_per_m2: BASELINE * 2 }).low).toBe(true);
  });

  it('scales by cost_delta_pct, and cannot be re-derived from rc_350', () => {
    // Bamenda is +10% on whole-building cost, so the same money is a worse ratio there.
    const money = totalAtRatio(0.52, 200, 6, yaounde);
    expect(check(money, 200, 6, yaounde).low).toBe(false);
    expect(check(money, 200, 6, CITY_RATES.BAMENDA).low).toBe(true);

    // Buea and Bamenda share an rc_350 of 190,000 but differ by 10 points of
    // cost_delta_pct. Anyone re-deriving the reference from the concrete column would
    // give them the same answer; these must differ.
    expect(CITY_RATES.BUEA.rc_350).toBe(CITY_RATES.BAMENDA.rc_350);
    expect(check(money, 200, 6, CITY_RATES.BUEA).low)
      .not.toBe(check(money, 200, 6, CITY_RATES.BAMENDA).low);
  });

  it('stays quiet where it has no defensible basis', () => {
    const peanuts = 1; // $1 for a mansion — would warn if it were comparable at all.

    // No reference figure on the country row. Nigeria is null and stays null until a
    // Nigerian Bill of Quantity exists.
    expect(check(peanuts, 200, 6, CITY_RATES.ABUJA, { ...RATE, country_code: 'NG', rule_of_thumb_per_m2: null }).low).toBe(false);
    expect(check(peanuts, 200, 6, yaounde, { ...RATE, rule_of_thumb_per_m2: null }).low).toBe(false);
    expect(check(peanuts, 200, 6, yaounde, { ...RATE, rule_of_thumb_per_m2: 0 }).low).toBe(false);
    // No rate row at all — the fetch has not landed yet.
    expect(check(peanuts, 200, 6, yaounde, null).low).toBe(false);
    // Rate row and city row from different countries: the wrong city's difference.
    expect(check(peanuts, 200, 6, CITY_RATES.ABUJA, RATE).low).toBe(false);
    // An unresolved city.
    expect(check(peanuts, 200, 6, null).low).toBe(false);
    // Cities whose own rates are estimated — a warning from an estimate about an estimate.
    expect(check(peanuts, 200, 6, CITY_RATES.ADAMAWA).low).toBe(false);
    expect(check(peanuts, 200, 6, CITY_RATES.GAROUA).low).toBe(false);
    // A wizard part-way through.
    expect(check(peanuts, 0, 6).low).toBe(false);
    expect(check(peanuts, 200, 0).low).toBe(false);
    expect(check(peanuts, 200, 6, yaounde, { ...RATE, approx_fx_rate: 0 }).low).toBe(false);
    // No total yet.
    expect(check(0, 200, 6).low).toBe(false);
    expect(check(null, 200, 6).low).toBe(false);
    expect(check(NaN, 200, 6).low).toBe(false);

    // Every one of those reports "not comparable" rather than a made-up ratio.
    expect(check(peanuts, 200, 6, null).ratio).toBeNull();
  });

  it('reports built area, not footprint', () => {
    expect(check(totalAtRatio(1, 145, 3), 145, 3).builtAreaSqm).toBe(435);
  });
});

/**
 * The engine, measured against the reference it is checked by.
 *
 * These numbers are why the deck-slab fix happened. `engine.ts` charged ONE suspended
 * slab, soffit and stair flight at any height, so the taller the building the further our
 * estimate fell below a quantity surveyor's — 8 storeys bottomed out at 0.39 of the
 * reference. Codes 403/407/408 now carry every deck above the first, and the floor is
 * back above 0.50 at every height in the book.
 *
 * If a future change reopens that gap, these fail before a client is quoted from it.
 */
describe('the engine no longer under-prices tall buildings', () => {
  const build = (sqm: number, floors: number, city: CityRate) =>
    calculateBudget(
      { sqm, floors, city: city.city_name, countryCode: 'CM',
        bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1 } as never,
      null, city,
    ).total;

  const REAL = CM_CITY_CODES.map(c => CITY_RATES[c]).filter(c => c.data_source === 'real_bq');
  const FOOTPRINTS = [70, 90, 110, 145, 180, 220, 300];

  it('never trips the check, at any height, in any city', () => {
    // Before the fix this failed from four storeys up. It is the strongest statement we
    // can make that the slab count was the mechanism.
    for (const city of REAL) {
      for (const floors of [1, 2, 3, 4, 5, 6, 8, 12]) {
        for (const sqm of FOOTPRINTS) {
          const s = check(build(sqm, floors, city), sqm, floors, city);
          expect(s.low, `${city.city_code} ${floors}f ${sqm}m² ratio ${s.ratio?.toFixed(3)}`).toBe(false);
        }
      }
    }
  });

  it('keeps a tall building within a stated distance of the reference', () => {
    // A single number to notice if the gap starts widening again. 0.50 is the floor the
    // check itself uses; asserting a margin above it means the engine has to regress
    // visibly, not by a rounding error, before the warning starts firing on our own work.
    const worst = Math.min(...REAL.flatMap(city =>
      [6, 8, 12].flatMap(f => FOOTPRINTS.map(sqm => check(build(sqm, f, city), sqm, f, city).ratio!)),
    ));
    expect(worst).toBeGreaterThan(UNDER_ESTIMATE_RATIO);
  });

  it('still costs less per m² the taller it gets, but far more gently', () => {
    // Some decay is real — foundations and preliminaries amortise over built area. The
    // defect was the RATE of decay. Recorded here so the shape stays visible.
    const ratios = [1, 2, 4, 8, 12].map(f => check(build(200, f, yaounde), 200, f, yaounde).ratio!);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeLessThan(ratios[i - 1]);

    // Measured, not hoped for: going 1 floor -> 8 floors used to lose about 62% of the
    // ratio and now loses about 49%. The bound is set just above what the engine actually
    // does, so a regression in the slab count fails here rather than merely looking
    // plausible. The residual 49% is NOT claimed to be correct — it is the part with no
    // identified mechanism left, and it is what Vanessa still needs to look at.
    const lost = 1 - ratios[3] / ratios[0];
    expect(lost).toBeLessThan(0.55);
    expect(lost).toBeGreaterThan(0.40);
  });
});

/**
 * The costing tab reaches the check by a different road than the wizard does.
 *
 * The wizard hands it the rate row it already loaded. `BudgetView` fetches its own and
 * resolves the city from free text. A mismatch between those paths would not fail to
 * compile and would not throw — it would just silently never warn.
 */
describe('the costing tab wiring', () => {
  const row = (over: Record<string, unknown>) => ({
    country: 'CM', city: 'Yaoundé', num_floors: 8, sqm: 300,
    building_type: 'residential', roof_type: 'pitched',
    has_boys_quarters: false, bq_rooms: 0, finish_level: 'standard',
    budget_usd: null, ...over,
  }) as never;

  /** Exactly what BudgetView.tsx does, in the same order. */
  const asTabDoes = (p: { country: string; city: string | null; sqm: number; num_floors: number; budget_usd?: number | null }) =>
    checkEstimate(projectBudget(row(p)).total, {
      sqm: p.sqm, floors: p.num_floors,
      rate: RATE, cityRate: resolveCityRate(p.city, p.country),
    });

  it('warns on a budget the owner set far below the building', () => {
    // The case this check now exists for: `projectBudget` returns the confirmed figure
    // when there is one, and a person can type anything.
    const s = asTabDoes({ country: 'CM', city: 'Yaoundé', sqm: 300, num_floors: 8, budget_usd: 40_000 });
    expect(s.ratio).not.toBeNull();   // the wiring produced a comparison at all
    expect(s.low).toBe(true);
  });

  it('leaves our own estimate for the same building alone', () => {
    expect(asTabDoes({ country: 'CM', city: 'Yaoundé', sqm: 300, num_floors: 8 }).low).toBe(false);
  });

  it('survives the free-text city column', () => {
    for (const city of ['Yaoundé', 'yaounde', 'YAOUNDE', 'Yaounde, Cameroon', 'Nowhere', null]) {
      expect(asTabDoes({ country: 'CM', city, sqm: 300, num_floors: 8 }).ratio,
             `city ${city}`).not.toBeNull();
    }
  });
});

/**
 * The reference is a check, never a quotation, and never a literal.
 *
 * Two numbers on one money screen invite the reader to average them, and the figure is a
 * back-of-envelope blind to finish, shape, roof and room count. It exists to tell us our
 * own number is wrong, and it stops being useful the moment anyone treats it as a second
 * opinion — or hardcodes it where a quantity surveyor cannot revise it.
 */
describe('the reference never reaches a client, and is never a literal', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
      return [relative(ROOT, full)];
    });
  }

  /** Comments explain the number at length; only code counts. */
  const stripComments = (src: string) =>
    src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

  it('is not written into the check, or anywhere but the rate book', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter(f => /\b180[_,]?000\b/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));

    // model.ts alone may hold it: it is the offline copy of the country rate row, and it
    // separately holds 180,000 as Yaoundé's and Douala's rc_350 — a different quantity
    // that collides by coincidence. sanity.ts must NOT appear here: the authority is
    // construction_rates.rule_of_thumb_per_m2, not a constant in the checker.
    expect(offenders).toEqual(['src/lib/budget/model.ts']);
  });

  it('is not quoted in the warning copy, in either language', () => {
    for (const lang of ['en', 'fr']) {
      const dict = readFileSync(join(ROOT, `src/lib/i18n/${lang}.ts`), 'utf8');
      for (const key of ['lowEstimateTitle', 'lowEstimateBody']) {
        const line = dict.split('\n').find(l => l.includes(`${key}:`));
        expect(line, `${lang}.${key} missing`).toBeTruthy();
        // No digits at all: no rate, no ratio, no "50%", no "2x".
        expect(line!.replace(/\\u[0-9a-f]{4}/gi, ''), `${lang}.${key} quotes a figure`)
          .not.toMatch(/\d/);
      }
    }
  });
});
