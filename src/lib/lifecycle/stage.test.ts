import { describe, expect, it } from 'vitest';
import { availableFunds, stageLifecycle } from './stage';
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

// 090: the ledger. A stage with a $1000 milestone, funded or not, released or not.
const paid = (status: 'complete' | 'active' = 'complete', required = true) =>
  ({ id: 's1', stage_number: 2, status, verification_required: required, payment_milestone_usd: 1000 });
const verified = v({ decision: 'verified', visitedAt: '2026-09-10T11:00:00Z', decidedAt: '2026-09-10T12:00:00Z' });
type L = { stageId: string | null; direction: 'in' | 'out'; state: 'expected' | 'funded' | 'reconciled' | 'release_authorised' | 'initiated' | 'disbursed' | 'failed' | 'reconciling'; amount: number; createdAt: string };
const fundedIn  = (amount: number, stageId: string | null = 's1'): L => ({ stageId, direction: 'in', state: 'funded', amount, createdAt: '2026-09-11T00:00:00Z' });
const expected  = (amount: number): L => ({ stageId: 's1', direction: 'in', state: 'expected', amount, createdAt: '2026-09-11T00:00:00Z' });
const out       = (state: L['state'], amount = 1000, createdAt = '2026-09-12T00:00:00Z'): L => ({ stageId: 's1', direction: 'out', state, amount, createdAt });

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

describe('site updates (088) → evidence_submitted', () => {
  it('active with a site update → evidence_submitted', () => {
    expect(stageLifecycle(stage('active'), [], active, false, '2026-09-12T10:00:00Z').state).toBe('evidence_submitted');
  });
  it('rejected, then new work reported after the decision → evidence_submitted (the contractor responded)', () => {
    const rej = v({ decision: 'rejected', decidedAt: '2026-09-11T09:00:00Z' });
    expect(stageLifecycle(stage('active'), [rej], active, false, '2026-09-12T10:00:00Z').state).toBe('evidence_submitted');
  });
  it('rejected, with only OLD evidence from before the decision → still rejected', () => {
    const rej = v({ decision: 'rejected', decidedAt: '2026-09-11T09:00:00Z' });
    expect(stageLifecycle(stage('active'), [rej], active, false, '2026-09-10T10:00:00Z').state).toBe('rejected');
  });
  it('a site update on a pending_review stage does not change the verification reading', () => {
    expect(stageLifecycle(stage('pending_review'), [v({})], active, false, '2026-09-12T10:00:00Z').state).toBe('verification_pending');
  });
  it('no site update → in_progress, as before', () => {
    expect(stageLifecycle(stage('active'), [], active, false, null).state).toBe('in_progress');
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

describe('the ledger (090): eligibility is computed, authorisation is a row', () => {
  it('no ledger (null) → approved with no funding blocker, as before 090', () => {
    expect(stageLifecycle(paid(), [verified], active, false, null, null)).toEqual({ state: 'approved', blockers: [] });
  });
  it('approved + verified + funded → payment_eligible; no stored flag anywhere in the answer', () => {
    const r = stageLifecycle(paid(), [verified], active, false, null, [fundedIn(1000)]);
    expect(r).toEqual({ state: 'payment_eligible', blockers: [] });
  });
  it('funding short by one unit → approved + awaiting_funding, never payment_eligible', () => {
    expect(stageLifecycle(paid(), [verified], active, false, null, [fundedIn(999)])).toEqual({ state: 'approved', blockers: ['awaiting_funding'] });
  });
  it('an expected (unconfirmed) tranche is not funding', () => {
    expect(stageLifecycle(paid(), [verified], active, false, null, [expected(1000)]).blockers).toEqual(['awaiting_funding']);
  });
  it('funding is project-wide: another stage\u2019s tranche counts, and live releases are subtracted', () => {
    expect(stageLifecycle(paid(), [verified], active, false, null, [fundedIn(1000, 'other')]).state).toBe('payment_eligible');
    const spent = { ...out('release_authorised', 1000), stageId: 'other' };
    expect(stageLifecycle(paid(), [verified], active, false, null, [fundedIn(1000, 'other'), spent]).blockers).toEqual(['awaiting_funding']);
    const failedElsewhere = { ...out('failed', 1000), stageId: 'other' };
    expect(stageLifecycle(paid(), [verified], active, false, null, [fundedIn(1000, 'other'), failedElsewhere]).state).toBe('payment_eligible');
  });
  it('verification required and not verified → approved, not eligible, even when funded', () => {
    expect(stageLifecycle(paid(), [], active, false, null, [fundedIn(1000)])).toEqual({ state: 'approved', blockers: [] });
    expect(stageLifecycle(paid(), [v({ decision: 'rejected', decidedAt: '2026-09-10T12:00:00Z' })], active, false, null, [fundedIn(1000)]).state).toBe('approved');
  });
  it('self-verify goes straight from complete to eligible', () => {
    expect(stageLifecycle(paid('complete', false), [], active, false, null, [fundedIn(1000)]).state).toBe('payment_eligible');
  });
  it('on_hold blocks eligibility as an overlay', () => {
    expect(stageLifecycle(paid(), [verified], onHold, false, null, [fundedIn(1000)])).toEqual({ state: 'approved', blockers: ['on_hold'] });
  });
  it('the out row is the state: authorised → initiated → disbursed → completed; failed / reconciling → payment_failed', () => {
    const led = (st: L['state']) => stageLifecycle(paid(), [verified], active, false, null, [fundedIn(1000), out(st)]);
    expect(led('release_authorised').state).toBe('release_authorised');
    expect(led('initiated').state).toBe('disbursement_initiated');
    expect(led('disbursed').state).toBe('disbursed');
    expect(led('failed').state).toBe('payment_failed');
    expect(led('reconciling').state).toBe('payment_failed');
    expect(stageLifecycle(paid(), [verified], active, true, null, [fundedIn(1000), out('disbursed')]).state).toBe('completed');
  });
  it('after a failure the newest row wins: a re-authorisation supersedes the failed one', () => {
    const rows = [fundedIn(2000), out('failed', 1000, '2026-09-12T00:00:00Z'), out('release_authorised', 1000, '2026-09-13T00:00:00Z')];
    expect(stageLifecycle(paid(), [verified], active, false, null, rows).state).toBe('release_authorised');
  });
  it('availableFunds = funded − every live out row', () => {
    expect(availableFunds([fundedIn(3000), out('disbursed', 1000), out('release_authorised', 500), out('failed', 700), expected(9999)])).toBe(1500);
  });
});

describe('property: one input, one state', () => {
  it('every combination yields exactly one state and never a stored-looking value', () => {
    const statuses = ['locked', 'active', 'pending_review', 'complete'] as const;
    const decisions = [null, 'pending', 'verified', 'rejected', 'needs_more_evidence'] as const;
    const seen = new Set<string>();
    for (const s of statuses) for (const req of [true, false]) for (const d of decisions)
      for (const visited of [null, 'x']) for (const proj of [active, onHold]) for (const next of [false, true]) for (const su of [null, 'y']) {
        const rows = d ? [v({ decision: d, decidedAt: d === 'pending' ? null : 'x', visitedAt: visited })] : [];
        const r = stageLifecycle(stage(s, req), rows, proj, next, su);
        expect(typeof r.state).toBe('string');
        expect(Array.isArray(r.blockers)).toBe(true);
        seen.add(r.state);
      }
    // Sanity: the ladder is reachable end to end.
    for (const st of ['locked', 'in_progress', 'evidence_submitted', 'verification_pending', 'verification_in_progress', 'rejected', 'verified', 'approved', 'completed'])
      expect(seen.has(st), `${st} reachable`).toBe(true);
  });
});
