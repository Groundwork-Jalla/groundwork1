import { isReceiptCurrency } from '../../src/lib/payments/receipt-currencies.js';

const endpoint = 'https://open.er-api.com/v6/latest/USD';
type Snapshot = { rates: Record<string, number>; asOf: string; until: number };
let cached: Snapshot | undefined;
let loading: Promise<Snapshot> | undefined;

/** Validate the daily feed before freezing a transaction's conversion. */
export function parseReceiptRates(body: any, now = Date.now()): Snapshot {
  const stamp = Number(body?.time_last_update_unix) * 1000;
  if (body?.result !== 'success' || body.base_code !== 'USD' || !body.rates || body.rates.USD !== 1
    || !Number.isFinite(stamp) || stamp > now + 300_000 || now - stamp > 48 * 60 * 60_000) throw new Error('receipt_rate_unavailable');
  return { rates: body.rates, asOf: new Date(stamp).toISOString(), until: Math.min(stamp + 48 * 60 * 60_000, now + 60 * 60_000) };
}

export async function receiptExchangeRate(code: string, signal: AbortSignal) {
  if (!isReceiptCurrency(code)) throw new Error('receipt_currency_unsupported');
  if (code === 'USD') return { rate: '1', source: 'USD', asOf: new Date().toISOString() };
  if (!cached || cached.until <= Date.now()) {
    loading ??= (async () => {
      const response = await fetch(endpoint, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (!response.ok) throw new Error('receipt_rate_unavailable');
      cached = parseReceiptRates(await response.json());
      return cached;
    })().finally(() => { loading = undefined; });
    try { cached = await loading; } catch { throw new Error('receipt_rate_unavailable'); }
  }
  const rate = cached.rates[code];
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1e12 || Number(rate.toFixed(12)) <= 0) throw new Error('receipt_rate_unavailable');
  return { rate: rate.toFixed(12), source: 'ExchangeRate-API', asOf: cached.asOf };
}
