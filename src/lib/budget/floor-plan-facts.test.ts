import { describe, expect, it } from 'vitest';
import { readFloorPlanFacts, readStatedFloors } from './extract-bq';
import { MR_NAS_GROUND_PLAN } from './__fixtures__/floor-plans';

/**
 * Reading an architect's floor plan.
 *
 * The first version of this looked for sentences — "5 bedrooms", "Floor area: 219 m²"
 * — and a real drawing contains none. Mr Nas's ground plan went through the wizard on
 * 28 October with a perfectly good AutoCAD text layer and reported "floor count not
 * extracted · area not extracted" beside a bill of quantities that had read fine.
 *
 * So the fixture these run against is the real thing, captured through the same
 * pdf.js reader production uses. A hand-typed sample is what produced the bug: it is
 * easy to invent a plan that says "3 bedrooms" somewhere, and none of them do.
 */

const plan = readFloorPlanFacts(MR_NAS_GROUND_PLAN);

describe("Mr Nas's ground plan, which used to read as blank", () => {
  it('counts the rooms the drawing labels', () => {
    // Checked against the drawing: three units, of 2 + 2 + 1 bedrooms.
    expect(plan.bedrooms).toBe(5);
    expect(plan.bathrooms).toBe(5);
    expect(plan.livingRooms).toBe(3);
    expect(plan.kitchens).toBe(3);
  });

  it('counts a label that runs into its instance number', () => {
    // "Bed Room2" and "M.Bed Room1" are four of the five. A word boundary after
    // "room" rejects all four, which is exactly how this plan read as having none.
    expect(plan.evidence.bedrooms).toEqual(
      expect.arrayContaining(['Bed Room', 'M.Bed Room']));
  });

  it('derives the footprint from the overall dimensions', () => {
    // 21.25 m x 10.30 m, each written on both of its opposite edges.
    expect(plan.footprintSqm).toBeCloseTo(218.88, 1);
    expect(plan.evidence.footprintSqm).toEqual(['21.25 × 10.3 m']);
  });

  it('notices the staircase without inventing a storey count', () => {
    // A staircase proves there is an upper floor. It never says how many, and a
    // guessed storey count would multiply through the entire budget.
    expect(plan.staircase).toBe(true);
    expect(plan.floors).toBeNull();
  });

  it('claims no gross floor area, because the sheet states none', () => {
    // The footprint is a bounding box we measured. Floor area over every storey is
    // a different number and this drawing does not carry it.
    expect(plan.areaSqm).toBeNull();
  });

  it('reads the same twice', () => {
    // The label patterns are module-level constants carrying /g. A shared regex that
    // kept its lastIndex would count the second plan of an upload differently.
    expect(readFloorPlanFacts(MR_NAS_GROUND_PLAN)).toEqual(plan);
  });
});

describe('what a drawing states outranks what we counted', () => {
  it('a stated bedroom count wins over the labels', () => {
    // A schedule saying "4 BEDROOMS" is a claim about the building. Counting labels
    // only ever describes the sheet in front of us, so it must not overrule one.
    const facts = readFloorPlanFacts('4 BEDROOMS\nBed Room\nBed Room\nBed Room');
    expect(facts.bedrooms).toBe(4);
  });

  it('a stated footprint is not replaced by one we measured', () => {
    const facts = readFloorPlanFacts('FOOTPRINT 150 m²\n21.25\n21.25\n10.30\n10.30');
    expect(facts.footprintSqm).toBe(150);
    expect(facts.evidence.footprintSqm[0]).toContain('150');
  });
});

describe('the unit the whole market writes', () => {
  // "²" is not a word character, so a trailing \b after the unit asserted a boundary
  // that only a LETTER could satisfy: "150 m²" did not match and "150 m²x" did. Every
  // stated area written the normal way was invisible. Found 28 October while adding
  // the label counting, which is the only reason it surfaced at all.
  it.each(['m²', 'm2', 'sqm', 'M²'])('reads a footprint stated in %s', unit => {
    expect(readFloorPlanFacts(`FOOTPRINT 150 ${unit}`).footprintSqm).toBe(150);
  });

  it('reads a gross floor area stated in m²', () => {
    expect(readFloorPlanFacts('GROSS FLOOR AREA 437.75 m²').areaSqm).toBeCloseTo(437.75, 2);
  });

  it('does not take a unit that is really part of a longer word', () => {
    expect(readFloorPlanFacts('FOOTPRINT 150 m2x').footprintSqm).toBeNull();
  });
});

describe('what it refuses to conclude', () => {
  it('a number written once is not an overall span', () => {
    // Both opposite edges get dimensioned, so an overall span repeats. An internal
    // run that happens to be long does not, and must not become the envelope.
    expect(readFloorPlanFacts('45.00\n10.30\n10.30').footprintSqm).toBeNull();
  });

  it('an implausible product is dropped rather than shown', () => {
    expect(readFloorPlanFacts('1.50\n1.50\n2.00\n2.00').footprintSqm).toBeNull();
  });

  it('empty text claims nothing at all', () => {
    const facts = readFloorPlanFacts('');
    expect(facts.bedrooms).toBeNull();
    expect(facts.footprintSqm).toBeNull();
    expect(facts.staircase).toBe(false);
    expect(facts.evidence.bedrooms).toEqual([]);
  });

  it('still reads a storey count the drawing does state', () => {
    expect(readFloorPlanFacts('PROPOSED G+2 RESIDENCE').floors).toBe(3);
  });
});

describe('French drawings', () => {
  it('counts French room labels', () => {
    const facts = readFloorPlanFacts('Chambre 1\nChambre 2\nCuisine\nSalon\nSalle de bain');
    expect(facts.bedrooms).toBe(2);
    expect(facts.kitchens).toBe(1);
    expect(facts.livingRooms).toBe(1);
    expect(facts.bathrooms).toBe(1);
  });

  it('reads a French staircase', () => {
    expect(readFloorPlanFacts('Escalier').staircase).toBe(true);
  });
});

describe('a storey count read off a bill of quantities', () => {
  /**
   * A bill's title names the building — "Mr.NAS G + 1 Cost Estimate" — which is worth
   * having, because a ground plan with a staircase proves there is an upper floor
   * without ever saying how many.
   *
   * A bill is also a TABLE, and that is the trap. These three lines are verbatim from
   * Mr Nas's estimate, and with an optional separator the reader found "1" and "3" in
   * the money column beside the words "UPPER FLOOR", took the larger, added one for
   * the real G+1, and prefilled a four-storey building. Storeys multiply the budget.
   */
  const MR_NAS_BQ = [
    'BILL OF QUANTITIES AND COST ESTIMATES FOR THE CONSTRUCTION OF G +1 FOUNDATION',
    '500:DECKING OF UPPER FLOOR\t1,013,000',
    '550:WALL MASONARY OF UPPER FLOOR\t3,155,600',
  ].join('\n');

  it('reads two storeys, not four', () => {
    expect(readStatedFloors(MR_NAS_BQ).value).toBe(2);
  });

  it('never takes a figure out of the money column', () => {
    expect(readStatedFloors('550:WALL MASONARY OF UPPER FLOOR\t3,155,600').value).toBeNull();
    expect(readStatedFloors('500:DECKING OF UPPER FLOOR\t1,013,000').value).toBeNull();
  });

  it('a G+ figure settles it alone, whatever else the document contains', () => {
    expect(readStatedFloors('G +1\n9 FLOORS\n7 STOREYS').value).toBe(2);
  });

  it('still reads the plain statements when no G+ is given', () => {
    expect(readStatedFloors('3 STOREYS').value).toBe(3);
    expect(readStatedFloors('Floors: 2').value).toBe(2);
    expect(readStatedFloors('Number of levels - 4').value).toBe(4);
  });

  it('reads the real titles of both bills on file', () => {
    expect(readStatedFloors('Mr.NAS G + 1 Cost Estimate Limbe').value).toBe(2);
    expect(readStatedFloors('CONSTRUCTION ESTIMATE OF G+1 BUILDING FOR MRS ROSE').value).toBe(2);
    expect(readStatedFloors('CONSTRUCTION OF A G+2+TT GUEST HOUSE IN KRIBI').value).toBe(3);
  });

  it('says nothing about a bill that never names the building', () => {
    expect(readStatedFloors('FOUNDATION\t2,966,628\nROOF\t681,200').value).toBeNull();
  });

  it('refuses a storey count no building has', () => {
    expect(readStatedFloors('G+99').value).toBeNull();
    expect(readStatedFloors('40 FLOORS').value).toBeNull();
  });
});
