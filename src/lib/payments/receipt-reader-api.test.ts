import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), scoped: vi.fn(), reserve: vi.fn(), convert: vi.fn(), rate: vi.fn(),
  info: vi.fn(), sign: vi.fn(), download: vi.fn(), read: vi.fn(), cache: null as any,
  project: null as any,
  updates: [] as any[], stage: { id: '00000000-0000-0000-0000-000000000002', project_id: '00000000-0000-0000-0000-000000000001' } }));
vi.mock('../../../api/_lib/stripe.js', () => ({ requireUser: h.user, getSupabaseAdmin: h.admin }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: h.scoped }) }));
vi.mock('../../../api/_lib/payment-receipt-reader.js', () => ({ downloadReceipt: h.download, readPaymentReceipt: h.read }));
vi.mock('../../../api/_lib/receipt-exchange-rate.js', () => ({ receiptExchangeRate: h.rate }));
import { handler } from '../../../api/_handlers/read-payment-receipt';

function chain(result: any) {
  const q: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) q[method] = () => q;
  q.maybeSingle = () => Promise.resolve(result);
  return q;
}
const path = `${h.stage.project_id}/receipts/proof.png`;
const body = { stageId: h.stage.id, path, amount: '750.125', currency: 'XAF' };
async function request(patch = {}, method = 'POST') {
  const res: any = { code: 0, payload: null, setHeader: vi.fn(), status(code: number) { this.code = code; return this; }, json(payload: any) { this.payload = payload; return this; } };
  await handler({ method, body: { ...body, ...patch }, headers: { authorization: 'Bearer session' } }, res);
  return res;
}
beforeEach(() => {
  vi.resetAllMocks(); h.cache = null; h.updates = []; vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-key');
  h.user.mockResolvedValue({ id: 'client' }); h.scoped.mockResolvedValue({ data: { primary_client: true } });
  h.reserve.mockResolvedValue({ data: 'reading' });
  h.project = { country: 'CM', budget_source: 'boq', budget_currency: 'XAF', budget_fx_rate: '600' };
  h.convert.mockResolvedValue({ data: { fx_rate: '600.000000000000', project_currency: 'XAF', project_fx_rate: '600.000000000000', fx_source: 'project', fx_as_of: '2026-11-12T00:00:00Z' } });
  h.rate.mockResolvedValue({ rate: '1', source: 'USD', asOf: '2026-11-12T00:00:00Z' });
  h.info.mockResolvedValue({ data: { id: 'object', version: 'v1', size: 8 } });
  h.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.invalid/private-signed-file' } });
  h.download.mockResolvedValue(new Uint8Array([137,80,78,71,13,10,26,10]));
  h.read.mockResolvedValue({ reading: { is_payment_receipt: true, amount: '750.125', currency: 'XAF', confidence: 'high' }, model: 'fixture-model' });
  h.admin.mockReturnValue({ rpc: (name: string, args: unknown) => name === 'attach_receipt_conversion' ? h.convert(name, args) : h.reserve(name, args), storage: { from: () => ({ info: h.info, createSignedUrl: h.sign }) }, from: (table: string) => {
    if (table === 'project_stages') return chain({ data: h.stage });
    if (table === 'projects') return chain({ data: h.project });
    return { ...chain({ data: h.cache }), update(patch: any) { h.updates.push(patch); return chain({ error: null }); } };
  } });
});
afterEach(() => vi.unstubAllEnvs());
describe('receipt reading endpoint', () => {
  it('reads the stored private object and issues a proof only for the exact amount and currency', async () => {
    const res = await request();
    expect(res.code).toBe(200); expect(res.payload).toMatchObject({ status: 'matched', readingId: 'reading', path, fxRate: '600.000000000000', projectCurrency: 'XAF' });
    expect(h.scoped).toHaveBeenCalledWith('project_team_access', { p_project: h.stage.project_id });
    expect(h.read.mock.calls[0][0]).toEqual(await h.download.mock.results[0].value);
    expect(h.read.mock.calls[0]).toHaveLength(3); // No entered amount/budget is fed to the reader.
    expect(h.updates[0]).toMatchObject({ status: 'matched', object_id: 'object', object_version: 'v1', amount: '750.125', currency: 'XAF' });
    expect(h.updates[0].file_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(h.rate).not.toHaveBeenCalled();
    expect(h.convert).toHaveBeenCalledWith('attach_receipt_conversion', expect.objectContaining({ p_reading: 'reading', p_rate: null }));
  });
  it.each([['750.125001', 'XAF', 'receipt_amount_mismatch'], ['750.125', 'USD', 'receipt_currency_mismatch']])('does not attest a mismatch', async (amount, currency, error) => {
    const res = await request({ amount, currency });
    expect(res.code).toBe(422); expect(res.payload.error).toBe(error); expect(res.payload.readingId).toBeUndefined();
    expect(h.updates[0].status).not.toBe('matched');
    expect(h.convert).not.toHaveBeenCalled(); expect(h.rate).not.toHaveBeenCalled();
  });
  it('refuses an unclear/unpaid document', async () => {
    h.read.mockResolvedValue({ reading: { is_payment_receipt: false, amount: '750.125', currency: 'XAF', confidence: 'high' }, model: 'fixture' });
    expect((await request()).payload.error).toBe('receipt_unreadable');
  });
  it('requires the project client session, including for global contractor accounts', async () => {
    h.scoped.mockResolvedValue({ data: { assigned_contractor: true, primary_client: false } });
    expect((await request()).code).toBe(403); expect(h.reserve).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
  });
  it('rejects unrelated paths and absent sessions before downloading', async () => {
    expect((await request({ path: 'https://user-url.invalid/receipt' })).code).toBe(400);
    h.user.mockResolvedValue(null); expect((await request()).code).toBe(401); expect(h.download).not.toHaveBeenCalled();
  });
  it('invalidates a reading if the uploaded file changes while it is being read', async () => {
    h.info.mockResolvedValueOnce({ data: { id: 'object', version: 'v1' } }).mockResolvedValueOnce({ data: { id: 'object', version: 'v2' } });
    expect((await request()).payload.error).toBe('receipt_file_changed');
    expect(h.updates.some(patch => patch.status === 'matched')).toBe(false);
  });
  it('reports reader setup and rate limits without pretending the receipt matched', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ''); expect((await request()).code).toBe(503);
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture'); h.reserve.mockResolvedValue({ error: { message: 'receipt_read_rate_limit' } });
    expect((await request()).code).toBe(429); expect(h.read).not.toHaveBeenCalled();
  });
  it('blocks reusing the same receipt on another stage', async () => {
    h.cache = { submitted_by: 'client', stage_id: 'other-stage' };
    expect((await request()).payload.error).toBe('receipt_already_used'); expect(h.read).not.toHaveBeenCalled();
  });
  it('compares cached six-decimal readings without JSON-number rounding', async () => {
    h.cache = { id: 'original', submitted_by: 'client', stage_id: h.stage.id, confidence: 'high', amount: 987654321098.1234,
      amount_text: '987654321098.123456', currency: 'XAF', model: 'fixture', path, object_id: 'object', object_version: 'v1' };
    expect((await request({ amount: '987654321098.123456' })).code).toBe(200);
    expect((await request({ amount: '987654321098.1234' })).payload.error).toBe('receipt_amount_mismatch');
  });
  it('reuses the original verified proof after a lost response, including a newly uploaded duplicate', async () => {
    h.cache = { id: 'original', submitted_by: 'client', stage_id: h.stage.id, confidence: 'high', amount: 750.125, amount_text: '750.125', currency: 'XAF', model: 'fixture', path: `${h.stage.project_id}/receipts/original.png`, object_id: 'object', object_version: 'v1' };
    expect((await request()).payload).toMatchObject({ status: 'matched', readingId: 'original', path: h.cache.path });
    expect(h.read).not.toHaveBeenCalled(); expect(h.updates[0]).toMatchObject({ status: 'matched' });
  });

  it('accepts a USD receipt for an XAF BOQ without comparing it to the stage allocation', async () => {
    h.read.mockResolvedValue({ reading: { is_payment_receipt: true, amount: '50', currency: 'USD', confidence: 'high' }, model: 'fixture' });
    h.convert.mockResolvedValue({ data: { fx_rate: '1.000000000000', project_currency: 'XAF', project_fx_rate: '600.000000000000', fx_source: 'USD', fx_as_of: '2026-11-12T00:00:00Z' } });
    const res = await request({ amount: '50', currency: 'USD' });
    expect(res.code).toBe(200); expect(res.payload).toMatchObject({ fxRate: '1.000000000000', projectCurrency: 'XAF' });
    expect(h.rate).toHaveBeenCalledWith('USD', expect.any(AbortSignal));
    expect(h.convert).toHaveBeenCalledWith('attach_receipt_conversion', expect.objectContaining({ p_rate: '1', p_project_currency: 'XAF', p_project_rate: 600 }));
  });

  it('attests an external currency only after its receipt amount and currency match', async () => {
    h.read.mockResolvedValue({ reading: { is_payment_receipt: true, amount: '80', currency: 'EUR', confidence: 'high' }, model: 'fixture' });
    h.rate.mockResolvedValue({ rate: '0.800000000000', source: 'ExchangeRate-API', asOf: '2026-11-12T00:00:00Z' });
    h.convert.mockResolvedValue({ data: { fx_rate: '0.800000000000', project_currency: 'XAF', project_fx_rate: '600.000000000000', fx_source: 'ExchangeRate-API', fx_as_of: '2026-11-12T00:00:00Z' } });
    expect((await request({ amount: '80', currency: 'EUR' })).payload).toMatchObject({ status: 'matched', fxRate: '0.800000000000', fxSource: 'ExchangeRate-API' });
    expect(h.convert).toHaveBeenCalledWith('attach_receipt_conversion', expect.objectContaining({ p_rate: '0.800000000000', p_source: 'ExchangeRate-API' }));
  });

  it('retains the saved foreign conversion on a retry instead of fetching a new quote', async () => {
    h.cache = { id: 'original', submitted_by: 'client', stage_id: h.stage.id, confidence: 'high', amount_text: '80', currency: 'EUR', model: 'fixture', path, object_id: 'object', object_version: 'v1', fx_rate: '0.8' };
    expect((await request({ amount: '80', currency: 'EUR' })).code).toBe(200);
    expect(h.rate).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
    expect(h.convert).toHaveBeenCalledWith('attach_receipt_conversion', expect.objectContaining({ p_reading: 'original', p_rate: null }));
  });

  it('keeps the payment unsubmitted when no usable exchange rate can be saved', async () => {
    h.read.mockResolvedValue({ reading: { is_payment_receipt: true, amount: '80', currency: 'EUR', confidence: 'high' }, model: 'fixture' });
    h.rate.mockRejectedValue(new Error('receipt_rate_unavailable'));
    const res = await request({ amount: '80', currency: 'EUR' });
    expect(res.payload.error).toBe('receipt_rate_unavailable'); expect(res.payload.readingId).toBeUndefined();
    expect(h.convert).not.toHaveBeenCalled(); expect(h.updates.at(-1)).toMatchObject({ status: 'error' });
  });

  it('rejects unsupported currency aliases before reading and quoting', async () => {
    expect((await request({ currency: 'ZAF' })).payload.error).toBe('receipt_currency_unsupported');
    expect(h.reserve).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled(); expect(h.rate).not.toHaveBeenCalled();
  });
});
