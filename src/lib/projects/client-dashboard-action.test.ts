import { describe, expect, it } from 'vitest';
import { clientDashboardAction } from './client-dashboard-action';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';

const project: ProjectRow = {
  id: 'p', user_id: 'client', name: 'Home', country: 'CM', city: 'Douala', project_type: 'residential', building_type: 'single_family',
  num_floors: 2, sqm: 200, finish_level: 'standard', has_boys_quarters: false, bq_rooms: 0, roof_type: 'concrete_flat',
  bedrooms: 4, bathrooms: 3, living_rooms: 1, kitchens: 1, offices: 0, floor_rooms: null,
  status: 'active', tracking_started_at: '2026-11-15', workflow_origin: 'contractor', tier: 'self_verify', current_stage: 4,
  budget_source: 'boq', budget_currency: 'XAF', budget_amount: 60_000_000, budget_usd: 100_000, budget_fx_rate: 600,
  budget_fx_recorded_at: '2026-11-15', target_start: null, target_end: null, created_at: '2026-11-15', updated_at: '2026-11-15',
};
const stage = { id: 's', stage_number: 4, status: 'active', pre_existing: false, payment_milestone_usd: 10_000, milestone_amount: 6_000_000 } as ProjectStageRow;
const update = { id: 'u', stage_id: 's', status: 'pending_review', evidence_urls: ['p/footings.jpg'] } as ProjectSubstageRow;
const payment: StagePayment = { id: 'pay', stageId: 's', amount: 10_000, state: 'expected', receipts: [], receiptPath: null, receiptUploadedAt: null };
const decide = (changes: { project?: Partial<ProjectRow>; stage?: Partial<ProjectStageRow>; updates?: ProjectSubstageRow[]; payment?: StagePayment; primary?: boolean } = {}) =>
  clientDashboardAction({ ...project, ...changes.project }, [{ ...stage, ...changes.stage }], changes.updates ?? [update], new Map([['s', changes.payment ?? payment]]), changes.primary ?? true);

describe('client dashboard shortcuts preserve project gates', () => {
  it('directs contractor-created work to the evidence review before payment', () => expect(decide()).toEqual({ kind: 'review', stageNumber: 4 }));
  it('does not ask a client to pay before approving contractor-created work', () => expect(decide({ updates: [] }).kind).toBe('waiting'));
  it('offers payment for the same reviewed contractor-created stage', () => expect(decide({ stage: { review_payment_pending: true } })).toEqual({ kind: 'receipt', stageNumber: 4 }));
  it('keeps client-created work behind the existing funding confirmation', () => expect(decide({ project: { workflow_origin: 'client' }, stage: { status: 'locked' } }).kind).toBe('receipt'));
  it('does not represent an uploaded proof as confirmed payment', () => expect(decide({ stage: { review_payment_pending: true }, payment: { ...payment, state: 'receipt_submitted' } }).kind).toBe('pending'));
  it('keeps pending proofs separate even if earlier funds already authorized work', () => expect(decide({ stage: { review_payment_pending: true }, payment: { ...payment, state: 'funded', receipts: [{ id: 'proof', decision: 'pending', amount: 3_000_000, currency: 'XAF' }] as any } }).kind).toBe('pending'));
  it('keeps a confirmed partial balance available for an additional receipt', () => expect(decide({ stage: { review_payment_pending: true }, payment: { ...payment, state: 'funded', receipts: [{ id: 'proof', decision: 'received', amount: 3_000_000, currency: 'XAF' }] as any } }).kind).toBe('receipt'));
  it.each([false])('offers observers a project view rather than approval/payment shortcuts', primary => expect(decide({ primary })).toEqual({ kind: 'view' }));
  it.each(['on_hold', 'completed', 'archived'] as const)('does not offer a mutation for a %s project', status => expect(decide({ project: { status } })).toEqual({ kind: 'view' }));
  it('does not offer payment or approval before tracking starts', () => expect(decide({ project: { tracking_started_at: null } })).toEqual({ kind: 'view' }));
  it('does not use a completed historical stage as the current action', () => expect(decide({ stage: { pre_existing: true, status: 'complete' } })).toEqual({ kind: 'view' }));
  it('does not invent a client review when evidence is missing', () => expect(decide({ updates: [{ ...update, evidence_urls: [] }] }).kind).toBe('waiting'));
  it('does not offer another receipt when the full native stage amount is confirmed', () => expect(decide({ stage: { review_payment_pending: true }, payment: { ...payment, state: 'funded', receipts: [{ id: 'proof', decision: 'received', amount: 6_000_000, currency: 'XAF' }] as any } }).kind).toBe('waiting'));
  it('does not turn a zero-cost stage into a receipt request', () => expect(decide({ stage: { milestone_amount: 0, payment_milestone_usd: 0 }, updates: [] }).kind).toBe('waiting'));
});
