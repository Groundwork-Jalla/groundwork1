import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBuildingKind } from './document-identity';
import { NO_FLOOR_PLAN_FACTS, type FloorPlanFacts } from '@/lib/budget/extract-bq';
import type { ModelPlanReading } from '@/lib/budget/model-plan-reading';

/**
 * An office plan must not come back as a family home.
 *
 * Reported 7 Nov 2026: a caller uploaded a floor plan for an office and the wizard
 * filed it "Residential · Single Family". He spotted it immediately.
 *
 * Three separate things made that the only possible answer, and fixing any one alone
 * would not have been enough:
 *
 *   1. The prompt asked for dwelling units and storeys. Building type was a bare enum
 *      with no description and no rule, so the model was never really asked.
 *   2. `rooms` could hold bedrooms, bathrooms, kitchens and living rooms, and
 *      `additionalProperties` was false — so an office plan HAD to be described as a
 *      house with no bedrooms. There was nowhere to put twelve offices.
 *   3. `dwellingUnits` had `minimum: 1`, so "this houses nobody" was unsayable.
 *
 * And the one rule meant to catch it — offices >= 2 with no bedrooms — read
 * `officeRooms`, which is filled by a regex over the sheet's TEXT layer. An uploaded
 * photograph has no text layer, which is exactly when the picture is all the evidence
 * there is.
 */

const model = (over: Partial<ModelPlanReading>): ModelPlanReading => ({
  sheets: ['ground_plan'],
  buildingType: null,
  dwellingUnits: null,
  floors: 1,
  grossAreaSqm: 500,
  rooms: { bedrooms: 0, bathrooms: 2, kitchens: 0, livingRooms: 0, offices: 0 },
  confidence: 'high',
  basis: { dwellingUnits: '', floors: '', buildingType: '' },
  ...over,
});

const facts = (over: Partial<FloorPlanFacts>): FloorPlanFacts => ({
  ...NO_FLOOR_PLAN_FACTS, readable: true, ...over,
});

describe('the drawing decides, not the default', () => {
  it('a plan the model calls commercial is not a house', () => {
    const kind = readBuildingKind('', [facts({ model: model({ buildingType: 'commercial' }) })]);
    expect(kind).toEqual({ projectType: 'commercial', buildingType: 'office' });
  });

  it('offices and no bedrooms is an office, even with no building type given', () => {
    // The path that matters for an uploaded image: the model names rooms it can see.
    const kind = readBuildingKind('', [
      facts({
        officeRooms: 12,
        bedrooms: 0,
        model: model({ rooms: { bedrooms: 0, bathrooms: 4, kitchens: 0, livingRooms: 0, offices: 12 } }),
      }),
    ]);
    expect(kind).toEqual({ projectType: 'commercial', buildingType: 'office' });
  });

  it('"no dwellings, no bedrooms, no kitchen" is believed', () => {
    // Only sayable since the schema floor dropped from 1 to 0.
    const kind = readBuildingKind('', [
      facts({ bedrooms: 0, kitchens: 0, model: model({ dwellingUnits: 0 }) }),
    ]);
    expect(kind).toEqual({ projectType: 'commercial', buildingType: 'office' });
  });

  it('but a drawing with bedrooms stays a home, whatever else it says', () => {
    /**
     * The guard on the other side. A house with a study is not an office block, and
     * over-correcting would turn every plan with a desk in it commercial — a worse
     * error, because it reprices the whole build.
     */
    const kind = readBuildingKind('', [
      facts({ bedrooms: 3, kitchens: 1, officeRooms: 2, model: model({ dwellingUnits: 0 }) }),
    ]);
    expect(kind.projectType).toBe('residential');
  });

  it('and a plan that says nothing at all is still a single family home', () => {
    // The default has to stay: most Groundwork projects really are houses.
    expect(readBuildingKind('', [])).toEqual({
      projectType: 'residential', buildingType: 'single_family',
    });
  });
});

describe('the reader can describe a building that is not a home', () => {
  const handler = readFileSync('api/_handlers/read-floor-plan.ts', 'utf8');

  it('rooms has somewhere to put workspace', () => {
    expect(handler).toMatch(/required: \['bedrooms', 'bathrooms', 'kitchens', 'livingRooms', 'offices'\]/);
    expect(handler).toMatch(/offices:\s*\{ type: \['integer', 'null'\], minimum: 0 \}/);
  });

  it('zero dwellings is sayable', () => {
    expect(handler).toMatch(/dwellingUnits: \{ type: \['integer', 'null'\], minimum: 0 \}/);
  });

  it('and building type is actually asked, not just enumerated', () => {
    expect(handler).toMatch(/DECIDE WHAT KIND OF BUILDING THIS IS FIRST, and do not assume a home/);
    expect(handler).toMatch(/A building with no bedrooms and no kitchen is not a dwelling/);
    // A bare enum told the model which words were legal, never what they meant.
    const schema = handler.slice(handler.indexOf('buildingType: {'));
    expect(schema.slice(0, 700)).toMatch(/description:/);
  });

  it('the answer reaches the facts the resolver reads', () => {
    // `officeRooms` comes from a regex over the text layer, which an uploaded
    // photograph does not have. Without this merge the office rule had no input.
    const mpr = readFileSync('src/lib/budget/model-plan-reading.ts', 'utf8');
    expect(mpr).toMatch(/officeRooms: facts\.officeRooms \?\? model\.rooms\.offices/);
    expect(mpr).toMatch(/offices:\s*count\(raw\.rooms\?\.offices\)/);
  });
});
