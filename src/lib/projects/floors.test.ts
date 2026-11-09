import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_FLOORS, MIN_FLOORS, clampFloors, emptyFloor, floorCountPatch, floorTotals, resizeFloors,
} from './floors';
import type { FloorRoom } from '@/types/project';

/**
 * Correcting the floor count must not cost you the rooms.
 *
 * Philip, 9 Nov 2026: the floor count has to be editable on the summary. Step 4 had
 * always handled a change by clearing `floorRooms` outright, which is harmless there —
 * the rooms are asked for on the very next screen. On the SUMMARY the rooms are already
 * entered, and the same reset would throw away the longest piece of work in the wizard
 * because somebody corrected "2" to "3" at the end of it.
 *
 * The other half of this is arithmetic rather than courtesy: `bedrooms`, `bathrooms` and
 * the rest are stored BOTH as per-floor rows and as cross-floor totals, and the budget
 * engine prices the totals. Resize one without recomputing the other and the quote is
 * for a different building than the one on screen.
 */

const floor = (i: number, beds: number, baths = 0): FloorRoom =>
  ({ ...emptyFloor(i), bedrooms: beds, bathrooms: baths });

describe('the count itself', () => {
  it('stays inside the range the stepper offers', () => {
    expect(clampFloors(0)).toBe(MIN_FLOORS);
    expect(clampFloors(-4)).toBe(MIN_FLOORS);
    expect(clampFloors(999)).toBe(MAX_FLOORS);
    expect(clampFloors(3)).toBe(3);
  });

  it('survives what a number input can actually produce', () => {
    // An empty box reads as NaN, and a pasted "2.7" as a float. Neither may become a
    // floor count, and neither may become `undefined` further down.
    expect(clampFloors(NaN)).toBe(MIN_FLOORS);
    expect(clampFloors(Number('')))
      .toBe(MIN_FLOORS); // Number('') is 0
    expect(clampFloors(2.7)).toBe(2);
  });
});

describe('resizing keeps what was entered', () => {
  const existing = [floor(0, 2, 1), floor(1, 3, 2)];

  it('growing adds empty floors and leaves the others alone', () => {
    const out = resizeFloors(4, existing);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ floor: 0, bedrooms: 2, bathrooms: 1 });
    expect(out[1]).toMatchObject({ floor: 1, bedrooms: 3, bathrooms: 2 });
    expect(out[2]).toEqual(emptyFloor(2));
    expect(out[3]).toEqual(emptyFloor(3));
  });

  it('shrinking drops only the floors above the new count', () => {
    const out = resizeFloors(1, existing);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ bedrooms: 2, bathrooms: 1 });
  });

  it('a shrink then a grow does not bring the old rooms back', () => {
    // The patch is applied to the context each time, so the dropped floor is gone for
    // good. Asserting it because the alternative — resurrecting rooms somebody removed
    // — would be a far stranger bug to diagnose than losing them.
    const shrunk = resizeFloors(1, existing);
    const regrown = resizeFloors(2, shrunk);
    expect(regrown[1]).toEqual(emptyFloor(1));
  });

  it('fills in fields that predate the row', () => {
    // `offices` arrived in Aug 2026. A draft saved before it has rows without the key,
    // and `undefined` there renders a blank stepper and NaNs every total below it.
    const old = [{ floor: 0, bedrooms: 1, bathrooms: 1, livingRooms: 1, kitchens: 1 } as FloorRoom];
    expect(resizeFloors(1, old)[0].offices).toBe(0);
  });

  it('ignores a stored floor index that is out of range', () => {
    // Rows are matched by their own `floor` value, not by position, so a gap or a
    // leftover high index cannot shift everything else by one.
    const gappy = [floor(0, 1), floor(5, 9)];
    const out = resizeFloors(2, gappy);
    expect(out.map(f => f.bedrooms)).toEqual([1, 0]);
  });
});

describe('the totals follow the floors', () => {
  it('sums every room type across floors', () => {
    expect(floorTotals([floor(0, 2, 1), floor(1, 3, 2)]))
      .toEqual({ bedrooms: 5, bathrooms: 3, livingRooms: 0, kitchens: 0, offices: 0 });
  });

  it('a patch changes the count, the rows and the totals together', () => {
    // One `update()` call, so no render can see the new floor count against the old
    // totals — which is the window in which the budget would be priced wrongly.
    const patch = floorCountPatch(1, [floor(0, 2, 1), floor(1, 3, 2)]);
    expect(patch.floors).toBe(1);
    expect(patch.floorRooms).toHaveLength(1);
    expect(patch.bedrooms).toBe(2);
    expect(patch.bathrooms).toBe(1);
  });

  it('and the totals always equal the sum of the rows it returns', () => {
    for (const n of [1, 2, 3, 7, 20, 25]) {
      const patch = floorCountPatch(n, [floor(0, 2, 1), floor(1, 3, 2), floor(2, 1, 1)]);
      expect(patch.bedrooms).toBe(floorTotals(patch.floorRooms).bedrooms);
      expect(patch.floorRooms).toHaveLength(clampFloors(n));
    }
  });
});

describe('every screen that changes the floor count goes through it', () => {
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');

  it('the step 4 stepper does', () => {
    const step = src('src/components/wizard/steps/Step4Floors.tsx');
    expect(step).toMatch(/update\(floorCountPatch\(n, data\.floorRooms \?\? \[\]\)\)/);
    // The old reset is the thing being guarded against coming back.
    expect(step).not.toMatch(/floorRooms: \[\]/);
  });

  it('the summary field does', () => {
    const step = src('src/components/wizard/steps/Step9Summary.tsx');
    expect(step).toMatch(/update\(floorCountPatch\(Number\(raw\), data\.floorRooms \?\? \[\]\)\)/);
    // And it is rendered in BOTH flows, not only when extraction failed.
    expect(step.match(/<FloorsField/g) ?? []).toHaveLength(2);
  });

  it('and step 5 shares the same resize, rather than keeping its own', () => {
    const step = src('src/components/wizard/steps/Step5Rooms.tsx');
    expect(step).toMatch(/const initFloors = resizeFloors;/);
    expect(step).toMatch(/const computeTotals = floorTotals;/);
  });
});
