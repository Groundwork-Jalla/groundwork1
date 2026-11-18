import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';
import { confirmedInProjectCurrency, paymentHistoryRows, paymentOverview } from './payment-history';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

const receipt = (patch: Partial<StagePaymentReceipt>): StagePaymentReceipt => ({ id: 'r', stageId: 's3', path: 'p/receipts/a.pdf', submittedAt: '2026-11-16T10:00:00Z',
  amount: 315000, currency: 'NGN', fxRate: 1351, amountUsd: 233, decision: 'received', allowsWork: true, requestedTopUp: null, decisionNote: null, decidedAt: null,
  projectAmount: 138454, projectCurrency: 'XAF', ...patch });
const tranche = (stageId: string, receipts: StagePaymentReceipt[], patch: Partial<StagePayment> = {}): StagePayment =>
  ({ id: `pay-${stageId}`, stageId, state: 'funded', amount: 100, receiptPath: null, receiptUploadedAt: null, receipts, ...patch });

describe('the payment history a contractor reads on the Money tab', () => {
  it('lists every receipt across stages, newest first, in the money printed on it', () => {
    const rows = paymentHistoryRows(new Map([
      ['s3', tranche('s3', [receipt({ id: 'a', submittedAt: '2026-11-10T09:00:00Z' }), receipt({ id: 'b', submittedAt: '2026-11-16T09:00:00Z', amount: 24200, currency: 'XAF', projectAmount: 24200 })])],
      ['s4', tranche('s4', [receipt({ id: 'c', stageId: 's4', submittedAt: '2026-11-12T09:00:00Z' })])],
    ]));
    expect(rows.map(row => row.id)).toEqual(['b', 'c', 'a']);
    expect(rows[0]).toMatchObject({ stageId: 's3', amount: 24200, currency: 'XAF', status: 'received' });
    expect(rows[2]).toMatchObject({ amount: 315000, currency: 'NGN', projectAmount: 138454, projectCurrency: 'XAF' });
  });

  it('keeps flagged, waiting and replaced receipts in the trail, each as what it is', () => {
    const rows = paymentHistoryRows(new Map([['s3', tranche('s3', [
      receipt({ id: 'w', decision: 'pending' }), receipt({ id: 'f', decision: 'flagged', decisionNote: 'Not in my account' }),
      receipt({ id: 'x', decision: 'received', replacedBy: 'w' }),
    ])]]));
    expect(Object.fromEntries(rows.map(row => [row.id, row.status]))).toEqual({ w: 'pending', f: 'flagged', x: 'replaced' });
    expect(rows.find(row => row.id === 'f')!.note).toBe('Not in my account');
  });

  it('shows the installment only for a receipt filed under a plan', () => {
    const rows = paymentHistoryRows(new Map([['s3', tranche('s3', [
      receipt({ id: 'a', paymentPlanId: 'plan', installmentNumber: 2 }), receipt({ id: 'b', installmentNumber: 1 }),
    ])]]));
    expect(rows.find(row => row.id === 'a')!.installment).toBe(2);
    expect(rows.find(row => row.id === 'b')!.installment).toBeNull();
  });

  it('includes a receipt from before receipts were kept one by one, and nothing for a tranche with no proof', () => {
    const rows = paymentHistoryRows(new Map([
      ['old', tranche('old', [], { state: 'reconciled', receiptPath: 'p/receipts/old.jpg', receiptUploadedAt: '2026-09-01T00:00:00Z', receiptAmount: 50, receiptCurrency: 'USD' })],
      ['sent', tranche('sent', [], { state: 'receipt_submitted', receiptPath: 'p/receipts/sent.jpg', receiptUploadedAt: '2026-09-02T00:00:00Z' })],
      ['none', tranche('none', [], { state: 'expected' })],
      ['ledger', tranche('ledger', [], { state: 'funded' })],
    ]));
    expect(rows.map(row => [row.stageId, row.status])).toEqual([['sent', 'pending'], ['old', 'received']]);
  });

  it('puts a receipt with no usable date last instead of first', () => {
    const rows = paymentHistoryRows(new Map([['s3', tranche('s3', [receipt({ id: 'undated', submittedAt: '' }), receipt({ id: 'dated' })])]]));
    expect(rows.map(row => row.id)).toEqual(['dated', 'undated']);
  });

  it('totals only what the contractor confirmed, in the project currency', () => {
    const rows = paymentHistoryRows(new Map([['s3', tranche('s3', [
      receipt({ id: 'a' }), receipt({ id: 'b', amount: 24200, currency: 'XAF', projectAmount: null, projectCurrency: null }),
      receipt({ id: 'p', decision: 'pending' }), receipt({ id: 'f', decision: 'flagged' }), receipt({ id: 'x', replacedBy: 'a' }),
    ])]]));
    expect(confirmedInProjectCurrency(rows, 'XAF')).toBe(138454 + 24200);
    expect(confirmedInProjectCurrency([], 'XAF')).toBe(0);
  });

  it('withholds the total rather than leave a confirmed payment out of it', () => {
    const rows = paymentHistoryRows(new Map([['s3', tranche('s3', [receipt({ id: 'a' }), receipt({ id: 'legacy', amount: null, currency: null, projectAmount: null, projectCurrency: null })])]]));
    expect(confirmedInProjectCurrency(rows, 'XAF')).toBeNull();
  });

  it('is on the contractor Money tab, read-only, in both languages', () => {
    const page = readFileSync('src/app/routes/work/projects.detail.tsx', 'utf8');
    expect(page).toContain('<ProjectPaymentHistory stagePayments={stagePayments}');
    const panel = readFileSync('src/components/project/ProjectPaymentHistory.tsx', 'utf8');
    expect(panel).not.toMatch(/decideStagePaymentReceipt|uploadStagePaymentReceipt|\.rpc\(/);
    for (const key of ['paymentHistory', 'paymentHistoryHelp', 'paymentHistoryEmpty', 'paymentHistoryConfirmed']) {
      expect(typeof (en as any).contractorMoney[key], key).toBe('string'); expect(typeof (fr as any).contractorMoney[key], key).toBe('string');
    }
  });
});

describe('where each stage stands, for the homeowner payment history (18 Nov mock-up)', () => {
  const stages = [
    { id: 's2', stage_number: 2, milestone_amount: 900000, pre_existing: true },
    { id: 's4', stage_number: 4, milestone_amount: 6000000 },
    { id: 's3', stage_number: 3, milestone_amount: 1200000 },
    { id: 's6', stage_number: 6, milestone_amount: 8400000 },
  ];
  const xaf = (patch: Partial<StagePaymentReceipt>) => receipt({ currency: 'XAF', projectCurrency: 'XAF', fxRate: null, amountUsd: null, ...patch });
  const payments = new Map<string, StagePayment>([
    ['s2', tranche('s2', [xaf({ id: 'old', amount: 900000, projectAmount: 900000 })])],
    ['s3', tranche('s3', [xaf({ id: 'f', decision: 'flagged', amount: 1200000, projectAmount: 1200000 }), xaf({ id: 'x', replacedBy: 'f', amount: 1100000, projectAmount: 1100000 })])],
    ['s4', tranche('s4', [receipt({ id: 'usd', stageId: 's4', amount: 2500, currency: 'USD', projectAmount: 1500000 }), xaf({ id: 'b', stageId: 's4', amount: 4500000, projectAmount: 4500000 })])],
    ['s6', tranche('s6', [], { state: 'expected' })],
  ]);

  it('uses the stage cards’ rule: flagged and replaced receipts count for nothing', () => {
    const overview = paymentOverview(stages, payments, 'XAF', 600);
    expect(overview.stages.map(row => [row.stageNumber, row.standing, row.received, row.due]))
      .toEqual([[3, 'flagged', 0, 1200000], [4, 'paid', 6000000, 6000000], [6, 'unpaid', 0, 8400000]]);
    expect(overview).toMatchObject({ received: 6000000, pending: 0, due: 15600000, remaining: 9600000 });
  });

  it('leaves out a stage built before Groundwork, and keeps a waiting receipt apart from paid', () => {
    const waiting = new Map(payments).set('s6', tranche('s6', [xaf({ id: 'w', stageId: 's6', decision: 'pending', amount: 3000000, projectAmount: 3000000 })], { state: 'receipt_submitted' }));
    const overview = paymentOverview(stages, waiting, 'XAF', 600);
    expect(overview.stages.some(row => row.stageId === 's2')).toBe(false);
    expect(overview.stages.find(row => row.stageId === 's6')).toMatchObject({ standing: 'pending', received: 0, pending: 3000000 });
    expect(overview).toMatchObject({ received: 6000000, pending: 3000000, remaining: 9600000 });
  });

  it('withholds a total it cannot complete rather than print a smaller one', () => {
    const unknown = new Map(payments).set('s6', tranche('s6', [receipt({ id: 'n', stageId: 's6', amount: null, currency: null, amountUsd: null, projectAmount: null, projectCurrency: null })]));
    const overview = paymentOverview(stages, unknown, 'XAF', 600);
    expect(overview.received).toBeNull(); expect(overview.remaining).toBeNull();
    expect(overview.due).toBe(15600000);
  });

  it('records which part of a stage a receipt pays for', () => {
    const rows = paymentHistoryRows(new Map([['s5', tranche('s5', [receipt({ id: 'p', substageId: 'sub-1' })])]]));
    expect(rows[0].substageId).toBe('sub-1');
  });
});
