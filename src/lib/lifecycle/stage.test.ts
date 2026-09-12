import { describe, expect, it } from 'vitest';
import { stageLifecycle } from './stage';
import type { StageVerification } from '@/lib/supabase/verifications';

/**
 * The lifecycle is the only interpretation of stage + verification the product has, and
 * it is never stored — so every screen that shows "verification pending" or "rejected"
 * is showing this function's answer. Each row of Phase 3 §2 is a case here; the property
 * test at the end is the rule that matters most: one input, one state.
 */

const stage = (status: 'locked' | 'active' | 'pending_review' | 'complete', required = true) =>
  ({ id: 's1', stage_number: 2, status, verification_required: required });

const v = (over: Partial<StageVerification>): StageVerification => ({
  id: 'v', stageId: 's1', projectId: 'p', verifierId: 'd', requestedBy: 'a',
  requestedAt: '2026-09-10T10:00:00Z', visitedAt: null, decision: 'pending',
  findings: null, checklist: null, decidedAt: null, recordedBy: null,
  recordedOnBehalfOf: null, reason: null, certificateId: null, ...over,
});

const active = { status: 'active' as const };
const onHold = { status: 'on_hold' as const };

describe('the four stored statuses map to derived states', () => {
  it('locked → locked', () => {
    expect(stageLifecycle(stage('locked'), [], active)).toEqual({ state: 'locked', blockers: [] });
  });
  it('active, nothing decided → in_progress', () => {
    expect(stageLifecycle(stage('active'), [], active).state).toBe('in_progress');
  });
  it('complete → approved; completed once the next stage has started', () => {
    expect(stageLifecycle(stage('complete'), [], active).state).toBe('approved');
    expect(stageLifecycle(stage('complete'), [], active, true).state).toBe('completed');
  });
});

describe('verification, where required', () => {
  it('pending_review with nobody asked → verification_pending + verifier_not_selected', () => {
    // Decision 12 Sep: the admin selects one verifier; nothing is auto-requested.
    expect(stageLifecycle(stage('pending_review'), [], active))
      .toEqual({ state: 'verification_pending', blockers: ['verifier_not_selected'] });
  });
  it('open request, no visit yet → verification_pending, no blocker', () => {
    expect(stageLifecycle(stage('pending_review'), [v({})], active))
      .toEqual({ state: 'verification_pending', blockers: [] });
  });
  it('open request, visited → verification_in_progress', () => {
    expect(stageLifecycle(stage('pending_review'), [v({ visitedAt: '2026-09-11T09:00:00Z' })], active).state)
      .toBe('verification_in_progress');
  });
  it('decided verified, awaiting approval → verified', () => {
    expect(stageLifecycle(stage('pending_review'), [v({ decision: 'verified', decidedAt: 'x' })], active).state)
      .toBe('verified');
  });
  it('rejected and sent back to active → rejected, not in_progress', () => {
    expect(stageLifecycle(stage('active'), [v({ decision: 'rejected', decidedAt: 'x' })], active).state)
      .toBe('rejected');
    expect(stageLifecycle(stage('active'), [v({ decision: 'needs_more_evidence', decidedAt: 'x' })], active).state)
      .toBe('rejected');
  });
  it('resubmitted after a rejection → pending again, verifier must be re-selected', () => {
    expect(stageLifecycle(stage('pending_review'), [v({ decision: 'rejected', decidedAt: 'x' })], active))
      .toEqual({ state: 'verification_pending', blockers: ['verifier_not_selected'] });
  });
  it('uses the NEWEST row when a stage has several', () => {
    const older = v({ id: 'v1', decision: 'rejected', decidedAt: 'x', requestedAt: '2026-09-01T00:00:00Z' });
    const newer = v({ id: 'v2', decision: 'verified', decidedAt: 'y', requestedAt: '2026-09-11T00:00:00Z' });
    expect(stageLifecycle(stage('pending_review'), [older, newer], active).state).toBe('verified');
    expect(stageLifecycle(stage('pending_review'), [newer, older], active).state).toBe('verified');
  });
  it('ignores rows belonging to other stages', () => {
    expect(stageLifecycle(stage('pending_review'), [v({ stageId: 'other', decision: 'verified', decidedAt: 'x' })], active))
      .toEqual({ state: 'verification_pending', blockers: ['verifier_not_selected'] });
  });
});

describe('where verification is not required (self-verify)', () => {
  it('pending_review → verified straight away, no blocker', () => {
    expect(stageLifecycle(stage('pending_review', false), [], active))
      .toEqual({ state: 'verified', blockers: [] });
  });
  it('a verification row on a non-required stage does not create a blocker', () => {
    expect(stageLifecycle(stage('pending_review', false), [v({ decision: 'rejected', decidedAt: 'x' })], active).blockers)
      .toEqual([]);
  });
});

describe('on_hold is a blocker on every state, never a state', () => {
  it.each(['locked', 'active', 'pending_review', 'complete'] as const)('%s', status => {
    const r = stageLifecycle(stage(status), [], onHold);
    expect(r.blockers).toContain('on_hold');
    expect(r.state).not.toBe('on_hold' as never);
  });
});

describe('property: one input, one state', () => {
  it('every combination yields exactly one state and never a stored-looking value', () => {
    const statuses = ['locked', 'active', 'pending_review', 'complete'] as const;
    const decisions = [null, 'pending', 'verified', 'rejected', 'needs_more_evidence'] as const;
    const seen = new Set<string>();
    for (const s of statuses) for (const req of [true, false]) for (const d of decisions)
      for (const visited of [null, 'x']) for (const proj of [active, onHold]) for (const next of [false, true]) {
        const rows = d ? [v({ decision: d, decidedAt: d === 'pending' ? null : 'x', visitedAt: visited })] : [];
        const r = stageLifecycle(stage(s, req), rows, proj, next);
        expect(typeof r.state).toBe('string');
        expect(Array.isArray(r.blockers)).toBe(true);
        seen.add(r.state);
      }
    // Sanity: the ladder is reachable end to end.
    for (const st of ['locked', 'in_progress', 'verification_pending', 'verification_in_progress', 'rejected', 'verified', 'approved', 'completed'])
      expect(seen.has(st), `${st} reachable`).toBe(true);
  });
});
