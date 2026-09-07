import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEstimate, RULE_OF_THUMB_XAF_PER_M2, UNDER_ESTIMATE_RATIO } from './sanity';
import { calculateBudget } from './index';
import { CITY_RATES, CM_CITY_CODES, resolveCityRate } from './model';
import { getApproxFx, projectBudget } from './index';
import type { CityRate } from '@/types/project';

const FX = 600;
const yaounde = CITY_RATES.YAOUNDE;

/** A total that lands exactly at `ratio` × the rule of thumb, in USD. */
function totalAtRatio(ratio: number, sqm: number, floors: number, city: CityRate = yaounde) {
  const rate = RULE_OF_THUMB_XAF_PER_M2 * (1 + (city.cost_delta_pct ?? 0) / 100);
  return ratio * rate * sqm * floors / FX;
}

const check = (total: number, sqm: number, floors: number, city: CityRate | null = yaounde) =>
  checkEstimate(total, { sqm, floors, cityRate: city, fxRate: FX });

describe('checkEstimate', () => {
  it('fires below half the rule of thumb and not above it', () => {
    expect(check(totalAtRatio(0.49, 200, 6), 200, 6).low).toBe(true);
    expect(check(totalAtRatio(0.51, 200, 6), 200, 6).low).toBe(false);
  });

  it('treats exactly half as acceptable, not as a warning', () => {
    // Strictly-below, so the boundary is not a coin toss on a floating-point remainder.
    expect(check(totalAtRatio(UNDER_ESTIMATE_RATIO, 200, 6), 200, 6).low).toBe(false);
  });

  it('scales with the city, using cost_delta_pct and not the concrete column', () => {
    // Bamenda is +10% on whole-building cost, so the same money is a worse ratio there.
    const bamenda = CITY_RATES.BAMENDA;
    const money   = totalAtRatio(0.52, 200, 6, yaounde);
    expect(check(money, 200, 6, yaounde).low).toBe(false);
    expect(check(money, 200, 6, bamenda).low).toBe(true);

    // Guard against someone re-deriving the threshold off rc_350. Buea and Bamenda share
    // an rc_350 of 190,000 but differ by 10 points of cost_delta_pct, so a check keyed on
    // concrete would give them the same answer. These must differ.
    expect(CITY_RATES.BUEA.rc_350).toBe(CITY_RATES.BAMENDA.rc_350);
    const edge = totalAtRatio(0.52, 200, 6, yaounde);
    expect(check(edge, 200, 6, CITY_RATES.BUEA).low)
      .not.toBe(check(edge, 200, 6, CITY_RATES.BAMENDA).low);
  });

  it('stays quiet where it has no defensible basis', () => {
    const peanuts = 1; // $1 for a mansion — would warn if it were comparable at all.

    // Nigeria: no Bill of Quantity exists, so no rule of thumb exists either.
    expect(check(peanuts, 200, 6, CITY_RATES.ABUJA).low).toBe(false);
    // An unresolved city.
    expect(check(peanuts, 200, 6, null).low).toBe(false);
    // Cities whose own rates are estimated — a warning from an estimate about an estimate.
    expect(check(peanuts, 200, 6, CITY_RATES.ADAMAWA).low).toBe(false);
    expect(check(peanuts, 200, 6, CITY_RATES.GAROUA).low).toBe(false);
    // A wizard part-way through.
    expect(check(peanuts, 0, 6).low).toBe(false);
    expect(check(peanuts, 200, 0).low).toBe(false);
    expect(checkEstimate(peanuts, { sqm: 200, floors: 6, cityRate: yaounde, fxRate: 0 }).low).toBe(false);
    // No total yet.
    expect(check(0, 200, 6).low).toBe(false);
    expect(checkEstimate(null,  { sqm: 200, floors: 6, cityRate: yaounde, fxRate: FX }).low).toBe(false);
    expect(checkEstimate(NaN,   { sqm: 200, floors: 6, cityRate: yaounde, fxRate: FX }).low).toBe(false);

    // Every one of those reports "not comparable" rather than a made-up ratio.
    expect(check(peanuts, 200, 6, null).ratio).toBeNull();
  });

  it('reports built area, not footprint', () => {
    expect(check(totalAtRatio(1, 145, 3), 145, 3).builtAreaSqm).toBe(435);
  });
});

/**
 * The warning against the engine it guards.
 *
 * These are the numbers that chose the 0.5 threshold. They will move when Vanessa signs
 * off the per-floor deck slab, and that is the point: this test is what tells us the
 * guard rail is no longer needed, rather than leaving it up forever out of caution.
 */
describe('the warning tracks the known defect', () => {
  const build = (sqm: number, floors: number, city: CityRate) =>
    calculateBudget(
      { sqm, floors, city: city.city_name, countryCode: 'CM',
        bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1 } as never,
      null, city,
    ).total;

  const REAL = CM_CITY_CODES.map(c => CITY_RATES[c]).filter(c => c.data_source === 'real_bq');
  const FOOTPRINTS = [70, 90, 110, 145, 180, 220, 300];

  it('never fires on a one, two or three storey build', () => {
    // The whole beta cohort, essentially. A warning here would be wallpaper.
    for (const city of REAL) {
      for (const floors of [1, 2, 3]) {
        for (const sqm of FOOTPRINTS) {
          const s = check(build(sqm, floors, city), sqm, floors, city);
          expect(s.low, `${city.city_code} ${floors}f ${sqm}m² ratio ${s.ratio?.toFixed(3)}`).toBe(false);
        }
      }
    }
  });

  it('fires on the tall buildings the engine under-prices', () => {
    // At eight storeys the engine charges one deck slab where seven are needed, so a
    // large floor plate should trip it every time.
    for (const city of REAL) {
      const sqm = 300;
      expect(check(build(sqm, 8, city), sqm, 8, city).low,
             `${city.city_code} 8f ${sqm}m²`).toBe(true);
    }
  });

  it('gets worse as the building gets taller, monotonically', () => {
    // The signature of the defect: the shortfall is per-floor, so the ratio decays with
    // every storey. If this ever stops holding, the cause has changed.
    let previous = Infinity;
    for (const floors of [1, 2, 3, 4, 5, 6, 8]) {
      const s = check(build(200, floors, yaounde), 200, floors, yaounde);
      expect(s.ratio!).toBeLessThan(previous);
      previous = s.ratio!;
    }
  });
});

/**
 * The rule of thumb is a check, never a quotation.
 *
 * Two numbers on one money screen invite the reader to average them, and 180,000 XAF/m²
 * is not a figure we can defend to a client — it is Vanessa's back-of-envelope, blind to
 * finish, shape, roof and room count. It exists to tell us our own estimate is wrong, and
 * it stops being useful the moment anyone treats it as a second opinion.
 */
describe('the rule of thumb never reaches a client', () => {
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

  it('is written down in exactly one place', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter(f => f !== 'src/lib/budget/sanity.ts')
      .filter(f => /\b180[_,]?000\b/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));

    // `CityRate.rc_350` is 180,000 for Yaoundé and Douala too — a different quantity that
    // happens to collide. model.ts is the rate book and is allowed to hold it.
    expect(offenders.filter(f => f !== 'src/lib/budget/model.ts')).toEqual([]);
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

/**
 * The costing tab reaches the check by a different road than the wizard does.
 *
 * The wizard hands it a `CityRate` it already loaded and the FX rate off the construction
 * row. `BudgetView` has neither, so it resolves the city from free text and the FX from
 * the ISO country code on the project. A mismatch between those two paths — `country`
 * holding "Cameroon" where `getApproxFx` wants "CM", say — would not fail to compile and
 * would not throw. It would just silently never warn.
 */
describe('the costing tab wiring', () => {
  const row = (over: Record<string, unknown>) => ({
    country: 'CM', city: 'Yaoundé', num_floors: 8, sqm: 300,
    building_type: 'residential', roof_type: 'pitched',
    has_boys_quarters: false, bq_rooms: 0, finish_level: 'standard',
    budget_usd: null, ...over,
  }) as never;

  /** Exactly what BudgetView.tsx does, in the same order. */
  const asTabDoes = (p: { country: string; city: string | null; sqm: number; num_floors: number }) =>
    checkEstimate(projectBudget(row(p)).total, {
      sqm: p.sqm, floors: p.num_floors,
      cityRate: resolveCityRate(p.city, p.country),
      fxRate:   getApproxFx(p.country),
    });

  it('resolves a real project all the way to a warning', () => {
    const s = asTabDoes({ country: 'CM', city: 'Yaoundé', sqm: 300, num_floors: 8 });
    expect(s.ratio).not.toBeNull();   // the wiring produced a comparison at all
    expect(s.low).toBe(true);
  });

  it('stays quiet for the bungalow next door, on the same wiring', () => {
    expect(asTabDoes({ country: 'CM', city: 'Yaoundé', sqm: 145, num_floors: 1 }).low).toBe(false);
  });

  it('survives the free-text city column', () => {
    // `city` is free text on every project, so these all reach the same rate row.
    for (const city of ['Yaoundé', 'yaounde', 'YAOUNDE', 'Yaounde, Cameroon']) {
      expect(asTabDoes({ country: 'CM', city, sqm: 300, num_floors: 8 }).ratio,
             `city ${city}`).not.toBeNull();
    }
    // An unrecognised city falls back to the baseline rather than going uncomparable.
    expect(asTabDoes({ country: 'CM', city: 'Nowhere', sqm: 300, num_floors: 8 }).ratio).not.toBeNull();
    // A null city does too.
    expect(asTabDoes({ country: 'CM', city: null, sqm: 300, num_floors: 8 }).ratio).not.toBeNull();
  });

  it('reads an owner-confirmed total, not only the estimate', () => {
    // `projectBudget` returns the confirmed figure when there is one. A client who typed
    // a low number should still be told to have it checked.
    const cheap = checkEstimate(projectBudget(row({ budget_usd: 40_000 })).total, {
      sqm: 300, floors: 8,
      cityRate: resolveCityRate('Yaoundé', 'CM'), fxRate: getApproxFx('CM'),
    });
    expect(cheap.low).toBe(true);
  });
});
