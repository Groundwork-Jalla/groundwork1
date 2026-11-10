import { describe, expect, it } from 'vitest';
import {
  inferConstructionTotal, stageBasisFor, stageScheduleUsd, stagePayableUsd, sumPayableUsd,
} from './stage-amounts';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

/**
 * One payment, two people, one number.
 *
 * The client reads a stage figure on the costing tab and the contractor reads the same
 * figure on /work. On 11 Nov 2026 they disagreed: the costing page had been corrected to
 * split a bill-of-quantities project across the project total and the contractor's
 * screens still printed the stored amount, about 3.34% higher on every stage.
 *
 * The numbers below are Brian Home (`6fab6934`), which is the project that exposed it:
 * a bill of quantities AND a mid-build join, the one combination where every rule in
 * this file matters at once.
 */

const project = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'p1', budget_usd: 80587, sqm: 151.75, num_floors: 2,
  country: 'CM', city: null, building_type: 'multi_family', project_type: 'residential',
  roof_type: 'stone_coated', finish_level: 'standard', has_boys_quarters: false,
  bq_rooms: null, ...over,
} as unknown as ProjectRow);

const stage = (over: Partial<ProjectStageRow> = {}): ProjectStageRow => ({
  id: 's', project_id: 'p1', stage_number: 5, stage_key: 'structureWalls',
  status: 'active', budget_pct: 46.371529, payment_milestone_usd: 41533.06,
  pre_existing: false, fixed_amount_usd: null, payment_status: 'unpaid',
  ...over,
} as unknown as ProjectStageRow);

describe('which figure a percentage is a percentage of', () => {
  it('uses the PROJECT TOTAL when a bill of quantities was uploaded', () => {
    // The bill already is the whole figure — fees are inside it, not on top.
    const basis = stageBasisFor(project(), [stage()], true);
    expect(basis.wholeProject).toBe(true);
    expect(basis.base).toBe(80587);
  });

  it('uses CONSTRUCTION when the project was estimated from scratch', () => {
    // The estimator prices construction and the permit, project manager and contingency
    // sit on top, so a stage share must not include them.
    const basis = stageBasisFor(project(), [stage()], false);
    expect(basis.wholeProject).toBe(false);
    expect(basis.base).not.toBe(80587);
    expect(basis.base).toBeGreaterThan(0);
  });

  it('does not decide this from whether the project joined mid-build', () => {
    /*
     * The bug that preceded this file. Keyed on `pre_existing`, a mid-build project got
     * the whole-total treatment whether or not a bill existed — and a bill-priced
     * project that started from stage one did not. The two facts are independent.
     */
    const midBuild = [stage({ pre_existing: true, status: 'complete', payment_milestone_usd: 0 }), stage()];
    expect(stageBasisFor(project(), midBuild, false).wholeProject).toBe(false);
    expect(stageBasisFor(project(), [stage()], true).wholeProject).toBe(true);
  });
});

describe('what a stage is worth', () => {
  it('derives every stage from its percentage on a bill-of-quantities project', () => {
    const basis = stageBasisFor(project(), [stage()], true);
    // 46.371529% of 80,587 — NOT the 41,533.06 stored against an older base.
    expect(stageScheduleUsd(stage(), basis)).toBe(Math.round(80587 * 0.46371529));
    expect(stageScheduleUsd(stage(), basis)).not.toBe(41533.06);
  });

  it('keeps the confirmed amount on a build from scratch', () => {
    // There the stored figure is what the client agreed to, and it stands.
    const basis = { wholeProject: false, base: 100000 };
    expect(stageScheduleUsd(stage(), basis)).toBe(41533.06);
  });

  it('still values work finished before tracking began', () => {
    // Its stored amount is deliberately zero; the costing page asks what the building
    // cost, so the percentage answers instead.
    const historical = stage({ pre_existing: true, status: 'complete', payment_milestone_usd: 0, budget_pct: 15.664829 });
    const basis = { wholeProject: false, base: 89565.86 };
    expect(stageScheduleUsd(historical, basis)).toBe(Math.round(89565.86 * 0.15664829));
  });

  it('falls back to the stored amount when there is no percentage to use', () => {
    const basis = { wholeProject: true, base: 80587 };
    expect(stageScheduleUsd(stage({ budget_pct: 0 }), basis)).toBe(41533.06);
  });
});

describe('what the contractor is OWED is a different question', () => {
  const basis = { wholeProject: false, base: 89565.86 };
  const historical = stage({
    pre_existing: true, status: 'complete', payment_milestone_usd: 0, budget_pct: 15.664829,
  });

  it('pays nothing for work that was already standing', () => {
    /*
     * A pre-existing stage was "never approved, verified or funded by us" (103).
     * Printing its value beside "Released" would say the contractor had been paid for
     * work Groundwork never financed — two true numbers that together say something
     * false.
     */
    expect(stageScheduleUsd(historical, basis)).toBeGreaterThan(0);
    expect(stagePayableUsd(historical, basis)).toBe(0);
  });

  it('pays nothing for pre-existing work even when it is not complete', () => {
    expect(stagePayableUsd(stage({ pre_existing: true, status: 'active' }), basis)).toBe(0);
  });

  it('leaves the contract total out of pre-existing stages', () => {
    const stages = [historical, stage(), stage({ id: 's2', budget_pct: 5, payment_milestone_usd: 4478.29 })];
    const total = sumPayableUsd(stages, basis);
    expect(total).toBe(stagePayableUsd(stages[1], basis) + stagePayableUsd(stages[2], basis));
  });
});

describe('inferConstructionTotal, the last resort', () => {
  it('scales the remaining stages back up by their share of the percentages', () => {
    const stages = [
      stage({ id: 'a', pre_existing: true, status: 'complete', budget_pct: 20, payment_milestone_usd: 0 }),
      stage({ id: 'b', budget_pct: 80, payment_milestone_usd: 8000 }),
    ];
    // 8,000 is 80% of the base, so the base is 10,000.
    expect(inferConstructionTotal(stages)).toBe(10000);
  });

  it('gives up rather than guess when nothing is charged', () => {
    expect(inferConstructionTotal([stage({ budget_pct: 0 })])).toBeNull();
    expect(inferConstructionTotal([])).toBeNull();
  });

  it('gives up when every remaining stage carries no money', () => {
    // Everything pre-existing: there is no amount left to scale, and inventing one is
    // how the base came out 3.3% high in the first place.
    expect(inferConstructionTotal([
      stage({ pre_existing: true, status: 'complete', budget_pct: 100, payment_milestone_usd: 0 }),
    ])).toBeNull();
  });
});
