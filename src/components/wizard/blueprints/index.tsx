import type { BuildingType, ProjectType, RoofType } from '@/types/project';
import * as D from './drawings';

export type ImageKey = ProjectType | BuildingType | RoofType;

/**
 * One drawing per selectable type. Exhaustive by construction: `Record<ImageKey, …>`
 * means adding a building type to the union is a compile error until it has a sketch,
 * which is the property the old photo map lacked — it silently fell back to a dark
 * panel, and half its entries were hotlinked URLs that could 404 without anyone
 * noticing.
 */
export const BLUEPRINTS: Record<ImageKey, React.ReactNode> = {
  // Project type (step 2)
  residential:                  D.residential,
  commercial:                   D.commercial,
  industrial:                   D.industrial,
  mixed_use:                    D.mixed_use,

  // Residential (step 3)
  single_family:                D.single_family,
  multi_family:                 D.multi_family,
  townhouse:                    D.townhouse,
  semi_detached:                D.semi_detached,

  // Commercial (step 3)
  office:                       D.office,
  retail:                       D.retail,
  warehouse_commercial:         D.warehouse_commercial,
  hotel:                        D.hotel,

  // Industrial (step 3)
  factory:                      D.factory,
  warehouse_industrial:         D.warehouse_industrial,
  industrial_complex:           D.industrial_complex,
  distribution_centre:          D.distribution_centre,

  // Mixed use (step 3)
  mixed_residential_commercial: D.mixed_residential_commercial,
  live_work:                    D.live_work,
  mixed_retail_residential:     D.mixed_retail_residential,
  transit_oriented:             D.transit_oriented,

  // Roof type (step 7) — sections, because the choice is about build-up
  long_span_aluminum:           D.long_span_aluminum,
  clay_tiles:                   D.clay_tiles,
  concrete_flat:                D.concrete_flat,
  shingle:                      D.shingle,
  aluminium_deck:               D.aluminium_deck,
  // Same pitched-roof blueprint as clay until we draw the stone-coated profile.
  stone_coated:                 D.clay_tiles,
};
