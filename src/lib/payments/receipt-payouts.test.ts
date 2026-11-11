import { describe, expect, it } from 'vitest';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';
import { receiptPayoutSummary } from './receipt-payouts';

const bill = (patch: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'project', country: 'US', budget_source: 'boq', budget_amount: 1000,
  budget_currency: 'USD', budget_fx_rate: 1, budget_precision: 2,
  budget_usd: 1000, ...patch,
} as ProjectRow);

const stage = (id = 'stage', number = 1, patch: Partial<ProjectStageRow> = {}): ProjectStageRow => ({
  id, project_id: 'project', stage_number: number, stage_key: 'foundation',
  budget_pct: 10, payment_milestone_usd: 100, milestone_amount: 100,
  status: 'active', pre_existing: false, ...patch,
} as ProjectStageRow);

const receipt = (id = 'receipt', stageId = 'stage', native = 80, patch: Partial<StagePayment> = {}): StagePayment => ({
  id, stageId, state: 'funded', amount: 100,
  receiptPath: 'project/receipts/receipt.pdf', receiptUploadedAt: '2026-11-12T00:00:00Z',
  receiptAmount: native, receiptCurrency: 'USD', receiptFxRate: 1, receiptAmountUsd: native,
  ...patch,
});

describe('actual receipts are the project payouts', () => {
  it.each([80, 120])('uses receipt %s instead of the scheduled stage amount', actual => {
    const allocation = stage();
    const summary = receiptPayoutSummary(bill(), [allocation], [receipt('receipt', 'stage', actual)]);
    expect(summary.payouts).toEqual({ amount: actual, usd: actual });
    expect(summary.remaining).toEqual({ amount: 1000 - actual, usd: 1000 - actual });
    expect(summary.currentStage).toEqual({ amount: 100, usd: 100 });
    expect(allocation.payment_milestone_usd).toBe(100);
  });

  it('counts a submitted receipt as pending until the contractor acknowledges it', () => {
    const pending = receipt('receipt', 'stage', 80, { state: 'receipt_submitted' });
    const before = receiptPayoutSummary(bill(), [stage()], [pending]);
    expect(before.payouts).toEqual({ amount: 0, usd: 0 });
    expect(before.pending).toEqual({ amount: 80, usd: 80 });
    expect(before.remaining).toEqual({ amount: 1000, usd: 1000 });
    expect([before.confirmedCount, before.pendingCount]).toEqual([0, 1]);
    const after = receiptPayoutSummary(bill(), [stage()], [{ ...pending, state: 'funded' }]);
    expect(after.payouts).toEqual({ amount: 80, usd: 80 });
    expect(after.pending).toEqual({ amount: 0, usd: 0 });
    expect([after.confirmedCount, after.pendingCount]).toEqual([1, 0]);
  });

  it('does not turn an expected payment or a completed stage into money received', () => {
    const summary = receiptPayoutSummary(bill(), [stage('stage', 1, { status: 'complete' })],
      [receipt('receipt', 'stage', 80, { state: 'expected' })]);
    expect(summary.payouts.amount).toBe(0);
    expect(summary.pending.amount).toBe(0);
    expect(summary.confirmedCount).toBe(0);
    expect(summary.currentStage).toBeNull();
  });

  it('counts reconciled confirmations and reports overbudget separately', () => {
    const summary = receiptPayoutSummary(bill({ budget_amount: 100, budget_usd: 100 }), [stage()],
      [receipt('receipt', 'stage', 120, { state: 'reconciled' })]);
    expect(summary.payouts).toEqual({ amount: 120, usd: 120 });
    expect(summary.remaining).toEqual({ amount: 0, usd: 0 });
    expect(summary.overBudget).toEqual({ amount: 20, usd: 20 });
  });

  it('sums source decimals exactly', () => {
    const summary = receiptPayoutSummary(bill({ budget_amount: 0.5, budget_usd: 0.5 }),
      [stage('one'), stage('two', 2)], [receipt('one', 'one', 0.1), receipt('two', 'two', 0.2)]);
    expect(summary.payouts).toEqual({ amount: 0.3, usd: 0.3 });
    expect(summary.remaining).toEqual({ amount: 0.2, usd: 0.2 });
    expect(summary.overBudget).toEqual({ amount: 0, usd: 0 });
  });

  it('keeps six native and nine USD decimal places independent of BOQ display precision', () => {
    const summary = receiptPayoutSummary(bill({ budget_precision: 0, budget_amount: 1, budget_usd: 0.333333333,
      budget_currency: 'XAF', budget_fx_rate: 3 }),
      [stage('one'), stage('two', 2)], [
        receipt('one', 'one', 0.123456, { receiptCurrency: 'XAF', receiptFxRate: 3, receiptAmountUsd: 0.041152 }),
        receipt('two', 'two', 0.000001, { receiptCurrency: 'XAF', receiptFxRate: 3, receiptAmountUsd: 0.000000333 }),
      ]);
    expect(summary.payouts).toEqual({ amount: 0.123457, usd: 0.041152333 });
    expect(summary.remaining).toEqual({ amount: 0.876543, usd: 0.292181 });
  });
});

describe('history and repeated reads do not invent payouts', () => {
  it('preserves historical BOQ value and removes it from the managed budget', () => {
    const project = bill({ budget_amount: 1000.125, budget_usd: 1000.125, budget_precision: 3 });
    const historical = stage('built', 1, { status: 'complete', pre_existing: true,
      milestone_amount: 300.025, payment_milestone_usd: 300.025 });
    const future = stage('stage', 2, { milestone_amount: 700.1, payment_milestone_usd: 700.1 });
    const summary = receiptPayoutSummary(project, [historical, future], [
      receipt('historic', 'built', 300.025), receipt('new', 'stage', 100.025),
    ]);
    expect(summary.payouts).toEqual({ amount: 100.025, usd: 100.025 });
    expect(summary.remaining).toEqual({ amount: 600.075, usd: 600.075 });
    expect(summary.confirmedCount).toBe(1);
    expect(summary.currentStage).toEqual({ amount: 700.1, usd: 700.1 });
    expect(historical.milestone_amount).toBe(300.025);
    expect(project.budget_amount).toBe(1000.125);
  });

  it('keeps zero-value current stages zero and finds stages by construction order', () => {
    const summary = receiptPayoutSummary(bill(), [
      stage('later', 3),
      stage('zero', 2, { budget_pct: 0, milestone_amount: 0, payment_milestone_usd: 0 }),
      stage('built', 1, { status: 'complete', pre_existing: true, milestone_amount: 0, payment_milestone_usd: 0 }),
    ], []);
    expect(summary.currentStage).toEqual({ amount: 0, usd: 0 });
  });

  it('does not count duplicate reads twice, including old pending snapshots', () => {
    const pending = receipt('receipt', 'stage', 80, { state: 'receipt_submitted' });
    const confirmed = { ...pending, state: 'funded' as const };
    for (const rows of [[pending, confirmed, confirmed], [confirmed, pending, confirmed]]) {
      const summary = receiptPayoutSummary(bill(), [stage()], rows);
      expect(summary.payouts).toEqual({ amount: 80, usd: 80 });
      expect(summary.pending.amount).toBe(0);
      expect([summary.confirmedCount, summary.pendingCount]).toEqual([1, 0]);
    }
  });

  it('ignores payments that belong to unknown stages', () => {
    const summary = receiptPayoutSummary(bill(), [stage()], [receipt('other', 'another-project', 500)]);
    expect(summary.payouts.amount).toBe(0);
    expect(summary.confirmedCount).toBe(0);
  });

  it('does not guess missing legacy receipt amounts from the scheduled payment', () => {
    const summary = receiptPayoutSummary(bill(), [stage()], [receipt('legacy', 'stage', 80, {
      amount: 900, receiptAmount: null, receiptCurrency: null, receiptFxRate: null, receiptAmountUsd: null,
    })]);
    expect(summary.payouts.amount).toBe(0);
    expect(summary.missingConfirmedCount).toBe(1);
    expect(summary.confirmedCount).toBe(1);
    expect(summary.remaining).toBeNull();
    expect(summary.overBudget).toBeNull();
  });

  it('keeps missing pending amounts separate from confirmed money and the remaining budget', () => {
    const summary = receiptPayoutSummary(bill(), [stage()], [receipt('legacy', 'stage', 80, {
      state: 'receipt_submitted', receiptAmount: null,
    })]);
    expect(summary.missingPendingCount).toBe(1);
    expect(summary.missingConfirmedCount).toBe(0);
    expect(summary.remaining).toEqual({ amount: 1000, usd: 1000 });
  });
});

describe('source currencies and invalid records', () => {
  it('preserves the native receipt and uses saved USD amounts across currencies', () => {
    const project = bill({ country: 'CM', budget_currency: 'XAF', budget_fx_rate: 600,
      budget_amount: 600000, budget_usd: 1000, budget_precision: 0 });
    const rows = [
      receipt('xaf', 'one', 60000.125, { receiptCurrency: 'XAF', receiptFxRate: 600, receiptAmountUsd: 100.000208333 }),
      receipt('eur', 'two', 100, { receiptCurrency: 'EUR', receiptFxRate: 0.8, receiptAmountUsd: 125 }),
    ];
    const summary = receiptPayoutSummary(project, [stage('one'), stage('two', 2)], rows);
    expect(summary.currency).toBe('XAF');
    expect(summary.payouts).toEqual({ amount: 135000.125, usd: 225.000208333 });
    expect(summary.remaining).toEqual({ amount: 464999.875, usd: 774.999791667 });
  });

  it('uses the canonical estimate rate without accepting a browser live-rate input', () => {
    const project = bill({ country: 'CM', budget_source: 'estimate', budget_amount: null,
      budget_currency: null, budget_fx_rate: null, budget_usd: 1000 });
    const summary = receiptPayoutSummary(project, [stage()], [receipt('receipt', 'stage', 60000, {
      receiptCurrency: 'XAF', receiptFxRate: 625, receiptAmountUsd: 96,
    })]);
    expect(summary.currency).toBe('XAF');
    expect(summary.payouts).toEqual({ amount: 60000, usd: 96 });
    expect(summary.remaining).toEqual({ amount: 540000, usd: 904 });
  });

  it.each([
    { receiptAmount: -1 }, { receiptAmount: NaN }, { receiptAmount: Infinity }, { receiptAmount: 0 }, { receiptAmount: 1e13 },
    { receiptAmountUsd: -1 }, { receiptAmountUsd: NaN }, { receiptAmountUsd: Infinity }, { receiptAmountUsd: 0 },
    { receiptFxRate: 0 }, { receiptFxRate: NaN }, { receiptFxRate: Infinity },
    { receiptCurrency: 'xaf' }, { receiptCurrency: '' }, { receiptCurrency: null },
  ])('treats invalid receipt fields as unknown: %j', patch => {
    const summary = receiptPayoutSummary(bill(), [stage()], [receipt('receipt', 'stage', 80, patch)]);
    expect(summary.missingConfirmedCount).toBe(1);
    expect(summary.payouts.amount).toBe(0);
    expect(summary.remaining).toBeNull();
  });

  it('does not manufacture a remaining budget from an invalid confirmed source total', () => {
    const summary = receiptPayoutSummary(bill({ budget_amount: NaN }), [stage()], []);
    expect(summary.remaining).toBeNull();
    expect(summary.overBudget).toBeNull();
  });
});
