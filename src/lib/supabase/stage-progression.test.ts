import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), track: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }));
import { approveStage, markSubstageComplete } from './approvals';
import { approveStageRpc, approveSubstageRpc } from './verifications';

const next = { project_id: 'project', stage_id: 'foundation', stage_number: 4,
  is_final: false, next_stage_id: 'structure', next_stage_number: 5,
  awaiting_payment: true, verification_id: null };

beforeEach(() => { vi.clearAllMocks(); h.track.mockReset(); });

describe('approval returns the next action instead of discarding it', () => {
  it('returns the exact unpaid successor from an explicit stage approval', async () => {
    h.rpc.mockResolvedValue({ data: next, error: null });
    const result = await approveStage('project', 'foundation', 4, 'client', 'jalla_management');
    expect(h.rpc).toHaveBeenCalledWith('approve_stage', { p_stage: 'foundation' });
    expect(h.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ projectId: 'project', stageId: 'foundation', nextStageId: 'structure',
      nextStageNumber: 5, awaitingPayment: true, isFinal: false });
  });

  it('approves a normal substage without manufacturing a stage transition', async () => {
    h.rpc.mockResolvedValue({ data: { substage_id: 'pillars', stage_approval: null }, error: null });
    expect(await markSubstageComplete('pillars', 'pro', 'client')).toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith('approve_substage', { p_substage: 'pillars' });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });

  it('returns the next payment prompt when the last substage completes its stage atomically', async () => {
    h.rpc.mockResolvedValue({ data: { substage_id: 'last-update', stage_approval: next }, error: null });
    const result = await markSubstageComplete('last-update', 'jalla_verify', 'invited-client');
    expect(result).toMatchObject({ nextStageId: 'structure', awaitingPayment: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('stage_approved', { stage_number: 4, tier: 'jalla_verify' });
  });

  it('preserves the same-stage payment requirement returned after initial contractor work approval', async () => {
    h.rpc.mockResolvedValue({ data: { substage_id: 'last-update', stage_approval: { ...next,
      next_stage_id: next.stage_id, next_stage_number: next.stage_number, next_stage_status: 'pending_review',
      awaiting_reviewed_stage_payment: true } }, error: null });
    expect(await approveSubstageRpc('last-update')).toMatchObject({ stageId: next.stage_id,
      nextStageId: next.stage_id, awaitingReviewedStagePayment: true, awaitingPayment: true });
  });

  it('does not request payment again when the successor was already funded', async () => {
    h.rpc.mockResolvedValue({ data: { substage_id: 'last-update', stage_approval: { ...next, awaiting_payment: false } }, error: null });
    expect(await approveSubstageRpc('last-update')).toMatchObject({ nextStageId: 'structure', awaitingPayment: false });
  });

  it('retains the saved next-stage status instead of assuming funded means active', async () => {
    h.rpc.mockResolvedValue({ data: { ...next, awaiting_payment: false, next_stage_status: 'locked', already_approved: true }, error: null });
    expect(await approveStageRpc('foundation')).toMatchObject({ nextStageId: 'structure', nextStageStatus: 'locked', alreadyApproved: true });
  });

  it('returns project completion with no next-stage payment', async () => {
    h.rpc.mockResolvedValue({ data: { substage_id: 'handover', stage_approval: { ...next,
      stage_id: 'final', stage_number: 10, is_final: true, next_stage_id: null,
      next_stage_number: null, awaiting_payment: false } }, error: null });
    expect(await approveSubstageRpc('handover')).toMatchObject({ isFinal: true, nextStageId: null,
      nextStageNumber: null, awaitingPayment: false });
  });

  it('preserves idempotent retry progression without recording a duplicate analytics event', async () => {
    h.rpc.mockResolvedValue({ data: { ...next, already_approved: true }, error: null });
    expect(await approveStage('project', 'foundation', 4, 'client', 'starter')).toMatchObject({
      alreadyApproved: true, nextStageId: 'structure', awaitingPayment: true,
    });
    expect(h.track).not.toHaveBeenCalled();
  });

  it('does not lose a saved approval when analytics throws', async () => {
    h.rpc.mockResolvedValue({ data: next, error: null });
    h.track.mockImplementation(() => { throw new Error('analytics blocked'); });
    expect(await approveStage('project', 'foundation', 4, 'client', 'self_verify'))
      .toMatchObject({ nextStageId: 'structure', awaitingPayment: true });
  });

  it('propagates authorization or prerequisite failures without pretending approval succeeded', async () => {
    const error = { message: 'not_client: only the client can approve' };
    h.rpc.mockResolvedValue({ error });
    await expect(markSubstageComplete('last-update', 'pro', 'observer')).rejects.toEqual(error);
    expect(h.track).not.toHaveBeenCalled();
  });

  it('rejects malformed successful replies so a missing migration cannot look like approval', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null });
    await expect(approveSubstageRpc('last-update')).rejects.toThrow('invalid_approval_response');
    await expect(approveStageRpc('foundation')).rejects.toThrow('invalid_approval_response');
  });
});
