import { describe, expect, it } from 'vitest';
import { contractorNextStep, receiptsToConfirm, type NextStepInput } from './contractor-next-step';

const stage = (n: number, status: string, extra: Record<string, unknown> = {}) => ({ id: `s${n}`, stage_number: n, status, review_payment_pending: false, pre_existing: false, ...extra }) as any;
const receipt = (id: string, decision: string, extra: Record<string, unknown> = {}) => ({ id, decision, replacedBy: null, ...extra }) as any;
const base = (patch: Partial<NextStepInput<any>> = {}): NextStepInput<any> => ({
  stages: [stage(1, 'complete'), stage(2, 'active')], current: stage(2, 'active'), stagePayments: new Map(),
  canDecide: () => true, inviteHomeowner: false, items: [{ id: 'a', status: 'pending', evidence_urls: [] }],
  canUploadItem: () => true, uploadBlocked: null, ...patch,
});

describe('the contractor\'s next step', () => {
  it('puts a waiting receipt first, oldest stage first, and skips replaced and decided ones', () => {
    const stagePayments = new Map<string, any>([
      ['s2', { receipts: [receipt('late', 'pending')] }],
      ['s1', { receipts: [receipt('done', 'received'), receipt('old', 'pending', { replacedBy: 'x' }), receipt('first', 'pending')] }],
    ]);
    expect(contractorNextStep(base({ stagePayments, inviteHomeowner: true }))).toMatchObject({ kind: 'receipt', stageId: 's1', receipt: { id: 'first' } });
    expect(receiptsToConfirm(base().stages, stagePayments, () => true).map(row => row.receipt.id)).toEqual(['first', 'late']);
  });

  it('offers no receipt to someone who may not decide on it', () => {
    const stagePayments = new Map<string, any>([['s2', { receipts: [receipt('r', 'pending')] }]]);
    expect(contractorNextStep(base({ stagePayments, canDecide: () => false }))).toMatchObject({ kind: 'upload' });
  });

  it('then the homeowner invitation, then the first part with nothing uploaded yet', () => {
    expect(contractorNextStep(base({ inviteHomeowner: true }))).toEqual({ kind: 'invite' });
    expect(contractorNextStep(base({ items: [{ id: 'a', status: 'pending', evidence_urls: ['x'] }, { id: 'b', status: 'pending', evidence_urls: [] }] })))
      .toEqual({ kind: 'upload', stageId: 's2', itemId: 'b' });
  });

  it('says the homeowner is reviewing when every open part has updates', () => {
    expect(contractorNextStep(base({ items: [{ id: 'a', status: 'pending', evidence_urls: ['x'] }] }))).toEqual({ kind: 'awaitReview', stageId: 's2', stageNumber: 2 });
  });

  it('says the homeowner\'s payment is awaited when uploads are closed for money', () => {
    expect(contractorNextStep(base({ canUploadItem: () => false, uploadBlocked: 'payment' }))).toEqual({ kind: 'awaitPayment', stageId: 's2', stageNumber: 2 });
    expect(contractorNextStep(base({ current: stage(2, 'pending_review', { review_payment_pending: true }), items: [] }))).toMatchObject({ kind: 'awaitPayment' });
  });

  it('invents nothing on a paused project or with no stage to work', () => {
    expect(contractorNextStep(base({ canUploadItem: () => false, uploadBlocked: 'paused' }))).toBeNull();
    expect(contractorNextStep(base({ current: undefined }))).toBeNull();
  });
});
