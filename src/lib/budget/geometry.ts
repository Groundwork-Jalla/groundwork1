import type { TakeoffGeometry, WizardFormData } from '@/types/project';

/**
 * The wizard's inputs, plus the real dimensions a contractor can supply.
 *
 * Every field is optional and every existing call site passes a `Partial<WizardFormData>`,
 * so this widens the input without touching a single caller. The client wizard will never
 * ask for length and width — it asks for an area and a room count, which is as much as
 * someone planning from the diaspora can reasonably give.
 */
export interface DetailedTakeoffInput extends Partial<WizardFormData> {
  /** Building length in metres, if measured. */
  lengthM?: number;
  /** Building width in metres, if measured. */
  widthM?: number;
  /** Measured perimeter, overriding both the L x W and the sqrt estimate. */
  perimeterM?: number;
}

/**
 * Quantities derived from the wizard's geometry inputs.
 *
 * `footprint` is the GROUND FLOOR area, not the total built area. That distinction
 * matters: the original $640/m² rate was calibrated against a footprint and then had a
 * per-floor uplift applied on top, while the wizard was asking for total floor area —
 * so a G+1 was counted close to twice. See Step8Details.
 */
export interface Quantities {
  footprint: number;
  floors: number;
  builtArea: number;
  perimeter: number;
  rooms: number;
  roomsPerFloor: number;
  /** Wall area on one floor: external envelope + internal partitions. */
  wallPerFloor: number;
  /** Plastered area on one floor — both faces of every wall. */
  plasterPerFloor: number;
  /** Suspended slab volume, m³. */
  slabVolume: number;
  /** Ground-bearing slab volume, m³. */
  groundSlabVolume: number;
}

export function deriveQuantities(
  data: DetailedTakeoffInput,
  g: TakeoffGeometry,
): Quantities {
  const footprint = Math.max(0, data.sqm ?? 0);
  const floors    = Math.max(1, Math.round(data.floors ?? 1));
  const h         = g.storey_height_m;
  const perimeter = derivePerimeter(data, g, footprint);

  const rooms         = countRooms(data);
  const roomsPerFloor = rooms / floors;

  // Internal partition run scales with the rooms on a floor, not with its area — that is
  // what separates Rose (12 rooms on 125 m²) from Buea (9 rooms on 224 m²).
  const partitionRun = roomsPerFloor * g.partition_m_per_room;
  const wallPerFloor = perimeter * h + partitionRun * h;

  return {
    footprint,
    floors,
    builtArea: footprint * floors,
    perimeter,
    rooms,
    roomsPerFloor,
    wallPerFloor,
    plasterPerFloor:  wallPerFloor * 2,
    slabVolume:       footprint * g.slab_thickness_m,
    groundSlabVolume: footprint * g.ground_slab_thickness_m,
  };
}

/**
 * Total habitable rooms. Prefers the per-floor breakdown from Step 5 when present,
 * falling back to the flat totals — the same precedence Step8Details uses.
 */
/**
 * Perimeter, in descending order of how much we actually know:
 *
 *   1. a measured perimeter                    — exact
 *   2. length x width                          — exact for a rectangle, 2(L+W)
 *   3. perimeter_factor x sqrt(area)           — the square-plan assumption
 *
 * (3) is 4 x sqrt(A), which is right only for a square. A 24 x 6 building has the same
 * 144 m2 as a 12 x 12 one and 12 metres more wall — about 8% more blockwork, plaster and
 * paint. That error is invisible in the client wizard, which has no way to know the shape,
 * and unacceptable in a contractor's take-off, which does.
 *
 * Note `perimeter_factor` stays in the model rather than being hardcoded to 4: it is the
 * calibrated square-plan constant, and Mpangou's own take-off states L 12, W 12,
 * perimeter 48, which is exactly 4 x sqrt(144).
 */
function derivePerimeter(
  data: DetailedTakeoffInput,
  g: TakeoffGeometry,
  footprint: number,
): number {
  const measured = data.perimeterM;
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  const L = data.lengthM;
  const W = data.widthM;
  if (typeof L === 'number' && typeof W === 'number'
      && Number.isFinite(L) && Number.isFinite(W) && L > 0 && W > 0) {
    return 2 * (L + W);
  }
  return g.perimeter_factor * Math.sqrt(footprint);
}

export function countRooms(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  if (hasFloorRooms(data)) {
    return fr.reduce((s, f) =>
      s + f.bedrooms + f.bathrooms + f.livingRooms + f.kitchens + (f.offices ?? 0), 0);
  }
  return (data.bedrooms ?? 0) + (data.bathrooms ?? 0)
       + (data.livingRooms ?? 0) + (data.kitchens ?? 0) + (data.offices ?? 0);
}

/**
 * Whether the per-floor breakdown from Step 5 has anything in it.
 *
 * Extracted because Step8Details wrote the same predicate a second time and left
 * bathrooms out of its version, so a floor with only bathrooms counted here and not
 * there. One definition, used by both.
 *
 * `offices` is read with `?? 0`: it was added in Aug 2026 and older `floor_rooms` JSONB
 * rows do not carry the field.
 */
export function hasFloorRooms(data: Partial<WizardFormData>): boolean {
  const fr = data.floorRooms ?? [];
  return fr.length > 0 && fr.some(
    f => f.bedrooms + f.bathrooms + f.livingRooms + f.kitchens + (f.offices ?? 0) > 0,
  );
}

export function countBathrooms(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  if (fr.length > 0 && fr.some(f => f.bathrooms > 0)) {
    return fr.reduce((s, f) => s + f.bathrooms, 0);
  }
  return data.bathrooms ?? 0;
}

export function countKitchens(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  if (fr.length > 0 && fr.some(f => f.kitchens > 0)) {
    return fr.reduce((s, f) => s + f.kitchens, 0);
  }
  return data.kitchens ?? 0;
}

export function countBedrooms(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  if (fr.length > 0 && fr.some(f => f.bedrooms > 0)) {
    return fr.reduce((s, f) => s + f.bedrooms, 0);
  }
  return data.bedrooms ?? 0;
}

export function countLivingRooms(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  if (fr.length > 0 && fr.some(f => f.livingRooms > 0)) {
    return fr.reduce((s, f) => s + f.livingRooms, 0);
  }
  return data.livingRooms ?? 0;
}

/**
 * Doors and windows, as the take-off counts them (BQ items 601 and 605).
 *
 * Nothing asks the client for these — they fall out of the room schedule, the same way
 * the footprint does. The formulas are duplicated from `engine.ts` deliberately NOT at
 * all: this is the single definition, and engine.ts calls it.
 *
 * Surfaced because the beta test script tells testers to choose a number of windows and
 * there is no such control (25 Aug 2026). Windows were always priced; they were simply
 * never shown, so the figure looked missing rather than derived.
 *
 * The +1 on each is the front door and the window that goes with it — a building has one
 * more opening than it has rooms.
 */
export function countOpenings(data: Partial<WizardFormData>): { doors: number; windows: number } {
  return {
    doors:   countRooms(data) + 1,
    windows: countBedrooms(data) + countLivingRooms(data) + 1,
  };
}
