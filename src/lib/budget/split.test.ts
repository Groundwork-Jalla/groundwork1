import { describe, expect, it } from 'vitest';
import {
  BUDGET_ROLLUP_PCT, BUDGET_SLICES, BUDGET_SPLIT_PCT,
  projectBudget, rollupBudget, splitBudget,
} from './index';
import type { ProjectBudgetSource } from './index';

/**
 * A construction consultant reviewed the app and found the budget breakdown did not add
 * up to the total printed beside it. Two separate causes, both regression-locked here:
 *
 *   1. Six independent `Math.round(total * pct / 100)` calls drifted the parts up to $2
 *      away from the total.
 *   2. The breakdown was computed from the engine ESTIMATE while the total displayed was
 *      the owner's CONFIRMED `budget_usd`. Whenever those differed — i.e. for anyone who
 *      edited their budget — every line was wrong.
 *
 * Sums are compared in integer CENTS throughout. Six values that are each an exact
 * multiple of $0.01 can still add to 99998.999999999 under IEEE-754, so a float
 * `toBe(total)` here would flake rather than fail honestly.
 */

const cents = (n: number) => Math.round(n * 100);
const sumParts = (b: ReturnType<typeof splitBudget>) =>
  cents(b.materials) + cents(b.labor) + cents(b.engineering)
  + cents(b.permits) + cents(b.contingency) + cents(b.management);

describe('budget split percentages', () => {
  it('sums to exactly 100', () => {
    const total = Object.values(BUDGET_SPLIT_PCT).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('derives the four-way rollup from the six-way split', () => {
    expect(BUDGET_ROLLUP_PCT.fees).toBe(BUDGET_SPLIT_PCT.engineering + BUDGET_SPLIT_PCT.management);
    expect(BUDGET_ROLLUP_PCT.permits).toBe(BUDGET_SPLIT_PCT.permits + BUDGET_SPLIT_PCT.contingency);
    expect(Object.values(BUDGET_ROLLUP_PCT).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('exposes every slice exactly once in BUDGET_SLICES', () => {
    expect(BUDGET_SLICES.map(s => s.key).sort())
      .toEqual(Object.keys(BUDGET_SPLIT_PCT).sort());
    for (const slice of BUDGET_SLICES) {
      expect(slice.pct).toBe(BUDGET_SPLIT_PCT[slice.key]);
    }
  });
});

describe('splitBudget', () => {
  it('parts always sum to the total — property check', () => {
    for (let total = 1; total <= 20_000; total++) {
      const b = splitBudget(total);
      expect(sumParts(b)).toBe(cents(b.total));
    }
  });

  it('parts sum to the total for awkward and large figures', () => {
    for (const total of [85, 1650, 8150, 99_999, 99_999.99, 100_000, 4_500_000, 36_583_000]) {
      const b = splitBudget(total);
      expect(sumParts(b)).toBe(cents(total));
      expect(b.total).toBe(total);
    }
  });

  it('splits a whole-dollar total exactly, with no remainder to distribute', () => {
    // The reported bug: old code produced parts summing to $100,000 for a $99,999 total.
    const b = splitBudget(99_999);
    expect(b.materials).toBe(40_999.59);
    expect(b.labor).toBe(22_999.77);
    expect(b.engineering).toBe(15_999.84);
    expect(b.management).toBe(9_999.90);
    expect(b.contingency).toBe(7_999.92);
    expect(b.permits).toBe(1_999.98);
    expect(sumParts(b)).toBe(cents(99_999));
  });

  it('distributes the remainder when the total carries cents', () => {
    const b = splitBudget(99_999.99);
    expect(sumParts(b)).toBe(cents(99_999.99));
  });

  it('returns zeros for degenerate input rather than leaking NaN', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const b = splitBudget(bad);
      expect(b.total).toBe(0);
      expect(sumParts(b)).toBe(0);
      expect(Object.values(b).every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps the rollup summing to the total too', () => {
    for (const total of [99_999, 100_000, 4_500_000]) {
      const r = rollupBudget(splitBudget(total));
      expect(cents(r.materials) + cents(r.labor) + cents(r.fees) + cents(r.permits))
        .toBe(cents(total));
    }
  });
});

describe('projectBudget — the confirmed budget wins', () => {
  const FIXTURE: ProjectBudgetSource = {
    country: 'CM', city: 'Douala', num_floors: 2,
    building_type: 'single_family', roof_type: 'long_span_aluminum',
    has_boys_quarters: false, bq_rooms: 0, sqm: 150,
    finish_level: 'standard', budget_usd: null,
  };

  it('divides the confirmed budget, not the estimate', () => {
    // The assertion that the dual-total bug is dead: the breakdown must follow
    // budget_usd regardless of what the build parameters would have estimated.
    const b = projectBudget({ ...FIXTURE, budget_usd: 120_000 });
    expect(b.total).toBe(120_000);
    expect(sumParts(b)).toBe(cents(120_000));
  });

  it('ignores sqm and floors entirely once a budget is confirmed', () => {
    const small = projectBudget({ ...FIXTURE, sqm: 60,   num_floors: 1, budget_usd: 90_000 });
    const large = projectBudget({ ...FIXTURE, sqm: 900,  num_floors: 6, budget_usd: 90_000 });
    expect(small).toEqual(large);
  });

  it('falls back to the engine estimate when no budget is confirmed', () => {
    const b = projectBudget(FIXTURE);
    expect(b.total).toBeGreaterThan(0);
    expect(sumParts(b)).toBe(cents(b.total));
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
