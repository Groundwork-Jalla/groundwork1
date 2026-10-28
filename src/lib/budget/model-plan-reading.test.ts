import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeModelReading, type ModelPlanReading } from './model-plan-reading';
import { readFloorPlanFacts, NO_FLOOR_PLAN_FACTS, type FloorPlanFacts } from './extract-bq';
import { MR_NAS_GROUND_PLAN } from './__fixtures__/floor-plans';

/**
 * Looking at a drawing, on top of reading its text.
 *
 * Mr Nas's ground plan is three separate dwellings in one block. The extractor counts
 * its five bedrooms and measures its 218.88 m² and cannot possibly tell you that,
 * because no string on the sheet says it. A model looking at the layout can.
 *
 * Which makes the ranking the thing to protect. A figure the drawing STATES is the
 * architect's claim; a label we COUNTED is a fact about the sheet; this is a reading
 * of a picture. The first two must never lose to the third — the budget is built from
 * them, and a stage payment that moved because a model saw a drawing differently from
 * the architect who drew it would be very hard to explain to the person owed it.
 */

const facts = (over: Partial<FloorPlanFacts> = {}): FloorPlanFacts =>
  ({ ...NO_FLOOR_PLAN_FACTS, readable: true, ...over });

const reading = (over: Partial<ModelPlanReading> = {}): ModelPlanReading => ({
  sheets: ['ground_plan'],
  buildingType: 'apartment_block',
  dwellingUnits: 3,
  floors: 2,
  grossAreaSqm: 437.75,
  rooms: { bedrooms: 5, bathrooms: 5, kitchens: 3, livingRooms: 3 },
  confidence: 'high',
  basis: {
    dwellingUnits: 'three sitting rooms, three kitchens, three separate entrances',
    floors: 'staircase on the ground plan; no upper sheet supplied',
    buildingType: 'three repeated identical units under one roof',
  },
  ...over,
});

describe('the model fills holes and overrules nothing', () => {
  it('never replaces a storey count the drawing states', () => {
    const merged = mergeModelReading(facts({ floors: 4 }), reading({ floors: 2 }));
    expect(merged.floors).toBe(4);
  });

  it('never replaces a room count we got off the labels', () => {
    const merged = mergeModelReading(
      facts({ bedrooms: 5, kitchens: 3 }),
      reading({ rooms: { bedrooms: 9, bathrooms: 9, kitchens: 9, livingRooms: 9 } }));
    expect(merged.bedrooms).toBe(5);
    expect(merged.kitchens).toBe(3);
  });

  it('never replaces an area the drawing states', () => {
    const merged = mergeModelReading(facts({ areaSqm: 300 }), reading({ grossAreaSqm: 999 }));
    expect(merged.areaSqm).toBe(300);
  });

  it('fills a storey count nothing else could establish', () => {
    // The real case: a ground plan with a staircase. The extractor refuses to guess,
    // and refusing is right — but a model given the whole set can often say.
    const merged = mergeModelReading(facts({ staircase: true }), reading({ floors: 2 }));
    expect(merged.floors).toBe(2);
    expect(merged.staircase).toBe(true);
  });

  it('leaves the extractor untouched when there is no reading', () => {
    const base = facts({ floors: 3, bedrooms: 5 });
    expect(mergeModelReading(base, null)).toEqual(base);
  });

  it('keeps the reading whole and beside the facts, not merged into them', () => {
    // `dwellingUnits` has no field of its own on the extractor's side because nothing
    // the extractor does could ever produce one. It lives here or nowhere.
    const merged = mergeModelReading(facts(), reading());
    expect(merged.model?.dwellingUnits).toBe(3);
    expect(merged.model?.buildingType).toBe('apartment_block');
    expect(merged.model?.basis.dwellingUnits).toMatch(/three separate entrances/);
  });

  it('never invents a footprint — that one is measured or absent', () => {
    // The footprint comes off the dimension chain and feeds `sqm` in the wizard. The
    // model is not given a route into it; its own figure lands in `areaSqm`.
    const merged = mergeModelReading(facts(), reading({ grossAreaSqm: 500 }));
    expect(merged.footprintSqm).toBeNull();
  });
});

describe("on Mr Nas's real ground plan", () => {
  const extracted = { readable: true, ...readFloorPlanFacts(MR_NAS_GROUND_PLAN) };

  it('the counted rooms survive the merge intact', () => {
    const merged = mergeModelReading(extracted, reading({
      rooms: { bedrooms: 2, bathrooms: 2, kitchens: 1, livingRooms: 1 },
    }));
    expect(merged.bedrooms).toBe(5);
    expect(merged.bathrooms).toBe(5);
    expect(merged.kitchens).toBe(3);
    expect(merged.livingRooms).toBe(3);
  });

  it('the measured footprint survives it too', () => {
    const merged = mergeModelReading(extracted, reading({ grossAreaSqm: 99 }));
    expect(merged.footprintSqm).toBeCloseTo(218.88, 1);
  });

  it('and the thing counting could never reach arrives', () => {
    expect(mergeModelReading(extracted, reading()).model?.dwellingUnits).toBe(3);
  });
});

describe('the endpoint it talks to', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const handler = read('api/_handlers/read-floor-plan.ts');

  it('is an action, not a thirteenth serverless function', () => {
    // Vercel's Hobby plan allows 12 files under api/ and 11 are in use. See the header
    // of api/events.ts for the day every deployment failed silently over this.
    const events = read('api/events.ts');
    expect(events).toContain("'read-floor-plan': readFloorPlan");
    expect(events).toContain("from './_handlers/read-floor-plan.js'");
  });

  it('refuses a caller who is not signed in', () => {
    // It spends money per call on our key. Without this it is a button a stranger can
    // hold down.
    expect(handler).toMatch(/const user = await requireUser\(req\);/);
    expect(handler).toMatch(/if \(!user\) \{[\s\S]{0,80}401/);
  });

  it('treats a missing key as "no reading", not as a failure', () => {
    // The wizard has to work on a deployment without the key — every local one, until
    // somebody sets it.
    expect(handler).toMatch(/if \(!apiKey\)/);
    expect(handler).toMatch(/available: false, reason: 'not-configured'/);
  });

  it('answers 200 with no reading when the model call fails', () => {
    // The extractor's figures are already on screen and are what the budget uses. A
    // model that is down must not become an error the person has to get past.
    expect(handler).toMatch(/available: false, reason: 'error'/);
    expect(handler).toMatch(/catch \(error\)/);
  });

  it('pins the model, so a plan cannot read differently next week', () => {
    expect(handler).toMatch(/const MODEL = 'claude-opus-5-5'/);
  });

  it('caps the pages it will send, because each one is billed', () => {
    expect(handler).toMatch(/const MAX_PAGES = 4/);
    expect(handler).toMatch(/pages\.slice\(0, MAX_PAGES\)/);
  });

  it('asks for a schema rather than prose it would have to parse out', () => {
    expect(handler).toMatch(/format: \{ type: 'json_schema', schema: SCHEMA \}/);
    expect(handler).toMatch(/additionalProperties: false/);
  });

  it('tells the model that a null is a real answer', () => {
    // The whole value of this over a guess. A model that fills every field to look
    // helpful is worse than one that says it cannot tell.
    expect(handler).toMatch(/Use null wherever the drawing does not tell you/);
  });

  it('parses the JSON rather than matching strings in it', () => {
    expect(handler).toMatch(/JSON\.parse\(text\)/);
  });
});

describe('the client never lets this break an upload', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('the model read is not awaited before the extractor shows its answer', () => {
    // Inside the function, not the file — the import sits at the top and would make
    // any whole-file comparison pass or fail for the wrong reason.
    const gate = read('src/components/wizard/ArchitecturePlanGate.tsx');
    const body = gate.slice(gate.indexOf('async function inspectFloorPlans'));
    const extract = body.indexOf('setFloorPlanFacts(facts)');
    const look = body.indexOf('readPlanWithModel');
    expect(extract, 'the extractor must publish its facts').toBeGreaterThan(-1);
    expect(look, 'the model read must follow it').toBeGreaterThan(extract);
  });

  it('and does not gate Continue', () => {
    // `scanning` disables it; `looking` deliberately does not. Everything the next
    // step needs is already in hand by then.
    const gate = read('src/components/wizard/ArchitecturePlanGate.tsx');
    expect(gate).toMatch(/disabled=\{!floorPlans\.length \|\| !bq \|\| scanning\}/);
    expect(gate).not.toMatch(/\|\| looking\}/);
  });

  it('swallows its own failures', () => {
    const client = read('src/lib/budget/model-plan-reading.ts');
    expect(client).toMatch(/catch \{\s*return null;\s*\}/);
  });

  it('paints the page white before rendering a drawing onto it', () => {
    // A plan is line work on nothing. Without a ground the transparent areas come out
    // black and the model is handed an inverted sheet.
    const client = read('src/lib/budget/model-plan-reading.ts');
    expect(client).toMatch(/fillStyle = '#ffffff'/);
    expect(client).toMatch(/fillRect\(0, 0, canvas\.width, canvas\.height\)/);
  });
});
