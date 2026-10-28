import type { FloorRoom, WizardFormData } from '@/types/project';

export interface WizardConfirmationDraft {
  raw: string;
  alreadyStarted: boolean;
  described: string;
  stageOverride: number | null;
  /** A File cannot be restored; this flag asks the user to attach it again. */
  hadAttachment: boolean;
}

export interface WizardDraft {
  version: 1;
  step: number;
  direction: 'forward' | 'back';
  data: WizardFormData;
  confirmation?: WizardConfirmationDraft;
  /**
   * The floor plan and the bill of quantities were uploaded, and then a reload threw
   * the Files away.
   *
   * The same problem as `hadAttachment` above, and the same answer — remember that it
   * happened. Without it the wizard sees no documents, concludes the architecture-plan
   * question was never answered, and draws that question over whatever step the person
   * had reached. They refresh on the summary and land back on "Does your project have
   * an architecture plan?", with the five-screen route collapsed back to nine.
   *
   * Reported by Ruth on 28 October: partners "have been complaining stylishly", and a
   * contractor refreshed on a call and "it took him to the very beginning".
   */
  planDocumentsAttached?: boolean;
}

const PROJECT_TYPES = ['residential', 'commercial', 'industrial', 'mixed_use'];
const BUILDING_TYPES = [
  'single_family', 'multi_family', 'townhouse', 'semi_detached',
  'office', 'retail', 'warehouse_commercial', 'hotel',
  'factory', 'warehouse_industrial', 'industrial_complex', 'distribution_centre',
  'mixed_residential_commercial', 'live_work', 'mixed_retail_residential', 'transit_oriented',
];
const ROOF_TYPES = ['long_span_aluminum', 'clay_tiles', 'shingle', 'stone_coated', 'concrete_flat', 'aluminium_deck'];
const ROOM_FIELDS = ['bedrooms', 'bathrooms', 'livingRooms', 'kitchens', 'offices'] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 10000): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown, min = 0, max = 1000000): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const choice = (value: unknown, values: string[]): boolean => typeof value === 'string' && values.includes(value);

/** Accept only the fields the project form actually uses, never arbitrary stored data. */
function formData(value: unknown): WizardFormData | null {
  if (!record(value)
    || typeof value.country !== 'string' || (value.country !== '' && !/^[A-Z]{2}$/.test(value.country))
    || !(value.projectType === null || choice(value.projectType, PROJECT_TYPES))
    || !(value.buildingType === null || choice(value.buildingType, BUILDING_TYPES))
    || !count(value.floors, 1, 20)
    || !ROOM_FIELDS.every(field => count(value[field]))
    || !Array.isArray(value.floorRooms) || value.floorRooms.length > value.floors
    || typeof value.hasBoysQuarters !== 'boolean' || !count(value.bqRooms)
    || !(value.roofType === null || choice(value.roofType, ROOF_TYPES))
    || !text(value.projectName) || !text(value.city)
    || typeof value.sqm !== 'number' || !Number.isFinite(value.sqm) || value.sqm < 0
    || !choice(value.finishLevel, ['standard', 'premium', 'luxury'])
    || !text(value.targetStartDate, 100)
    || !(value.targetEndDate === undefined || text(value.targetEndDate, 100))
    || !choice(value.tier, ['', 'self_verify', 'jalla_verify', 'jalla_management'])
    || !count(value.previewActiveFloor)) return null;

  const floorRooms: FloorRoom[] = [];
  const seenFloors = new Set<number>();
  for (const floor of value.floorRooms) {
    if (!record(floor) || !count(floor.floor, 0, value.floors - 1)
      || seenFloors.has(floor.floor) || !ROOM_FIELDS.every(field => count(floor[field]))) return null;
    seenFloors.add(floor.floor);
    floorRooms.push({
      floor: floor.floor,
      bedrooms: floor.bedrooms as number, bathrooms: floor.bathrooms as number,
      livingRooms: floor.livingRooms as number, kitchens: floor.kitchens as number,
      offices: floor.offices as number,
    });
  }

  return {
    country: value.country,
    projectType: value.projectType as WizardFormData['projectType'],
    buildingType: value.buildingType as WizardFormData['buildingType'],
    floors: value.floors,
    bedrooms: value.bedrooms as number, bathrooms: value.bathrooms as number,
    livingRooms: value.livingRooms as number, kitchens: value.kitchens as number,
    offices: value.offices as number,
    floorRooms, hasBoysQuarters: value.hasBoysQuarters, bqRooms: value.bqRooms,
    roofType: value.roofType as WizardFormData['roofType'],
    projectName: value.projectName, city: value.city, sqm: value.sqm,
    finishLevel: value.finishLevel as WizardFormData['finishLevel'],
    targetStartDate: value.targetStartDate,
    targetEndDate: text(value.targetEndDate, 100) ? value.targetEndDate : '',
    tier: value.tier as WizardFormData['tier'],
    // Tolerated rather than required: a draft saved before the architecture-plan
    // question existed has neither field, and discarding somebody's half-finished
    // wizard over a field that did not exist when they started it would be worse than
    // asking the question again.
    hasArchitecturePlan: typeof value.hasArchitecturePlan === 'boolean'
      ? value.hasArchitecturePlan : null,
    bqTotalUsd: typeof value.bqTotalUsd === 'number' && Number.isFinite(value.bqTotalUsd)
      && value.bqTotalUsd > 0 ? value.bqTotalUsd : null,
    previewActiveFloor: Math.min(value.previewActiveFloor, value.floors - 1),
  };
}

function confirmation(value: unknown): WizardConfirmationDraft | null {
  if (!record(value) || !text(value.raw, 1000) || typeof value.alreadyStarted !== 'boolean'
    || !text(value.described, 20000) || !(value.stageOverride === null || count(value.stageOverride, 1, 10))
    || typeof value.hadAttachment !== 'boolean') return null;
  return {
    raw: value.raw, alreadyStarted: value.alreadyStarted, described: value.described,
    stageOverride: value.stageOverride, hadAttachment: value.hadAttachment,
  };
}

function snapshot(value: unknown): WizardDraft | null {
  if (!record(value) || value.version !== 1 || !count(value.step, 1, 11)
    || !(value.direction === 'forward' || value.direction === 'back')) return null;
  const data = formData(value.data);
  if (!data) return null;
  const savedConfirmation = value.confirmation === undefined ? undefined : confirmation(value.confirmation);
  if (savedConfirmation === null) return null;
  // Absent in drafts written before this existed, which is a valid draft and not a
  // reason to throw the whole thing away — undefined simply means "we do not know".
  if (!(value.planDocumentsAttached === undefined
     || typeof value.planDocumentsAttached === 'boolean')) return null;
  return { version: 1, step: value.step, direction: value.direction, data,
    ...(savedConfirmation ? { confirmation: savedConfirmation } : {}),
    ...(value.planDocumentsAttached ? { planDocumentsAttached: true } : {}),
  };
}

/** Keys are supplied only by the opted-in contractor flow and include both user ids. */
export function readWizardDraft(key?: string): WizardDraft | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? snapshot(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function writeWizardDraft(key: string | undefined, value: WizardDraft): void {
  if (!key) return;
  try {
    const safe = snapshot(value);
    if (safe) sessionStorage.setItem(key, JSON.stringify(safe));
  } catch { /* Browser storage is optional; the live wizard still works. */ }
}

export function clearWizardDraft(key?: string): void {
  if (!key) return;
  try { sessionStorage.removeItem(key); } catch { /* Browser storage is optional. */ }
}
