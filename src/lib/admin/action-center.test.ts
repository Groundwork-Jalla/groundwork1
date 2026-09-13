import { describe, expect, it } from 'vitest';
import { actionCenterItems, ageHours, stageLink, type ActionCenterInput } from './action-center';
import type { StageVerification } from '@/lib/supabase/verifications';

/**
 * 03 §5, one case per row. Inputs are shaped like the rows the admin reads; nothing here
 * is displayed anywhere — the function is pure and the Overview calls it on real rows.
 */
const NOW = new Date('2026-09-13T12:00:00Z');
const P = { id: 'p1', name: 'House', status: 'active', tier: 'jalla_verify', tracking_started_at: '2026-09-01T00:00:00Z', created_at: '2026-08-30T00:00:00Z', ownerName: 'Ada' };
const stage = (n: number, status: string, over: Partial<ActionCenterInput['stages'][0]> = {}) =>
  ({ id: `s${n}`, project_id: 'p1', stage_number: n, status, verification_required: true, payment_milestone_usd: 1000, completed_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z', ...over });
const v = (over: Partial<StageVerification>): StageVerification => ({
  id: 'v1', stageId: 's1', projectId: 'p1', verifierId: 'd', requestedBy: 'a', requestedAt: '2026-09-11T10:00:00Z', visitedAt: null,
  decision: 'pending', findings: null, checklist: null, decidedAt: null, recordedBy: null, recordedOnBehalfOf: null, reason: null, certificateId: null, ...over,
});
const base = (over: Partial<ActionCenterInput> = {}): ActionCenterInput => ({
  projects: [P], stages: [], verifications: [], verifiers: [{ projectId: 'p1', active: 1 }], siteUpdates: [], payments: [], ledgerAvailable: true,
  unmatchedEvents: [], waiting: [], applications: [], inquiries: [], tickets: [], ...over,
});
const kinds = (input: ActionCenterInput) => actionCenterItems(input, NOW).map(i => i.kind);

describe('Action Center rules (03 §5)', () => {
  it('budget unconfirmed — Management project without tracking → high → Budgets', () => {
    const items = actionCenterItems(base({ projects: [{ ...P, tier: 'jalla_management', tracking_started_at: null }], verifiers: [] }), NOW);
    expect(items.map(i => [i.kind, i.priority, i.to])).toEqual([['budget_unconfirmed', 'high', '/admin/budgets']]);
  });
  it('verifier assignment missing — tracked, verification required, zero active verifiers', () => {
    expect(kinds(base({ stages: [stage(1, 'active')], verifiers: [] }))).toEqual(['verifier_assignment_missing']);
    expect(kinds(base({ stages: [stage(1, 'active')] }))).toEqual([]);
  });
  it('verifier selection needed — pending_review, required, nobody asked', () => {
    expect(kinds(base({ stages: [stage(1, 'pending_review')] }))).toEqual(['verifier_selection_needed']);
  });
  it('verification due — a pending decision; critical after five days', () => {
    expect(actionCenterItems(base({ stages: [stage(1, 'pending_review')], verifications: [v({})] }), NOW).map(i => [i.kind, i.priority]))
      .toEqual([['verification_due', 'high']]);
    expect(actionCenterItems(base({ stages: [stage(1, 'pending_review')], verifications: [v({ requestedAt: '2026-09-01T00:00:00Z' })] }), NOW)[0].priority).toBe('critical');
  });
  it('stage ready to approve — verified, still pending_review → Stages & Reviews', () => {
    const items = actionCenterItems(base({ stages: [stage(1, 'pending_review')], verifications: [v({ decision: 'verified', visitedAt: '2026-09-11T11:00:00Z', decidedAt: '2026-09-11T12:00:00Z' })] }), NOW);
    expect(items.map(i => [i.kind, i.to])).toEqual([['stage_ready_to_approve', '/admin/reviews']]);
  });
  it('evidence requested — rejected and nothing new since', () => {
    expect(kinds(base({ stages: [stage(1, 'active')], verifications: [v({ decision: 'rejected', decidedAt: '2026-09-11T12:00:00Z' })] }))).toEqual(['evidence_requested']);
    // a site update after the decision clears it
    expect(kinds(base({ stages: [stage(1, 'active')], verifications: [v({ decision: 'rejected', decidedAt: '2026-09-11T12:00:00Z' })], siteUpdates: [{ stageId: 's1', submittedAt: '2026-09-12T00:00:00Z' }] }))).toEqual([]);
  });
  it('awaiting funding vs payment ready — approved + verified, ledger short vs covered', () => {
    const verified = v({ decision: 'verified', visitedAt: '2026-09-11T11:00:00Z', decidedAt: '2026-09-11T12:00:00Z' });
    const short  = base({ stages: [stage(1, 'complete')], verifications: [verified], payments: [{ id: 'i', projectId: 'p1', stageId: 's1', direction: 'in', state: 'funded', amount: 999, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z' }] });
    const funded = base({ stages: [stage(1, 'complete')], verifications: [verified], payments: [{ id: 'i', projectId: 'p1', stageId: 's1', direction: 'in', state: 'funded', amount: 1000, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z' }] });
    expect(kinds(short)).toEqual(['awaiting_funding']);
    expect(kinds(funded)).toEqual(['payment_ready']);
    // no ledger at all (090 absent) → neither
    expect(kinds(base({ stages: [stage(1, 'complete')], verifications: [verified], ledgerAvailable: false }))).toEqual([]);
  });
  it('a $0 stage raises no payment item \u2014 the database would refuse the release', () => {
    const verified = v({ decision: 'verified', visitedAt: '2026-09-11T11:00:00Z', decidedAt: '2026-09-11T12:00:00Z' });
    expect(kinds(base({ stages: [stage(1, 'complete', { payment_milestone_usd: 0 })], verifications: [verified] }))).toEqual([]);
    expect(kinds(base({ stages: [stage(1, 'complete', { payment_milestone_usd: null })], verifications: [verified] }))).toEqual([]);
  });
  it('disbursement failed \u2014 failed/reconciling out rows and unmatched provider events are critical', () => {
    const items = actionCenterItems(base({ stages: [stage(1, 'complete')], payments: [{ id: 'o', projectId: 'p1', stageId: 's1', direction: 'out', state: 'failed', amount: 1000, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T01:00:00Z' }], unmatchedEvents: [{ id: 'e', receivedAt: '2026-09-12T02:00:00Z' }] }), NOW);
    expect(items.map(i => [i.kind, i.priority])).toEqual([['disbursement_failed', 'critical'], ['disbursement_failed', 'critical']]);
  });
  it('unanswered conversations carry the database’s band and go to the Inbox', () => {
    const items = actionCenterItems(base({ waiting: [{ conversationId: 'c', projectId: 'p1', personName: 'Ada', waitingSince: '2026-09-13T06:00:00Z', band: 'high' }] }), NOW);
    expect(items[0]).toMatchObject({ kind: 'unanswered_conversation', priority: 'high', projectName: 'House', to: '/admin/inbox' });
  });
  it('the three queues become one item per row', () => {
    const items = actionCenterItems(base({ applications: [{ id: 'a', label: 'Bob', since: '2026-09-12T00:00:00Z' }], inquiries: [{ id: 'q', label: 'Roof', since: '2026-09-12T00:00:00Z' }], tickets: [{ id: 't', label: 'Login', since: '2026-09-12T00:00:00Z' }] }), NOW);
    expect(items.map(i => i.kind)).toEqual(['application_to_decide', 'quote_request_open', 'support_ticket_open']);
    expect(items[0].to).toBe('/admin/applications/a');
  });
  it('sorted by priority then age; archived and completed projects contribute nothing', () => {
    const items = actionCenterItems(base({
      projects: [P, { ...P, id: 'p2', name: 'Done', status: 'completed', tier: 'jalla_management', tracking_started_at: null }],
      stages: [stage(1, 'pending_review'), { ...stage(2, 'complete'), id: 's2' }],
      payments: [{ id: 'o', projectId: 'p1', stageId: 's2', direction: 'out', state: 'failed', amount: 1, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' }],
      tickets: [{ id: 't', label: 'x', since: '2026-09-01T00:00:00Z' }],
    }), NOW);
    expect(items.map(i => i.priority)).toEqual(['critical', 'high', 'medium']);
    expect(items.some(i => i.projectId === 'p2')).toBe(false);
  });
  it('the stage link is the Workspace once it exists, the review queue until then (TEMPORARY)', () => {
    expect(stageLink('p1', 's1', false)).toBe('/admin/reviews');
    expect(stageLink('p1', 's1', true)).toBe('/admin/projects/p1?tab=stages&stage=s1');
  });
  it('ageHours never goes negative', () => {
    expect(ageHours('2026-09-13T11:00:00Z', NOW)).toBe(1);
    expect(ageHours('2026-09-13T13:00:00Z', NOW)).toBe(0);
  });
});
