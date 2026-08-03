import type { TakeoffGeometry, WizardFormData } from '@/types/project';

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
  data: Partial<WizardFormData>,
  g: TakeoffGeometry,
): Quantities {
  const footprint = Math.max(0, data.sqm ?? 0);
  const floors    = Math.max(1, Math.round(data.floors ?? 1));
  const h         = g.storey_height_m;

  // Square-ish plan. Mpangou's take-off states this outright: L 12, W 12, perimeter 48.
  const perimeter = g.perimeter_factor * Math.sqrt(footprint);

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
export function countRooms(data: Partial<WizardFormData>): number {
  const fr = data.floorRooms ?? [];
  const hasFloorRooms = fr.length > 0 &&
    fr.some(f => f.bedrooms + f.livingRooms + f.kitchens + f.bathrooms > 0);

  if (hasFloorRooms) {
    return fr.reduce((s, f) => s + f.bedrooms + f.bathrooms + f.livingRooms + f.kitchens, 0);
  }
  return (data.bedrooms ?? 0) + (data.bathrooms ?? 0)
       + (data.livingRooms ?? 0) + (data.kitchens ?? 0);
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
