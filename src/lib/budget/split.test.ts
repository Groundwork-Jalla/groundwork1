import { describe, expect, it } from 'vitest';
import {
  BUDGET_SLICES, CHARGED_STAGE_COUNT, CONSTRUCTION_SPLIT,
  DESIGN_RATE_XAF_PER_M2, LABOR_PCT, MATERIAL_PCT, PERMIT_PCT_OF_BUILD,
  PROFESSIONAL_FEE_XAF, composeBudget, decomposeBudget, projectBudget, sliceShares,
} from './index';
import type { BudgetShape, ProjectBudgetSource } from './index';
import type { BudgetBreakdown } from '@/types/project';

/**
 * A construction consultant reviewed the app and found the budget breakdown did not add
 * up to the total printed beside it. Two separate causes, both regression-locked here:
 *
 *   1. Independent `Math.round(total * pct / 100)` calls drifted the parts away from the
 *      total they were printed beneath.
 *   2. The breakdown was computed from the engine ESTIMATE while the total displayed was
 *      the owner's CONFIRMED `budget_usd`. Whenever those differed — i.e. for anyone who
 *      edited their budget — every line was wrong.
 *
 * The six-way percentage split those tests were written against is gone. What replaced it
 * is harder to keep consistent, not easier: only one of the four lines is a percentage of
 * anything, and it is a percentage of `construction` rather than of `total`. So the two
 * identities below are asserted directly rather than inferred from a percentage table.
 *
 * Sums are compared in integer CENTS throughout. Values that are each an exact multiple
 * of $0.01 can still add to 99998.999999999 under IEEE-754, so a float `toBe(total)` here
 * would flake rather than fail honestly.
 */

const cents = (n: number) => Math.round(n * 100);

/** construction + permit + professional + design, in cents. */
const sumLines = (b: BudgetBreakdown) =>
  cents(b.construction) + cents(b.permit) + cents(b.professional) + cents(b.design);

/** The two identities that must hold for every breakdown the module ever produces. */
function expectCoherent(b: BudgetBreakdown) {
  expect(sumLines(b)).toBe(cents(b.total));
  expect(cents(b.material) + cents(b.labor)).toBe(cents(b.construction));
  expect(Object.values(b).every(Number.isFinite)).toBe(true);
  expect(Object.values(b).every(v => v >= 0)).toBe(true);
}

const SHAPE: BudgetShape = { builtAreaSqm: 240 };  // 120 m² footprint × 2 floors

describe('budget composition constants', () => {
  it('material and labour split the construction fee exactly', () => {
    expect(MATERIAL_PCT + LABOR_PCT).toBe(100);
  });

  it('exposes each client-facing line exactly once, and never the sub-lines', () => {
    const keys = BUDGET_SLICES.map(s => s.key);
    expect([...keys].sort()).toEqual(['construction', 'design', 'permit', 'professional']);
    expect(new Set(keys).size).toBe(keys.length);
    // material/labor are a view OF construction. Listing them alongside it would
    // double-count the build — the 118.7% bug in a new costume.
    expect(keys).not.toContain('material');
    expect(keys).not.toContain('labor');
    expect(CONSTRUCTION_SPLIT.map(s => s.key)).toEqual(['material', 'labor']);
  });
});

describe('composeBudget', () => {
  it('keeps both identities for every construction fee — property check', () => {
    for (let build = 1; build <= 20_000; build++) {
      expectCoherent(composeBudget(build, SHAPE));
    }
  });

  it('keeps both identities for awkward and large figures', () => {
    for (const build of [85, 1650, 8150, 99_999, 99_999.99, 100_000, 4_500_000, 36_583_000]) {
      const b = composeBudget(build, SHAPE);
      expectCoherent(b);
      expect(b.construction).toBe(Math.round(build * 100) / 100);
    }
  });

  it('prices the two flat fees from their XAF constants, not from the build cost', () => {
    // 350,000 XAF ÷ 600 = $583.33; 5,000 × 240 ÷ 600 = $2,000.00
    const small = composeBudget(50_000,    SHAPE);
    const large = composeBudget(5_000_000, SHAPE);

    expect(small.professional).toBeCloseTo(PROFESSIONAL_FEE_XAF * CHARGED_STAGE_COUNT / 600, 2);
    expect(small.design).toBeCloseTo(DESIGN_RATE_XAF_PER_M2 * 240 / 600, 2);
    // Identical on a budget 100× larger — that is what "flat" means.
    expect(large.professional).toBe(small.professional);
    expect(large.design).toBe(small.design);
  });

  it('scales the design fee with built area and nothing else', () => {
    const oneFloor = composeBudget(100_000, { builtAreaSqm: 120 });
    const twoFloor = composeBudget(100_000, { builtAreaSqm: 240 });
    expect(twoFloor.design).toBeCloseTo(oneFloor.design * 2, 2);
    expect(twoFloor.professional).toBe(oneFloor.professional);
    expect(twoFloor.construction).toBe(oneFloor.construction);
  });

  it('charges the permit on the construction fee, NOT on the total', () => {
    const b = composeBudget(200_000, SHAPE);
    expect(b.permit).toBeCloseTo(200_000 * PERMIT_PCT_OF_BUILD / 100, 2);
    // The distinction that matters: 1% of the total would be larger, because the total
    // carries the design and professional fees on top.
    expect(b.permit).toBeLessThan(b.total * PERMIT_PCT_OF_BUILD / 100);
  });

  it('returns zeros for degenerate input rather than leaking NaN', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const b = composeBudget(bad, { builtAreaSqm: 0 });
      expect(b.total).toBe(0);
      expect(sumLines(b)).toBe(0);
      expect(Object.values(b).every(Number.isFinite)).toBe(true);
    }
  });

  it('survives a degenerate built area without corrupting the construction fee', () => {
    for (const bad of [0, -50, NaN, Infinity]) {
      const b = composeBudget(100_000, { builtAreaSqm: bad });
      expect(b.design).toBe(0);
      expect(b.construction).toBe(100_000);
      expectCoherent(b);
    }
  });
});

describe('decomposeBudget — the inverse', () => {
  it('round-trips a composed budget back to the same lines', () => {
    // This is the whole argument for storing only `budget_usd`. If it holds, the four
    // lines are recoverable from one column and there is no second source of truth.
    for (const build of [12_345, 50_000, 99_999, 250_000, 4_500_000]) {
      const forward = composeBudget(build, SHAPE);
      const back    = decomposeBudget(forward.total, SHAPE);
      expect(back).toEqual(forward);
    }
  });

  it('returns the confirmed total EXACTLY, never a re-derived one', () => {
    // An owner who types 137,412.37 must see 137,412.37 — the rounding remainder goes
    // into the permit line rather than moving the number they agreed to.
    for (const total of [85, 1650, 99_999, 99_999.99, 137_412.37, 4_500_000]) {
      const b = decomposeBudget(total, SHAPE);
      expect(b.total).toBe(total);
      expectCoherent(b);
    }
  });

  it('keeps both identities across a wide sweep of confirmed totals', () => {
    for (let total = 3_000; total <= 23_000; total++) {
      expectCoherent(decomposeBudget(total, SHAPE));
    }
  });

  it('clamps construction at zero when the total cannot cover the flat fees', () => {
    // Absurd in practice — the flat fees are ~$2,583 for this shape — but it must be
    // deterministic rather than producing a negative construction fee.
    const b = decomposeBudget(500, SHAPE);
    expect(b.construction).toBe(0);
    expect(b.material).toBe(0);
    expect(b.labor).toBe(0);
    expect(b.permit).toBe(0);
    expect(b.total).toBe(500);
    expectCoherent(b);
  });
});

describe('sliceShares', () => {
  it('always sums to exactly 100.0', () => {
    for (const build of [1_000, 12_345, 99_999, 250_000, 4_500_000]) {
      const shares = sliceShares(composeBudget(build, SHAPE));
      const sum    = Object.values(shares).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 10)).toBe(1000);
    }
  });

  it('covers every slice key and no others', () => {
    const shares = sliceShares(composeBudget(100_000, SHAPE));
    expect(Object.keys(shares).sort()).toEqual(BUDGET_SLICES.map(s => s.key).sort());
  });
});

describe('projectBudget — the confirmed budget wins', () => {
  const FIXTURE: ProjectBudgetSource = {
    country: 'CM', city: 'Douala', num_floors: 2,
    building_type: 'single_family', roof_type: 'long_span_aluminum',
    has_boys_quarters: false, bq_rooms: 0, sqm: 150,
    finish_level: 'standard', budget_usd: null,
  };

  it('decomposes the confirmed budget, not the estimate', () => {
    // The assertion that the dual-total bug is dead: the breakdown must follow
    // budget_usd regardless of what the build parameters would have estimated.
    const b = projectBudget({ ...FIXTURE, budget_usd: 120_000 });
    expect(b.total).toBe(120_000);
    expectCoherent(b);
  });

  it('still reads sqm and floors once a budget is confirmed — for the design fee only', () => {
    // Deliberately NOT the old "ignores sqm entirely" assertion. The design fee is
    // priced per built m², so it must move with the building even when the total does
    // not. The total stays put; construction absorbs the difference.
    const small = projectBudget({ ...FIXTURE, sqm: 60,  num_floors: 1, budget_usd: 90_000 });
    const large = projectBudget({ ...FIXTURE, sqm: 900, num_floors: 6, budget_usd: 90_000 });

    expect(small.total).toBe(90_000);
    expect(large.total).toBe(90_000);
    expect(large.design).toBeGreaterThan(small.design);
    expect(large.construction).toBeLessThan(small.construction);
    expect(small.professional).toBe(large.professional);
    expectCoherent(small);
    expectCoherent(large);
  });

  it('falls back to the engine estimate when no budget is confirmed', () => {
    const b = projectBudget(FIXTURE);
    expect(b.total).toBeGreaterThan(0);
    expectCoherent(b);
  });

  it('prices boys quarters at nothing', () => {
    // The $8,000/room adder had no Bill of Quantity behind it and was ~a fifth of the
    // total. The wizard still asks the question; the answer must not move the money.
    const without = projectBudget(FIXTURE);
    const with4   = projectBudget({ ...FIXTURE, has_boys_quarters: true, bq_rooms: 4 });
    expect(with4).toEqual(without);
  });
});

describe('no component re-derives its own total', () => {
  it('has no `budget_usd ?? budget.total` left in the source', async () => {
    // The exact line shape that caused the bug: a component computing its own total
    // beside a breakdown that came from the engine. `projectBudget` is now the only
    // way to resolve a project's budget, and it does this internally.
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const offenders: string[] = [];
    const PATTERN = /budget_usd\s*\?\?\s*\w*[Bb]udget\.total/;

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (entry.name.endsWith('.test.ts')) continue; // this file states the pattern
        if (PATTERN.test(await readFile(path, 'utf8'))) offenders.push(path);
      }
    }
    await walk('src');

    expect(offenders).toEqual([]);
  });
});
