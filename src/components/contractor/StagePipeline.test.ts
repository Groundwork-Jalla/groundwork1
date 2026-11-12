import { describe, expect, it } from 'vitest';
import { currentStageNumber } from './StagePipeline';
import type { ProjectStageRow, StageStatus } from '@/types/project';

/**
 * Which dot is lit.
 *
 * The pipeline is the whole contractor surface's spine — the dashboard, the project
 * list and every project tab read the same answer from here. If this picks the wrong
 * stage, four screens lie at once.
 */

const stage = (n: number, status: StageStatus): ProjectStageRow => ({
  id: `s${n}`, project_id: 'p', stage_number: n, stage_key: null, name: `Stage ${n}`,
  status, budget_pct: 10, fixed_amount_usd: null, payment_milestone_usd: null,
  payment_status: 'unpaid',
} as ProjectStageRow);

describe('the stage a contractor is standing in', () => {
  it('is the active one', () => {
    expect(currentStageNumber([
      stage(1, 'complete'), stage(2, 'complete'), stage(3, 'active'), stage(4, 'locked'),
    ])).toBe(3);
  });

  it('is the one with a verifier when none is active', () => {
    // Work is done and submitted; nothing is "active" until the verifier answers. The
    // contractor is still standing in that stage, so it stays lit.
    expect(currentStageNumber([
      stage(1, 'complete'), stage(2, 'pending_review'), stage(3, 'locked'),
    ])).toBe(2);
  });

  it('keeps the earlier review current when a legacy snapshot has two open stages', () => {
    // Both views follow construction order; a stale future active flag cannot skip review.
    expect(currentStageNumber([
      stage(1, 'pending_review'), stage(2, 'active'),
    ])).toBe(1);
  });

  it('lights nothing on a finished build', () => {
    expect(currentStageNumber([stage(1, 'complete'), stage(2, 'complete')])).toBeNull();
  });

  it('marks the first live stage current while initial payment is pending', () => {
    expect(currentStageNumber([stage(1, 'locked'), stage(2, 'locked')])).toBe(1);
  });

  it('has nothing to say about a project with no stages yet', () => {
    expect(currentStageNumber([])).toBeNull();
  });
});
