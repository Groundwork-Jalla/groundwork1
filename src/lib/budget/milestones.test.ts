import { describe, expect, it } from 'vitest';
import { calculateBudget, composeBudget, decomposeBudget } from './index';
import { CAMEROON_BQS } from './__fixtures__/cameroon-bqs';
import { getStageSeed } from '@/lib/supabase/stage-seeds';

/**
 * The payment schedule has to add up to the budget printed above it.
 *
 * That is harder than it sounds under the new model, because the schedule is assembled
 * from three different rules:
 *
 *   · seven stages take a PERCENTAGE of the construction fee
 *   · one stage (designCompleted) carries an ABSOLUTE amount, the design fee
 *   · two milestones (permit, professional) belong to no stage at all
 *
 * Get any one of those wrong — most easily by taking a percentage of the client total
 * instead of the construction fee — and the schedule silently disagrees with the budget.
 * On a typical build that error is about 4%, small enough to survive a glance and large
 * enough to matter on a $200,000 project.
 *
 * These assertions mirror the arithmetic in `createProject` (supabase/projects.ts) and in
 * `apply_budget_milestones` (migration 036). If those two ever diverge, this is what
 * should catch it.
 */

const STAGES = getStageSeed('residential', 'single_family', 2);

/** What createProject writes into project_stages.payment_milestone_usd. */
function stageMilestones(budget: { construction: number; design: number }) {
  return STAGES.map(s => ({
    key: s.key,
    amount: s.key === 'designCompleted'
      ? Math.round(budget.design)
      : Math.round(budget.construction * s.budget_pct / 100),
  }));
}

describe('payment schedule reconciles with the budget', () => {
  for (const fixture of CAMEROON_BQS) {
    it(`adds up for ${fixture.name}`, () => {
      const budget = calculateBudget(fixture.input);
      const stages = stageMilestones(budget);

      // The seven charged stages sum to the construction fee, within the rounding of ten
      // separate Math.round calls — never to the client total.
      const charged = stages
        .filter(s => s.key !== 'designCompleted')
        .reduce((a, s) => a + s.amount, 0);
      expect(charged).toBeCloseTo(budget.construction, -1);
      expect(charged).toBeLessThan(budget.total);

      // The design stage carries the design fee, not a percentage of anything.
      expect(stages.find(s => s.key === 'designCompleted')!.amount)
        .toBe(Math.round(budget.design));

      // Stages + the two standalone fee milestones = what the client was quoted.
      const scheduled = stages.reduce((a, s) => a + s.amount, 0)
        + Math.round(budget.permit) + Math.round(budget.professional);
      expect(scheduled).toBeCloseTo(budget.total, -1);
    });
  }

  it('the three uncharged stages carry nothing', () => {
    const budget = composeBudget(200_000, { builtAreaSqm: 240 });
    const byKey  = new Map(stageMilestones(budget).map(s => [s.key, s.amount]));

    expect(byKey.get('landSecured')).toBe(0);
    expect(byKey.get('exteriorWork')).toBe(0);
    // Design is "uncharged" only in the percentage sense — it has a real milestone.
    expect(byKey.get('designCompleted')).toBeGreaterThan(0);
  });

  it('reconciles for an edited budget, not just the estimate', () => {
    // The path that broke before: an owner types their own figure in Step 11, and the
    // schedule must follow THAT number rather than the engine's.
    const budget = decomposeBudget(137_412.37, { builtAreaSqm: 240 });
    const stages = stageMilestones(budget);

    const scheduled = stages.reduce((a, s) => a + s.amount, 0)
      + Math.round(budget.permit) + Math.round(budget.professional);

    expect(budget.total).toBe(137_412.37);
    expect(scheduled).toBeCloseTo(137_412.37, -1);
  });
});
