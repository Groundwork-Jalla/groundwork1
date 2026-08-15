import { describe, expect, it } from 'vitest';
import { estimateSqm } from './Step8Details';
import { WIZARD_DEFAULT_DATA, type WizardFormData } from '@/types/project';

/**
 * The footprint suggestion is the single most load-bearing number in the wizard: it is
 * `data.sqm`, which the take-off multiplies by every rate it holds. A 20% error here is a
 * 20% error in the budget, and nothing downstream can detect it.
 *
 * Vanessa Gwanvoma's review put a 5-bed 2-storey semi-detached at 120 sqm/floor. The
 * benchmarks were recalibrated to hit that (Phase B3, Aug 2026) — these lock the result
 * so a future tweak to one room size cannot quietly move it back.
 *
 * It returns the GROUND FLOOR FOOTPRINT, not the combined area of every floor. That
 * distinction has bitten before: the function used to return combined area while the
 * engine treated the same field as a footprint and added a per-floor uplift on top, so a
 * G+1 was counted close to twice.
 */

const house = (over: Partial<WizardFormData>): WizardFormData =>
  ({ ...WIZARD_DEFAULT_DATA, ...over });

describe('footprint estimate', () => {
  it("matches Vanessa's benchmark: 5-bed 2-storey semi-detached is ~120 sqm/floor", () => {
    const e = estimateSqm(house({
      bedrooms: 5, bathrooms: 5, livingRooms: 2, kitchens: 1,
      floors: 2, buildingType: 'semi_detached',
    }))!;
    expect(e.typical).toBe(120);
  });

  it('returns a per-floor footprint, not the combined built area', () => {
    const rooms = { bedrooms: 4, bathrooms: 3, livingRooms: 2, kitchens: 1 } as const;
    const one = estimateSqm(house({ ...rooms, floors: 1 }))!;
    const two = estimateSqm(house({ ...rooms, floors: 2 }))!;

    // Same rooms spread over two storeys is half the footprint, not the same footprint.
    expect(two.typical).toBeLessThan(one.typical);
    expect(two.typical).toBeCloseTo(one.typical / 2, -1);
  });

  it('counts offices toward the footprint', () => {
    const base = { bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1, floors: 1 } as const;
    const without = estimateSqm(house(base))!;
    const with2   = estimateSqm(house({ ...base, offices: 2 }))!;
    expect(with2.typical).toBeGreaterThan(without.typical);
  });

  it('reads the per-floor breakdown when Step 5 filled one in', () => {
    const flat = estimateSqm(house({
      bedrooms: 4, bathrooms: 2, livingRooms: 1, kitchens: 1, floors: 2,
    }))!;
    const perFloor = estimateSqm(house({
      floors: 2,
      floorRooms: [
        { floor: 0, bedrooms: 1, bathrooms: 1, livingRooms: 1, kitchens: 1, offices: 0 },
        { floor: 1, bedrooms: 3, bathrooms: 1, livingRooms: 0, kitchens: 0, offices: 0 },
      ],
    }))!;
    expect(perFloor.typical).toBe(flat.typical);
  });

  it('counts a floor holding only bathrooms', () => {
    // The old local predicate omitted bathrooms, so this breakdown was treated as empty
    // and the function silently fell back to the flat totals — which are all zero here.
    const e = estimateSqm(house({
      bedrooms: 3, livingRooms: 1, floors: 2,
      floorRooms: [
        { floor: 0, bedrooms: 3, bathrooms: 0, livingRooms: 1, kitchens: 1, offices: 0 },
        { floor: 1, bedrooms: 0, bathrooms: 2, livingRooms: 0, kitchens: 0, offices: 0 },
      ],
    }))!;
    // The same building with floor 1 left empty must come out smaller — i.e. those two
    // bathrooms actually contributed area rather than being skipped.
    const emptyUpper = estimateSqm(house({
      bedrooms: 3, livingRooms: 1, floors: 2,
      floorRooms: [
        { floor: 0, bedrooms: 3, bathrooms: 0, livingRooms: 1, kitchens: 1, offices: 0 },
        { floor: 1, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0 },
      ],
    }))!;
    expect(e.typical).toBeGreaterThan(emptyUpper.typical);
  });

  it('tolerates floor_rooms rows written before `offices` existed', () => {
    // JSONB, so old rows genuinely lack the key. `?? 0` everywhere, not `undefined`
    // leaking into arithmetic and producing NaN.
    const legacy = [{ floor: 0, bedrooms: 3, bathrooms: 2, livingRooms: 1, kitchens: 1 }];
    const e = estimateSqm(house({
      floors: 1,
      floorRooms: legacy as WizardFormData['floorRooms'],
    }))!;
    expect(Number.isFinite(e.typical)).toBe(true);
    expect(e.typical).toBeGreaterThan(0);
  });

  it('returns null before there is anything to size', () => {
    expect(estimateSqm(house({}))).toBeNull();
  });
});
