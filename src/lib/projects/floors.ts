import type { FloorRoom } from '@/types/project';

// =========================================================
// Changing the floor count without losing the rooms.
//
// The floor count is asked on step 4 and the rooms on step 5, so for most of the
// wizard's life the two could only be edited in that order, and step 4 simply cleared
// `floorRooms` whenever the count moved. That is correct there — the user is about to
// fill the rooms in next.
//
// Philip, 9 Nov 2026: the floor count must be editable on the SUMMARY. By then the
// rooms have been entered, and clearing them would silently throw away the longest
// piece of work in the wizard because somebody corrected "2" to "3" at the end. So the
// list is RESIZED instead: existing floors keep what they hold, new ones start empty,
// and floors above the new count are dropped.
//
// Kept here rather than inside either step because both now change the same two fields
// and the totals have to follow. Two copies of this is how `bedrooms` stops agreeing
// with the sum of the floors — and the sum of the floors is what the budget engine
// actually prices.
// =========================================================

export const MIN_FLOORS = 1;
export const MAX_FLOORS = 20;

/** `floor` is 0-based: 0 is the ground floor. */
export const emptyFloor = (i: number): FloorRoom =>
  ({ floor: i, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0 });

export function clampFloors(n: number): number {
  if (!Number.isFinite(n)) return MIN_FLOORS;
  return Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.trunc(n)));
}

/**
 * `count` floors, each carrying whatever was already recorded for it.
 *
 * The spread over an empty floor is what keeps a row written before `offices` existed
 * from rendering a blank stepper and NaN-ing the totals.
 */
export function resizeFloors(count: number, existing: FloorRoom[]): FloorRoom[] {
  return Array.from({ length: clampFloors(count) }, (_, i) => {
    const found = existing.find(f => f.floor === i);
    return found ? { ...emptyFloor(i), ...found } : emptyFloor(i);
  });
}

/** The cross-floor room totals. What the budget engine prices, so they must follow. */
export function floorTotals(floors: FloorRoom[]) {
  return floors.reduce(
    (acc, f) => ({
      bedrooms:    acc.bedrooms    + (f.bedrooms    ?? 0),
      bathrooms:   acc.bathrooms   + (f.bathrooms   ?? 0),
      livingRooms: acc.livingRooms + (f.livingRooms ?? 0),
      kitchens:    acc.kitchens    + (f.kitchens    ?? 0),
      offices:     acc.offices     + (f.offices     ?? 0),
    }),
    { bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0 },
  );
}

/**
 * Everything that has to change when the floor count does, as one patch.
 *
 * Returned rather than applied so the caller decides when to commit it, and so the
 * whole change reaches `update()` in a single call — `floors` and `floorRooms` landing
 * in two renders is what lets a step read one against the other mid-flight.
 */
export function floorCountPatch(next: number, existing: FloorRoom[]) {
  const floors = clampFloors(next);
  const floorRooms = resizeFloors(floors, existing);
  return { floors, floorRooms, ...floorTotals(floorRooms) };
}
