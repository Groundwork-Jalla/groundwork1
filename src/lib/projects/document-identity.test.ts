import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBuildingKind, DEFAULT_BUILDING_KIND } from './document-identity';
import { NO_FLOOR_PLAN_FACTS, type FloorPlanFacts } from '@/lib/budget/extract-bq';

/**
 * Reading the two questions out of the documents instead of asking them.
 *
 * Philip, 28 October: "the main aim is for people that are uploading floor plan,
 * ground plan, bill of quantity. They are not supposed to go through the process of
 * answering what are you building, again."
 *
 * Skipping those screens is only safe because of this file. `projects.project_type`
 * is NOT NULL (migration 003), and the first attempt at skipping them sent a null to
 * the database and was refused at the final click, after everything else had been
 * filled in.
 */

const facts = (over: Partial<FloorPlanFacts> = {}): FloorPlanFacts =>
  ({ ...NO_FLOOR_PLAN_FACTS, readable: true, ...over });

describe('what the documents say is being built', () => {
  it.each([
    ['CONSTRUCTION OF A G+2+TT GUEST HOUSE IN KRIBI', 'commercial', 'hotel'],
    ['PROPOSED HOTEL, DOUALA',                        'commercial', 'hotel'],
    ['BQ FOR A WAREHOUSE AT BONABERI',                'industrial', 'warehouse_industrial'],
    ['ESTIMATE FOR A 2 STOREY OFFICE BLOCK',          'commercial', 'office'],
    ['PROPOSED SHOP AND STORE',                       'commercial', 'retail'],
    ['BLOCK OF 6 APARTMENTS',                         'residential', 'multi_family'],
    ['PROPOSED DUPLEX FOR MR EYONG',                  'residential', 'semi_detached'],
    ['CONSTRUCTION OF A RESIDENTIAL BUILDING',        'residential', 'single_family'],
    ['PROPOSED BUNGALOW, LIMBE',                      'residential', 'single_family'],
  ])('%s', (text, projectType, buildingType) => {
    expect(readBuildingKind(text)).toEqual({ projectType, buildingType });
  });

  it('reads a guest house as a guest house, not as a house', () => {
    // "GUEST HOUSE" contains "house". Rule order is the only thing stopping every
    // guest house in Kribi becoming somebody's family home.
    expect(readBuildingKind('GUEST HOUSE').buildingType).toBe('hotel');
  });

  it('falls back to what nearly every Groundwork project is', () => {
    expect(readBuildingKind('BILL OF QUANTITIES\nFOUNDATION\t2,966,628'))
      .toEqual(DEFAULT_BUILDING_KIND);
    expect(DEFAULT_BUILDING_KIND)
      .toEqual({ projectType: 'residential', buildingType: 'single_family' });
  });

  it('never returns a null type, which is the whole point', () => {
    for (const text of ['', '   ', '12345', 'FOUNDATION']) {
      const kind = readBuildingKind(text);
      expect(kind.projectType, `"${text}"`).toBeTruthy();
      expect(kind.buildingType, `"${text}"`).toBeTruthy();
    }
  });
});

describe('the drawing can overrule the word', () => {
  /**
   * Mr Nas's ground plan is three dwellings in one block — three kitchens, three
   * sitting rooms, three verandas — and its bill calls it nothing in particular.
   * Two of everything a home has one of is not one home.
   */
  const threeUnits = facts({ kitchens: 3, livingRooms: 3, bedrooms: 5, bathrooms: 5 });

  it('counts a plan with several kitchens and sitting rooms as several dwellings', () => {
    expect(readBuildingKind('', [threeUnits]).buildingType).toBe('multi_family');
  });

  it('even when the bill says only "residential"', () => {
    expect(readBuildingKind('RESIDENTIAL BUILDING', [threeUnits]).buildingType)
      .toBe('multi_family');
  });

  it('but does not overrule a building that is not a home at all', () => {
    expect(readBuildingKind('GUEST HOUSE', [threeUnits]).buildingType).toBe('hotel');
  });

  it('and leaves a single-kitchen plan alone', () => {
    const oneHome = facts({ kitchens: 1, livingRooms: 1, bedrooms: 3 });
    expect(readBuildingKind('RESIDENTIAL', [oneHome]).buildingType).toBe('single_family');
  });
});

describe('the columns that cannot be null', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  /**
   * `projects.project_type` and `projects.building_type` are both NOT NULL (003), and
   * the document route does not ask for either — they are read off the plan and the
   * bill instead. But that reading happens ONCE, when the plan question is answered,
   * and a draft saved under an older route can resume past it.
   *
   * Both failed in production, a day apart: `project_type` on 28 October and
   * `building_type` on 29 October, each refused at the final click after everything
   * else had been filled in. So the guarantee lives at the insert — the one point
   * every route passes through — and not only at the seed.
   */
  it('are defaulted where the row is actually written', () => {
    const insert = read('src/lib/supabase/projects.ts');
    expect(insert).toMatch(/project_type:\s+formData\.projectType\s+\?\? DEFAULT_BUILDING_KIND\.projectType/);
    expect(insert).toMatch(/building_type:\s+formData\.buildingType \?\? DEFAULT_BUILDING_KIND\.buildingType/);
  });

  it('and the roof, which the document route also skips', () => {
    expect(read('src/lib/supabase/projects.ts'))
      .toMatch(/roof_type:\s+formData\.roofType \?\? 'stone_coated'/);
  });

  it('the fallback is a real value for both columns, not an empty string', () => {
    expect(DEFAULT_BUILDING_KIND.projectType).toBeTruthy();
    expect(DEFAULT_BUILDING_KIND.buildingType).toBeTruthy();
  });
});
