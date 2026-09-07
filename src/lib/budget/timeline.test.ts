import { describe, expect, it } from 'vitest';
import {
  buildDurationDays, buildDurationMonths, stageDurationDays,
  BUNGALOW_DAYS, DAYS_PER_UPPER_FLOOR,
} from './timeline';

/**
 * The rule Vanessa gave on 4 September 2026: a bungalow is 14 days, each storey above
 * ground adds 42. It replaces `const PREDICTED_DAYS = 196`, which gave a bungalow and an
 * eight-storey block the same seven months — the thing beta testers who had actually
 * built in Cameroon rejected.
 */
describe('buildDurationDays', () => {
  it('gives a bungalow 14 days', () => {
    expect(buildDurationDays(1)).toBe(BUNGALOW_DAYS);
  });

  it('adds 42 days per storey above ground', () => {
    expect(buildDurationDays(2)).toBe(14 + 42);       // 56
    expect(buildDurationDays(3)).toBe(14 + 42 * 2);   // 98
    expect(buildDurationDays(8)).toBe(14 + 42 * 7);   // 308
  });

  it('no longer gives every building the same answer', () => {
    // The whole defect in one assertion.
    expect(buildDurationDays(1)).not.toBe(buildDurationDays(8));
    expect(buildDurationDays(2)).not.toBe(196);
  });

  it('treats a missing or nonsense floor count as a bungalow', () => {
    // Never zero and never negative: there is no such thing as a zero-storey building,
    // and a wizard part-way through should show the smallest honest number rather than
    // a free house.
    expect(buildDurationDays(0)).toBe(BUNGALOW_DAYS);
    expect(buildDurationDays(null)).toBe(BUNGALOW_DAYS);
    expect(buildDurationDays(undefined)).toBe(BUNGALOW_DAYS);
    expect(buildDurationDays(-3)).toBe(BUNGALOW_DAYS);
  });

  it('ignores a fractional floor count rather than pricing half a storey', () => {
    expect(buildDurationDays(2.9)).toBe(buildDurationDays(2));
  });
});

describe('buildDurationMonths', () => {
  it('rounds up, because the professionals bill by the month', () => {
    // A site manager engaged for 56 days is paid for two months, not 1.87.
    expect(buildDurationMonths(1)).toBe(1);    // 14 days
    expect(buildDurationMonths(2)).toBe(2);    // 56 days
    expect(buildDurationMonths(3)).toBe(4);    // 98 days
    expect(buildDurationMonths(8)).toBe(11);   // 308 days
  });

  it('never returns zero, which would make every monthly fee free', () => {
    expect(buildDurationMonths(0)).toBeGreaterThanOrEqual(1);
    expect(buildDurationMonths(null)).toBeGreaterThanOrEqual(1);
  });

  it('is consistent with the day figure it derives from', () => {
    for (const floors of [1, 2, 3, 5, 8, 12]) {
      const days = buildDurationDays(floors);
      expect(buildDurationMonths(floors)).toBe(Math.max(1, Math.ceil(days / 30)));
      expect(days).toBe(BUNGALOW_DAYS + (floors - 1) * DAYS_PER_UPPER_FLOOR);
    }
  });
});

/**
 * The per-stage split.
 *
 * The old `STAGE_DAYS = [14,21,7,14,70,14,14,21,14,7]` was copy-pasted into TimelineTab,
 * tools/stages and tools/milestones, and summed to exactly 196 — the blanket seven months
 * testers rejected. The shape of a programme was never wrong; only its length was, so the
 * weights survive and the total is now derived.
 */
describe('stageDurationDays', () => {
  it('always sums to exactly the build duration', () => {
    // The invariant that matters: a timeline whose stages disagree with its own headline
    // is worse than no timeline. Largest-remainder is what guarantees it.
    for (const floors of [1, 2, 3, 4, 5, 8, 12, 20]) {
      const days = stageDurationDays(floors);
      expect(days.reduce((a, b) => a + b, 0)).toBe(buildDurationDays(floors));
    }
  });

  it('returns one figure per stage', () => {
    expect(stageDurationDays(3)).toHaveLength(10);
  });

  it('never produces a zero-width bar', () => {
    // A 14-day bungalow really does have stages that finish inside a day, but a zero-day
    // bar reads as broken rather than as fast.
    for (const floors of [1, 2, 8]) {
      expect(Math.min(...stageDurationDays(floors))).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps superstructure the longest stage, as the old weights had it', () => {
    const days = stageDurationDays(4);
    const max  = Math.max(...days);
    expect(days.indexOf(max)).toBe(4);
  });

  it('stretches with the building rather than staying fixed', () => {
    const one   = stageDurationDays(1).reduce((a, b) => a + b, 0);
    const eight = stageDurationDays(8).reduce((a, b) => a + b, 0);
    expect(eight).toBeGreaterThan(one);
    expect(one).not.toBe(196);
    expect(eight).not.toBe(196);
  });

  it('survives a missing floor count', () => {
    expect(stageDurationDays(null).reduce((a, b) => a + b, 0)).toBe(BUNGALOW_DAYS);
  });
});
