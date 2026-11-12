import { describe, expect, it } from 'vitest';
import type { ProjectStageRow } from '@/types/project';
import type { ApproveStageResult, StagePayment } from '@/lib/supabase/verifications';
import {
  canActOnProjectStage, currentProjectStage, orderedProjectStages,
  projectReflectsApproval, projectStagesAfterApproval, stagePaymentAcknowledged,
  stageWorkReady, canSubmitStageReceipt,
} from './stage-progression';

const stage = (number: number, status: ProjectStageRow['status'] = 'locked', extra: Partial<ProjectStageRow> = {}): ProjectStageRow => ({
  id: `s${number}`, project_id: 'project', stage_number: number, status, payment_status: 'paid',
  payment_milestone_usd: 100, milestone_amount: 60000, pre_existing: false, ...extra,
} as ProjectStageRow);
const approval = (extra: Partial<ApproveStageResult> = {}): ApproveStageResult => ({
  projectId: 'project', stageId: 's1', stageNumber: 1, isFinal: false,
  nextStageId: 's2', nextStageNumber: 2, verificationId: null, awaitingPayment: true, ...extra,
});
const payment = (state: StagePayment['state']): StagePayment => ({
  id: 'pay', stageId: 's1', state, amount: 100, receiptPath: null, receiptUploadedAt: null,
});

describe('the current project stage', () => {
  it('offers the reviewed first stage receipt and keeps later stages blocked until acceptance', () => {
    const rows = [stage(1, 'pending_review', { review_payment_pending: true }), stage(2)];
    expect(currentProjectStage(rows)?.id).toBe('s1');
    expect(canSubmitStageReceipt(rows[0], rows, 'contractor')).toBe(true);
    expect(canSubmitStageReceipt(rows[1], rows, 'contractor')).toBe(false);
    expect(stageWorkReady(rows[0], rows, payment('receipt_submitted'), 'contractor')).toBe(false);
    expect(rows[0].milestone_amount).toBe(60000);
  });

  it('keeps approved work on the first stage while a same-stage payment response awaits refresh', () => {
    const rows = [stage(1, 'active'), stage(2)];
    const response = approval({ nextStageId: 's1', nextStageNumber: 1, nextStageStatus: 'pending_review', awaitingReviewedStagePayment: true });
    const saved = projectStagesAfterApproval(rows, response);
    expect(saved[0]).toMatchObject({ status: 'pending_review', review_payment_pending: true });
    expect(saved[1].status).toBe('locked');
    expect(projectReflectsApproval(rows, response)).toBe(false);
    expect(projectReflectsApproval(saved, response)).toBe(true);
    expect(projectReflectsApproval([stage(1, 'complete'), stage(2, 'active')], response)).toBe(true);
    expect(projectStagesAfterApproval([stage(1, 'complete'), stage(2, 'active')], response)[0].status).toBe('complete');
  });
  it('uses construction order and skips historical completed work without losing its value', () => {
    const historical = stage(1, 'complete', { pre_existing: true });
    const current = stage(2, 'active');
    const rows = [stage(3), current, historical];
    expect(currentProjectStage(rows)).toBe(current);
    expect(orderedProjectStages(rows).map(row => row.stage_number)).toEqual([1, 2, 3]);
    expect(historical.milestone_amount).toBe(60000);
    expect(rows[0].stage_number).toBe(3);
  });

  it('offers no action or payment on historical or already completed stages', () => {
    const rows = [stage(1, 'complete', { pre_existing: true }), stage(2, 'complete')];
    expect(currentProjectStage(rows)).toBeUndefined();
    expect(rows.every(row => !canActOnProjectStage(row, rows))).toBe(true);
    expect(stagePaymentAcknowledged(rows[0], payment('funded'))).toBe(false);
  });

  it('does not let a prepaid future stage bypass unfinished work', () => {
    const rows = [stage(1, 'active'), stage(2, 'active')];
    expect(canActOnProjectStage(rows[0], rows)).toBe(true);
    expect(canActOnProjectStage(rows[1], rows)).toBe(false);
    expect(stagePaymentAcknowledged(rows[1], payment('funded'))).toBe(true);
  });

  it('allows funding the current active stage while keeping work blocked until acknowledgment', () => {
    const rows = [stage(1, 'active', { payment_status: 'unpaid' }), stage(2)];
    expect(canActOnProjectStage(rows[0], rows)).toBe(true);
    expect(stagePaymentAcknowledged(rows[0], payment('expected'))).toBe(false);
    expect(stagePaymentAcknowledged(rows[0], payment('receipt_submitted'))).toBe(false);
    expect(stagePaymentAcknowledged(rows[0], payment('funded'))).toBe(true);
    expect(stagePaymentAcknowledged(rows[0], payment('reconciled'))).toBe(true);
  });

  it('requires a real incoming payment for a positive billed amount despite legacy paid flags', () => {
    expect(stagePaymentAcknowledged(stage(1, 'active'))).toBe(false);
    expect(stagePaymentAcknowledged(stage(1, 'active', { payment_milestone_usd: 0.005 }))).toBe(false);
  });

  it('does not invent a payment for zero or sub-cent stages', () => {
    expect(stagePaymentAcknowledged(stage(1, 'active', { payment_milestone_usd: 0, payment_status: 'unpaid' }))).toBe(true);
    expect(stagePaymentAcknowledged(stage(1, 'active', { payment_milestone_usd: 0.004999999 }))).toBe(true);
  });

  it('does not turn an unknown allocation into a free stage', () => {
    expect(stagePaymentAcknowledged(stage(1, 'active', { payment_milestone_usd: null }))).toBe(false);
  });

  it('does not ignore an earlier historical row incorrectly left incomplete', () => {
    const rows = [stage(1, 'locked', { pre_existing: true }), stage(2, 'active')];
    expect(canActOnProjectStage(rows[1], rows)).toBe(false);
  });
});

describe('the committed approval result arrives before the project refresh', () => {
  it('follows the exact server successor after an idempotent retry against a stale multi-stage screen', () => {
    const rows = [stage(1, 'active'), stage(2), stage(3)];
    const result = approval({ nextStageId: 's3', nextStageNumber: 3 });
    const shown = projectStagesAfterApproval(rows, result);
    expect(shown.map(row => row.status)).toEqual(['complete', 'complete', 'locked']);
    expect(currentProjectStage(shown)?.id).toBe('s3');
    expect(canActOnProjectStage(shown[2], shown)).toBe(true);
    expect(shown.map(row => row.milestone_amount)).toEqual([60000, 60000, 60000]);
    expect(rows.map(row => row.status)).toEqual(['active', 'locked', 'locked']);
  });

  it('shows the prefunded successor active without asking for another payment', () => {
    const shown = projectStagesAfterApproval([stage(1, 'active'), stage(2)], approval({ awaitingPayment: false }));
    expect(shown[1].status).toBe('active');
  });

  it('preserves the saved locked state when a paid successor cannot open on a paused project', () => {
    const result = approval({ awaitingPayment: false, alreadyApproved: true, nextStageStatus: 'locked' });
    const shown = projectStagesAfterApproval([stage(1, 'complete'), stage(2)], result);
    expect(shown[1].status).toBe('locked');
    expect(projectReflectsApproval(shown, result)).toBe(true);
  });

  it('shows final completion with no subsequent stage action', () => {
    const shown = projectStagesAfterApproval([stage(1, 'active'), stage(2)],
      approval({ stageId: 's2', stageNumber: 2, isFinal: true, nextStageId: null, nextStageNumber: null, awaitingPayment: false }));
    expect(shown.every(row => row.status === 'complete')).toBe(true);
    expect(currentProjectStage(shown)).toBeUndefined();
  });

  it('keeps the handoff until the target itself reflects the response, then accepts later progress', () => {
    const result = approval({ awaitingPayment: false });
    expect(projectReflectsApproval([stage(1, 'complete'), stage(2)], result)).toBe(false);
    expect(projectReflectsApproval([stage(1, 'complete'), stage(2, 'active')], result)).toBe(true);
    expect(projectReflectsApproval([stage(1, 'complete'), stage(2, 'complete'), stage(3, 'active')], result)).toBe(true);
    expect(projectReflectsApproval([stage(1, 'complete'), stage(2)], approval())).toBe(true);
    expect(projectReflectsApproval([], result)).toBe(false);
  });
});
