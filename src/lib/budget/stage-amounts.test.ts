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

describe('what a completed-before-join stage counts for on the contractor side', () => {
  const basis = { wholeProject: true, base: 99458.80 };

  it('shows its share of the bill when the project was priced from one', () => {
    /*
     * "Stages 1 to 4 should be completed with the actual amount being distributed —
     * not zero" (11 Nov 2026). The join RPC now leaves that amount in place on a bill,
     * and this is what the contractor sees beside the completed stage.
     */
    const built = stage({ pre_existing: true, status: 'complete', budget_pct: 15.664829,
      payment_milestone_usd: 15580.07 });
    expect(stagePayableUsd(built, basis)).toBe(15580.07);
  });

  it('shows the zero the system recorded on an estimated build', () => {
    // 162 zeroes those stages on an estimate, because that total was only ever for the
    // work to come. The screen says what the database says — it does not invent a
    // value beside the word "Released".
    const built = stage({ pre_existing: true, status: 'complete', budget_pct: 15.664829,
      payment_milestone_usd: 0 });
    expect(stagePayableUsd(built, { wholeProject: false, base: 89565.86 })).toBe(0);
    // ...even though the costing page, asking what the building cost, shows its value.
    expect(stageScheduleUsd(built, { wholeProject: false, base: 89565.86 })).toBeGreaterThan(0);
  });

  it('never derives a pre-existing amount, whatever the basis says', () => {
    const built = stage({ pre_existing: true, status: 'active', budget_pct: 50, payment_milestone_usd: 123 });
    expect(stagePayableUsd(built, { wholeProject: true, base: 1000000 })).toBe(123);
  });

  it('still to come is the total minus what is completed', () => {
    // The rule, stated in one line. All four stages carry their share of the bill.
    const stages = [
      stage({ id: 'a', pre_existing: true, status: 'complete', budget_pct: 15.664829, payment_milestone_usd: 15580.07 }),
      stage({ id: 'b', status: 'active',  budget_pct: 46.371529, payment_milestone_usd: 46120.57 }),
      stage({ id: 'c', status: 'locked',  budget_pct: 5,         payment_milestone_usd: 4972.94 }),
    ];
    const total = sumPayableUsd(stages, basis);
    const completed = sumPayableUsd(stages.filter(s => s.status === 'complete'), basis);
    const stillToCome = sumPayableUsd(stages.filter(s => s.status !== 'complete'), basis);
    expect(stillToCome).toBeCloseTo(total - completed, 2);
    expect(completed).toBe(15580.07);
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
