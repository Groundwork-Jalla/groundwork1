import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('./client', () => ({ supabase: { auth: { getSession: h.session } } }));
import { readUploadedReceipt } from './receipt-reader';

const matched = { status: 'matched', readingId: 'verified', path: 'project/receipts/proof', fxRate: '0.800000000000' };
beforeEach(() => { vi.clearAllMocks(); h.session.mockResolvedValue({ data: { session: { access_token: 'fixture' } } }); });
afterEach(() => vi.unstubAllGlobals());
describe('the verified receipt response', () => {
  it('preserves the saved decimal conversion returned by the server', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => matched }); vi.stubGlobal('fetch', fetch);
    expect(await readUploadedReceipt('stage', 'project/receipts/proof', '80', 'EUR')).toEqual({
      readingId: 'verified', path: 'project/receipts/proof', fxRate: '0.800000000000',
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ stageId: 'stage', path: 'project/receipts/proof', amount: '80', currency: 'EUR' });
  });
  it.each([undefined, null, '', 0.8, '0', '-1', 'Infinity', 'invalid'])('refuses a matched response without a valid saved conversion: %s', fxRate => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...matched, fxRate }) }));
    return expect(readUploadedReceipt('stage', 'project/receipts/proof', '80', 'EUR')).rejects.toMatchObject({ code: 'receipt_rate_unavailable' });
  });
  it('retains mismatch details so the client can correct the selected currency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'receipt_currency_mismatch', amount: '80', currency: 'USD' }) }));
    await expect(readUploadedReceipt('stage', 'project/receipts/proof', '80', 'XAF')).rejects.toMatchObject({ code: 'receipt_currency_mismatch', amount: '80', currency: 'USD' });
  });
  it('retains a support reference for a service configuration failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>({error:'receipt_reader_not_configured',reference:'check-reference-1234'})}));
    await expect(readUploadedReceipt('stage','project/receipts/proof','13000','NGN')).rejects.toMatchObject({code:'receipt_reader_not_configured',reference:'check-reference-1234'});
  });
  it.each([[504,'receipt_reader_timeout'],[401,'receipt_sign_in_required'],[403,'receipt_access_denied'],[404,'receipt_reader_not_configured']])('classifies a non-JSON status %s response',async(status,code)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status,json:async()=>{throw new Error('not JSON');}}));
    await expect(readUploadedReceipt('stage','project/receipts/proof','13000','NGN')).rejects.toMatchObject({code});
  });
  it('reports a browser connection failure rather than claiming the image is not a receipt',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(readUploadedReceipt('stage','project/receipts/proof','13000','NGN')).rejects.toMatchObject({code:'receipt_network_error'});
  });
});
