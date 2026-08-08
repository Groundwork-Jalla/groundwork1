import { describe, expect, it } from 'vitest';
import { getStageSeed } from './stage-seeds';
import { en } from '@/lib/i18n/en';

/**
 * The stage model is a specification, not an implementation detail — it was signed
 * off by a construction consultant, and the budget shares drive real payment
 * milestones (`payment_milestone_usd = budget_usd * budget_pct / 100`).
 *
 * Three things can break silently:
 *   · Percentages drifting off 100 — every stage amount is then quietly wrong,
 *     and no runtime code checks the sum.
 *   · A stage or substage losing its dictionary entry — `stageLabel()` falls back
 *     to the stored English name, so a French user sees English with no error.
 *   · The count changing — the approved model is exactly 10 stages / 60 substages,
 *     and a merge that drops one would otherwise pass review unnoticed.
 */

const BASE = getStageSeed('residential', 'single_family', 1);

describe('canonical stage model', () => {
  it('has exactly 10 stages, numbered 1..10 in order', () => {
    expect(BASE).toHaveLength(10);
    expect(BASE.map(s => s.stage_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('budget shares total exactly 100%', () => {
    expect(BASE.reduce((sum, s) => sum + s.budget_pct, 0)).toBe(100);
  });

  it('matches the approved budget shares', () => {
    expect(BASE.map(s => s.budget_pct)).toEqual([5, 10, 5, 15, 20, 10, 10, 10, 10, 5]);
  });

  it('has exactly 60 substages, in the approved per-stage counts', () => {
    expect(BASE.map(s => s.substages.length)).toEqual([5, 5, 5, 7, 8, 4, 10, 8, 5, 3]);
    expect(BASE.reduce((n, s) => n + s.substages.length, 0)).toBe(60);
  });

  it('gives every stage and substage a unique, non-empty key', () => {
    const stageKeys = BASE.map(s => s.key);
    expect(new Set(stageKeys).size).toBe(stageKeys.length);
    expect(stageKeys.every(Boolean)).toBe(true);

    // Substage keys are unique *within* a stage. `floorSlab` deliberately differs
    // between Foundation and Structure precisely so they stay distinct globally.
    const subKeys = BASE.flatMap(s => s.substages.map(x => x.key));
    expect(new Set(subKeys).size).toBe(subKeys.length);
    expect(subKeys.every(Boolean)).toBe(true);
  });
});

describe('stage model translations', () => {
  it('names every stage key in the dictionary', () => {
    const missing = BASE
      .map(s => s.key)
      .filter(k => typeof (en.stages as Record<string, unknown>)[k] !== 'string');
    expect(missing).toEqual([]);
  });

  it('names every substage key in the dictionary', () => {
    const missing = BASE
      .flatMap(s => s.substages.map(x => x.key))
      .filter(k => typeof (en.substages as Record<string, unknown>)[k] !== 'string');
    expect(missing).toEqual([]);
  });
});

describe('project type variants', () => {
  it('gives commercial, industrial and mixed-use the canonical pipeline', () => {
    for (const type of ['commercial', 'industrial', 'mixed_use']) {
      const seed = getStageSeed(type, 'office', 1);
      expect(seed.map(s => s.key)).toEqual(BASE.map(s => s.key));
      expect(seed.map(s => s.budget_pct)).toEqual(BASE.map(s => s.budget_pct));
    }
  });

  it('adds to multi-family without changing the stages or the budget split', () => {
    const multi = getStageSeed('residential', 'multi_family', 3);
    expect(multi.map(s => s.key)).toEqual(BASE.map(s => s.key));
    // Extra substages must never move money between stages.
    expect(multi.map(s => s.budget_pct)).toEqual(BASE.map(s => s.budget_pct));
    expect(multi.reduce((n, s) => n + s.substages.length, 0)).toBeGreaterThan(60);
  });

  it('gives multi-family one decking substage per floor', () => {
    for (const floors of [1, 3, 7]) {
      const structure = getStageSeed('residential', 'multi_family', floors)
        .find(s => s.key === 'structureWalls')!;
      const decking = structure.substages.filter(x => x.key === 'floorDecking');
      expect(decking).toHaveLength(floors);
      // The floor number rides as an interpolation param so French can reorder it.
      expect(decking.map(d => d.params?.n)).toEqual(
        Array.from({ length: floors }, (_, i) => i + 1),
      );
    }
  });
});
