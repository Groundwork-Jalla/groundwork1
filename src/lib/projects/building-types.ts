import type { BuildingType, ProjectType } from '@/types/project';

export const BUILDING_TYPES_BY_PROJECT: Record<ProjectType, BuildingType[]> = {
  residential: ['single_family', 'multi_family', 'townhouse', 'semi_detached'],
  commercial: ['office', 'retail', 'warehouse_commercial', 'hotel'],
  industrial: ['factory', 'warehouse_industrial', 'industrial_complex', 'distribution_centre'],
  mixed_use: ['mixed_residential_commercial', 'live_work', 'mixed_retail_residential', 'transit_oriented'],
};

/** Only classification changes: the document's confirmed amount and FX stay intact. */
export function buildingTypePatch(value: string): { projectType: ProjectType; buildingType: BuildingType } | null {
  for (const [projectType, values] of Object.entries(BUILDING_TYPES_BY_PROJECT)) {
    if (values.includes(value as BuildingType)) return { projectType: projectType as ProjectType, buildingType: value as BuildingType };
  }
  return null;
}
