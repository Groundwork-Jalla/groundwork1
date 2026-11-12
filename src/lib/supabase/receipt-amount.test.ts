import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), from: vi.fn(), read: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: h.rpc, from: h.from,
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) } } }));
vi.mock('./receipt-reader', () => ({ readUploadedReceipt: h.read }));
import { submitStagePaymentReceipt, uploadStagePaymentReceipt, fetchStagePayments, fetchStagePaymentsStrict, confirmStagePayment } from './verifications';

const input = { amount: '750.125', currency: 'XAF', fxRate: 600 };
const freshFile = () => new File(['receipt'], 'receipt.png', { type: 'image/png' });
let file: File;
function query(result: { data: unknown; error: unknown }) {
  const chain = { select: vi.fn(), eq: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce(result);
  const history = { select: vi.fn(), eq: vi.fn(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
  history.select.mockReturnValue(history); history.eq.mockReturnValue(history);
  h.from.mockImplementation(table => table === 'stage_payment_receipts' ? history : chain);
}
beforeEach(() => {
  file = freshFile(); vi.clearAllMocks(); h.read.mockImplementation(async (stage, path) => ({ readingId: 'reading', path, fxRate: '600' })); h.rpc.mockResolvedValue({ error: null });
  h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null });
});

describe('actual receipt amount persistence', () => {
  it('sends the exact native amount, currency and conversion snapshot to the RPC', async () => {
    await submitStagePaymentReceipt('stage', 'project/receipts/proof.png', input, 'reading');
    expect(h.rpc).toHaveBeenCalledWith('submit_stage_payment_receipt', {
      p_stage: 'stage', p_path: 'project/receipts/proof.png', p_amount: '750.125', p_currency: 'XAF', p_fx_rate: 600, p_reading: 'reading',
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

  it('keeps staged proof available for a corrected retry after a transaction rejection', async () => {
    const refusal = { code: 'P0001', message: 'not_client' };
    h.rpc.mockResolvedValueOnce({ error: refusal });
    await expect(uploadStagePaymentReceipt('project', 'stage', file, input)).rejects.toEqual(refusal);
    const path = h.upload.mock.calls[0][0];
    expect(path).toMatch(/^project\/receipts\//);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('requires a matched server reading before any receipt submission', async () => {
    h.read.mockRejectedValueOnce(new Error('receipt_amount_mismatch'));
    await expect(uploadStagePaymentReceipt('project', 'stage', file, input)).rejects.toThrow('receipt_amount_mismatch');
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('submits a foreign receipt with the server conversion instead of a browser rate', async () => {
    h.read.mockImplementationOnce(async (stage, path) => ({ readingId: 'foreign', path, fxRate: '0.800000000000' }));
    await uploadStagePaymentReceipt('project', 'stage', file, { amount: '80', currency: 'EUR' });
    expect(h.read).toHaveBeenCalledWith('stage', expect.any(String), '80', 'EUR');
    expect(h.rpc).toHaveBeenCalledWith('submit_stage_payment_receipt', expect.objectContaining({
      p_amount: '80', p_currency: 'EUR', p_fx_rate: '0.800000000000', p_reading: 'foreign',
    }));
  });

  it('replaces a supplied local estimate with the attested receipt rate', async () => {
    h.read.mockImplementationOnce(async (stage, path) => ({ readingId: 'foreign', path, fxRate: '0.800000000000' }));
    await uploadStagePaymentReceipt('project', 'stage', file, { amount: '80', currency: 'EUR', fxRate: 0.95 });
    expect(h.rpc.mock.calls[0][1].p_fx_rate).toBe('0.800000000000');
  });

  it('retries an ambiguous commit with the same file and reading identity', async () => {
    h.rpc.mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(uploadStagePaymentReceipt('project', 'stage', file, input)).rejects.toThrow();
    await uploadStagePaymentReceipt('project', 'stage', file, input);
    expect(h.upload).toHaveBeenCalledOnce(); expect(h.read).toHaveBeenCalledOnce();
    expect(h.rpc.mock.calls[0]).toEqual(h.rpc.mock.calls[1]);
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
