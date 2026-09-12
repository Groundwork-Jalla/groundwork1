import { describe, expect, it } from 'vitest';
import {
  projectHealth, latestOf,
  STALL_ATTENTION_DAYS, STALL_AT_RISK_DAYS, REVIEW_AT_RISK_DAYS, OVERDUE_AT_RISK_DAYS,
} from './health';

/**
 * The bands are what the desk acts on, so the thresholds are pinned here. Loosen one and
 * a project quietly drops off the needs-attention list; tighten one and every project is
 * red. Either is invisible in the UI — the number just changes.
 */

const NOW = new Date('2026-09-12T12:00:00Z');
const daysAgo  = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const daysFrom = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const tracked = {
  status: 'active' as const, tier: 'jalla_verify' as const,
  tracking_started_at: daysAgo(40), updated_at: daysAgo(1),
};

const stage = (n: number, over: Partial<{
  status: 'locked'|'active'|'pending_review'|'complete';
  payment_status: 'unpaid'|'partial'|'paid';
  planned_end: string | null; completed_at: string | null;
}> = {}) => ({
  stage_number: n, name: `Stage ${n}`, stage_key: null,
  status: 'locked' as const, payment_status: 'unpaid' as const,
  planned_end: null, completed_at: null,
  ...over,
});

const fresh = { lastEvidenceAt: daysAgo(1) };

describe('unscored states', () => {
  it('archived is hidden', () => {
    expect(projectHealth({ ...tracked, status: 'archived' }, [], {}, NOW).band).toBe('archived');
  });
  it('completed is done', () => {
    expect(projectHealth({ ...tracked, status: 'completed' }, [], {}, NOW).band).toBe('done');
  });
  it('untracked is planning, with no stage rules applied', () => {
    // An overdue stage on a project that has not started cannot be overdue.
    const h = projectHealth(
      { ...tracked, tracking_started_at: null },
      [stage(1, { status: 'active', planned_end: daysAgo(30) })], {}, NOW,
    );
    expect(h.band).toBe('planning');
    expect(h.reasons).toEqual([]);
  });
  it('a Management build still planning is waiting on us', () => {
    const h = projectHealth({ ...tracked, tier: 'jalla_management', tracking_started_at: null }, [], {}, NOW);
    expect(h.band).toBe('planning');
    expect(h.reasons.map(r => r.kind)).toEqual(['budget_unconfirmed']);
  });
});

describe('on track', () => {
  it('a tracked project with recent activity and nothing pending', () => {
    const h = projectHealth(tracked, [stage(1, { status: 'complete', payment_status: 'paid' }), stage(2, { status: 'active', planned_end: daysFrom(10) })], fresh, NOW);
    expect(h.band).toBe('on_track');
    expect(h.reasons).toEqual([]);
  });
});

describe('review pending', () => {
  it('is attention when a stage waits on Jalla', () => {
    const h = projectHealth(tracked, [stage(3, { status: 'pending_review' })], { ...fresh, lastReviewAt: daysAgo(1) }, NOW);
    expect(h.band).toBe('attention');
    expect(h.reasons[0]).toMatchObject({ kind: 'review_pending', severity: 'attention', days: 1, stageNumber: 3 });
  });
  it(`escalates at ${REVIEW_AT_RISK_DAYS} days`, () => {
    const h = projectHealth(tracked, [stage(3, { status: 'pending_review' })], { ...fresh, lastReviewAt: daysAgo(REVIEW_AT_RISK_DAYS) }, NOW);
    expect(h.band).toBe('at_risk');
  });
  it('does not escalate without a review timestamp', () => {
    // No stamp means the activity RPC is missing, not that the review is old. Guessing
    // would turn the whole board red the day the migration lags.
    const h = projectHealth(tracked, [stage(3, { status: 'pending_review' })], fresh, NOW);
    expect(h.band).toBe('attention');
    expect(h.reasons[0].days).toBeUndefined();
  });
});

describe('stage overdue', () => {
  it('flags an active stage past its planned end', () => {
    const h = projectHealth(tracked, [stage(2, { status: 'active', planned_end: daysAgo(3) })], fresh, NOW);
    expect(h.band).toBe('attention');
    expect(h.reasons[0]).toMatchObject({ kind: 'stage_overdue', days: 3 });
  });
  it(`escalates at ${OVERDUE_AT_RISK_DAYS} days`, () => {
    const h = projectHealth(tracked, [stage(2, { status: 'active', planned_end: daysAgo(OVERDUE_AT_RISK_DAYS) })], fresh, NOW);
    expect(h.band).toBe('at_risk');
  });
  it('ignores planned_end on a stage that is not active', () => {
    const h = projectHealth(tracked, [
      stage(1, { status: 'complete', payment_status: 'paid', planned_end: daysAgo(60) }),
      stage(2, { status: 'locked', planned_end: daysAgo(60) }),
    ], fresh, NOW);
    expect(h.reasons.some(r => r.kind === 'stage_overdue')).toBe(false);
  });
  it('is not overdue on the planned day itself', () => {
    const h = projectHealth(tracked, [stage(2, { status: 'active', planned_end: daysAgo(0) })], fresh, NOW);
    expect(h.reasons.some(r => r.kind === 'stage_overdue')).toBe(false);
  });
});

describe('payment pending', () => {
  it('flags an approved stage whose milestone has not been paid', () => {
    const h = projectHealth(tracked, [stage(1, { status: 'complete', payment_status: 'unpaid' })], fresh, NOW);
    expect(h.reasons[0]).toMatchObject({ kind: 'payment_pending', stageNumber: 1 });
  });
  it('treats partial as still pending', () => {
    const h = projectHealth(tracked, [stage(1, { status: 'complete', payment_status: 'partial' })], fresh, NOW);
    expect(h.reasons.some(r => r.kind === 'payment_pending')).toBe(true);
  });
  it('does not flag an unpaid stage that is not yet complete', () => {
    const h = projectHealth(tracked, [stage(2, { status: 'active', payment_status: 'unpaid' })], fresh, NOW);
    expect(h.reasons.some(r => r.kind === 'payment_pending')).toBe(false);
  });
});

describe('stalled', () => {
  it(`is attention after ${STALL_ATTENTION_DAYS} idle days`, () => {
    const h = projectHealth({ ...tracked, updated_at: daysAgo(STALL_ATTENTION_DAYS) }, [], { lastEvidenceAt: daysAgo(STALL_ATTENTION_DAYS) }, NOW);
    expect(h.band).toBe('attention');
    expect(h.reasons[0]).toMatchObject({ kind: 'stalled', days: STALL_ATTENTION_DAYS });
  });
  it(`is at risk after ${STALL_AT_RISK_DAYS} idle days`, () => {
    const h = projectHealth({ ...tracked, updated_at: daysAgo(STALL_AT_RISK_DAYS) }, [], { lastEvidenceAt: daysAgo(STALL_AT_RISK_DAYS) }, NOW);
    expect(h.band).toBe('at_risk');
  });
  it('uses the most recent of every signal', () => {
    // updated_at is old but a message arrived yesterday: not stalled.
    const h = projectHealth({ ...tracked, updated_at: daysAgo(40) }, [], { lastMessageAt: daysAgo(1) }, NOW);
    expect(h.reasons.some(r => r.kind === 'stalled')).toBe(false);
  });
  it('falls back to updated_at when the activity RPC gave nothing', () => {
    const h = projectHealth({ ...tracked, updated_at: daysAgo(1) }, [], {}, NOW);
    expect(h.band).toBe('on_track');
  });
});

describe('band and ordering', () => {
  it('on_hold alone is attention', () => {
    const h = projectHealth({ ...tracked, status: 'on_hold' }, [], fresh, NOW);
    expect(h.band).toBe('attention');
    expect(h.reasons[0].kind).toBe('on_hold');
  });
  it('one at_risk reason sets the band regardless of how many attention reasons', () => {
    const h = projectHealth(tracked, [
      stage(1, { status: 'complete', payment_status: 'unpaid' }),
      stage(2, { status: 'active', planned_end: daysAgo(OVERDUE_AT_RISK_DAYS + 1) }),
    ], fresh, NOW);
    expect(h.band).toBe('at_risk');
  });
  it('lists the at_risk reason first, whatever order the stages came in', () => {
    const h = projectHealth(tracked, [
      stage(1, { status: 'complete', payment_status: 'unpaid' }),          // attention
      stage(2, { status: 'active', planned_end: daysAgo(OVERDUE_AT_RISK_DAYS) }), // at_risk
    ], fresh, NOW);
    expect(h.reasons[0].severity).toBe('at_risk');
  });
});

describe('latestOf', () => {
  it('picks the newest and ignores gaps', () => {
    expect(latestOf(null, daysAgo(5), undefined, daysAgo(2), daysAgo(9))).toBe(daysAgo(2));
  });
  it('is null when nothing is given', () => {
    expect(latestOf(null, undefined)).toBeNull();
  });
});
