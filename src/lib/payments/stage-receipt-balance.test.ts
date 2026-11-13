import { describe, expect, it } from 'vitest';
import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';
import { stageReceiptBalance } from './stage-receipt-balance';

const receipt = (patch: Partial<StagePaymentReceipt> = {}): StagePaymentReceipt => ({
  id: 'receipt', stageId: 'stage', path: 'proof', submittedAt: '', amount: 30, currency: 'USD',
  fxRate: 1, amountUsd: 30, decision: 'received', allowsWork: false, requestedTopUp: null,
  decisionNote: null, decidedAt: null, projectAmount: 18000, projectCurrency: 'XAF', projectFxRate: 600, ...patch,
});
const payment = (receipts: StagePaymentReceipt[]): StagePayment => ({
  id: 'ledger', stageId: 'stage', amount: 100, state: 'receipt_submitted',
  receiptPath: 'proof', receiptUploadedAt: '', receipts,
});

describe('stage balances across partial payments and currencies', () => {
  it('subtracts confirmed partial funds while pending funds await the contractor decision', () => {
    const first = receipt(); const second = receipt({ id: 'top-up', amount: 50, amountUsd: 50, projectAmount: 30000, decision: 'pending' });
    expect(stageReceiptBalance(payment([first, second]), 'XAF', 600, 60000))
      .toEqual({ received: 18000, pending: 30000, remaining: 42000 });
    expect(stageReceiptBalance(payment([first, { ...second, decision: 'received' }]), 'XAF', 600, 60000))
      .toEqual({ received: 48000, pending: 0, remaining: 12000 });
  });
  it('uses saved project equivalents independently of a later display rate and excludes flagged receipts', () => {
    const eur = receipt({ id: 'eur', amount: 16, currency: 'EUR', fxRate: 0.8, amountUsd: 20, projectAmount: 12000 });
    const flagged = receipt({ id: 'flag', decision: 'flagged', amount: 1000, projectAmount: 600000 });
    expect(stageReceiptBalance(payment([receipt(), eur, flagged]), 'XAF', 700, 60000))
      .toEqual({ received: 30000, pending: 0, remaining: 30000 });
  });
  it('adds six-decimal source amounts without floating point drift and counts an ID once', () => {
    const first = receipt({ amount: 0.1, currency: 'XAF', projectAmount: 0.1 });
    const second = receipt({ id: 'second', amount: 0.2, currency: 'XAF', projectAmount: 0.2 });
    expect(stageReceiptBalance(payment([first, first, second]), 'XAF', 600, 0.5))
      .toEqual({ received: 0.3, pending: 0, remaining: 0.2 });
  });
  it('keeps unknown historical confirmed amounts unknown rather than using the schedule', () => {
    const legacy: StagePayment = { ...payment([]), state: 'funded' };
    expect(stageReceiptBalance(legacy, 'XAF', 600, 60000)).toEqual({ received: null, pending: 0, remaining: null });
    expect(stageReceiptBalance({ ...legacy, state: 'receipt_submitted' }, 'XAF', 600, 60000))
      .toEqual({ received: 0, pending: null, remaining: 60000 });
  });
  it('supports legacy native amounts, zero stage allocations and payments above allocation', () => {
    const native = receipt({ amount: 80000, currency: 'XAF', projectAmount: undefined, projectCurrency: undefined });
    expect(stageReceiptBalance(payment([native]), 'XAF', 600, 60000).remaining).toBe(0);
    expect(stageReceiptBalance(payment([]), 'XAF', 600, 0).remaining).toBe(0);
  });
  it('excludes superseded proof while counting its replacement once', () => {
    const old = receipt({ replacedBy: 'corrected' });
    const corrected = receipt({ id: 'corrected', amount: 40, amountUsd: 40, projectAmount: 24000 });
    expect(stageReceiptBalance(payment([old, corrected, corrected]), 'XAF', 600, 60000))
      .toEqual({ received: 24000, pending: 0, remaining: 36000 });
  });
});
