import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseReceiptRates } from '../../../api/_lib/receipt-exchange-rate';

const now = Date.parse('2026-11-13T06:00:00Z');
const feed = (patch = {}) => ({ result: 'success', base_code: 'USD', time_last_update_unix: (now - 6 * 60 * 60_000) / 1000,
  rates: { USD: 1, EUR: 0.8, XAF: 600, GBP: 0.75 }, ...patch });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('server receipt currency rates', () => {
  it('accepts a recent USD daily feed and limits its local cache lifetime', () => {
    const parsed = parseReceiptRates(feed(), now);
    expect(parsed.asOf).toBe('2026-11-13T00:00:00.000Z');
    expect(parsed.until).toBe(now + 60 * 60_000);
  });
  it.each([
    { result: 'error' }, { base_code: 'EUR' }, { rates: { USD: 0.8 } },
    { time_last_update_unix: (now - 49 * 60 * 60_000) / 1000 },
    { time_last_update_unix: (now + 6 * 60_000) / 1000 }, { time_last_update_unix: 'invalid' },
  ])('refuses an invalid, stale or future feed: %j', patch => {
    expect(() => parseReceiptRates(feed(patch), now)).toThrow('receipt_rate_unavailable');
  });
  it('needs no external rate for USD and rejects the ZAF alias', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { receiptExchangeRate } = await import('../../../api/_lib/receipt-exchange-rate');
    expect(await receiptExchangeRate('USD', new AbortController().signal)).toMatchObject({ rate: '1', source: 'USD' });
    await expect(receiptExchangeRate('ZAF', new AbortController().signal)).rejects.toThrow('receipt_currency_unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('freezes the provider date and reuses the same feed for several currencies', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => feed() }); vi.stubGlobal('fetch', fetch);
    const { receiptExchangeRate } = await import('../../../api/_lib/receipt-exchange-rate');
    const signal = new AbortController().signal;
    expect(await receiptExchangeRate('EUR', signal)).toEqual({ rate: '0.800000000000', source: 'ExchangeRate-API', asOf: '2026-11-13T00:00:00.000Z' });
    expect((await receiptExchangeRate('XAF', signal)).rate).toBe('600.000000000000');
    expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60 * 60_000 + 1);
    await receiptExchangeRate('GBP', signal); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, null, '0.8', 1e13])('refuses a missing or invalid selected rate: %s', rate => {
    return (async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => feed({ rates: { USD: 1, EUR: rate } }) }));
      const { receiptExchangeRate } = await import('../../../api/_lib/receipt-exchange-rate');
      await expect(receiptExchangeRate('EUR', new AbortController().signal)).rejects.toThrow('receipt_rate_unavailable');
    })();
  });
  it('retries after an unavailable feed without inventing a fallback', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => feed() }); vi.stubGlobal('fetch', fetch);
    const { receiptExchangeRate } = await import('../../../api/_lib/receipt-exchange-rate');
    const signal = new AbortController().signal;
    await expect(receiptExchangeRate('EUR', signal)).rejects.toThrow('receipt_rate_unavailable');
    expect((await receiptExchangeRate('EUR', signal)).rate).toBe('0.800000000000');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
