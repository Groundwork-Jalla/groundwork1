import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), from: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: h.rpc, from: h.from,
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) } } }));
import { submitStagePaymentReceipt, uploadStagePaymentReceipt, fetchStagePayments, fetchStagePaymentsStrict, confirmStagePayment } from './verifications';

const input = { amount: '750.125', currency: 'XAF', fxRate: 600 };
const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
function query(result: { data: unknown; error: unknown }) {
  const chain = { select: vi.fn(), eq: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce(result);
  h.from.mockReturnValue(chain);
}
beforeEach(() => {
  vi.clearAllMocks(); h.rpc.mockResolvedValue({ error: null });
  h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null });
});

describe('actual receipt amount persistence', () => {
  it('sends the exact native amount, currency and conversion snapshot to the RPC', async () => {
    await submitStagePaymentReceipt('stage', 'project/receipts/proof.png', input);
    expect(h.rpc).toHaveBeenCalledWith('submit_stage_payment_receipt', {
      p_stage: 'stage', p_path: 'project/receipts/proof.png', p_amount: '750.125', p_currency: 'XAF', p_fx_rate: 600,
    });
  });

  it('preserves the full database timestamp in the confirmation snapshot', async () => {
    await confirmStagePayment('stage', undefined,
      { path: 'project/receipts/proof.png', uploadedAt: '2026-11-12T01:00:00.123456+00:00' });
    expect(h.rpc).toHaveBeenCalledWith('confirm_stage_payment', {
      p_stage: 'stage', p_note: null, p_receipt_path: 'project/receipts/proof.png',
      p_receipt_uploaded_at: '2026-11-12T01:00:00.123456+00:00',
    });
  });

  it.each([
    { ...input, amount: '-1' }, { ...input, amount: '0' }, { ...input, amount: '12.1234567' },
    { ...input, currency: 'xaf' }, { ...input, fxRate: Infinity }, { ...input, currency: 'USD', fxRate: 600 },
  ])('rejects invalid input before writing a receipt file: %j', async bad => {
    await expect(uploadStagePaymentReceipt('project', 'stage', file, bad)).rejects.toThrow();
    expect(h.upload).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
  });

  it('retains proof on an ambiguous network failure because the RPC may have committed', async () => {
    h.rpc.mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(uploadStagePaymentReceipt('project', 'stage', file, input)).rejects.toThrow('connection lost');
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('cleans the new receipt file after a definite transaction rejection', async () => {
    const refusal = { code: 'P0001', message: 'not_client' };
    h.rpc.mockResolvedValueOnce({ error: refusal });
    await expect(uploadStagePaymentReceipt('project', 'stage', file, input)).rejects.toEqual(refusal);
    const path = h.upload.mock.calls[0][0];
    expect(path).toMatch(/^project\/receipts\//);
    expect(h.remove).toHaveBeenCalledWith([path]);
  });

  it('reads native receipt values separately from the scheduled ledger amount', async () => {
    query({ error: null, data: [{ id: 'incoming', stage_id: 'stage', state: 'receipt_submitted', amount: '100',
      receipt_amount: '750.125', receipt_currency: 'XAF', receipt_fx_rate: '600', receipt_amount_usd: '1.250208333' }] });
    const payments = await fetchStagePaymentsStrict('project');
    expect(payments.get('stage')).toMatchObject({ amount: 100, receiptAmount: 750.125,
      receiptCurrency: 'XAF', receiptFxRate: 600, receiptAmountUsd: 1.250208333 });
  });

  it('does not invent actual amounts for older rows', async () => {
    query({ error: null, data: [{ id: 'incoming', stage_id: 'stage', state: 'funded', amount: 100 }] });
    expect((await fetchStagePaymentsStrict('project')).get('stage')).toMatchObject({ amount: 100,
      receiptAmount: null, receiptCurrency: null, receiptFxRate: null, receiptAmountUsd: null });
  });

  it('distinguishes a failed money-summary read from an empty ledger', async () => {
    const error = { code: '42501', message: 'not allowed' };
    query({ error, data: null });
    await expect(fetchStagePaymentsStrict('project')).rejects.toEqual(error);
    query({ error, data: null });
    expect(await fetchStagePayments('project')).toEqual(new Map());
    query({ error: null, data: [] });
    expect(await fetchStagePaymentsStrict('project')).toEqual(new Map());
  });
});
