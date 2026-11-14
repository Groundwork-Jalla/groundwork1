import { isReceiptCurrency } from '../../src/lib/payments/receipt-currencies.js';
import { parseUsdRates, USD_RATES_ENDPOINT, type UsdRatesSnapshot } from '../../src/lib/budget/usd-rates.js';

type Snapshot = UsdRatesSnapshot;
let cached: Snapshot | undefined;
let loading: Promise<Snapshot> | undefined;

/** Validate the daily feed before freezing a transaction's conversion. */
export function parseReceiptRates(body: any, now = Date.now()): Snapshot {
  try { return parseUsdRates(body, now); } catch { throw new Error('receipt_rate_unavailable'); }
}

export async function receiptExchangeRate(code: string, signal: AbortSignal) {
  if (!isReceiptCurrency(code)) throw new Error('receipt_currency_unsupported');
  if (code === 'USD') return { rate: '1', source: 'USD', asOf: new Date().toISOString() };
  if (!cached || cached.until <= Date.now()) {
    loading ??= (async () => {
      const response = await fetch(USD_RATES_ENDPOINT, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
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
