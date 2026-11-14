export const USD_RATES_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
export const USD_RATES_PROVIDER = 'ExchangeRate-API';
export const USD_RATES_CACHE_MS = 60 * 60_000;
export const USD_RATES_MAX_AGE_MS = 48 * 60 * 60_000;

export interface UsdRatesSnapshot {
  /** Currency units per USD. */
  rates: Record<string, number>;
  /** The provider's update time, never the time the browser fetched it. */
  asOf: string;
  until: number;
}

export function validUsdRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    && value <= 1e12 && Number(value.toFixed(12)) > 0;
}

/** The browser and receipt reader validate the same daily USD feed. */
export function parseUsdRates(body: unknown, now = Date.now()): UsdRatesSnapshot {
  const data = body as Record<string, any> | null;
  const stamp = Number(data?.time_last_update_unix) * 1000;
  if (data?.result !== 'success' || data.base_code !== 'USD' || data.rates?.USD !== 1
    || !Number.isFinite(stamp) || stamp <= 0 || stamp > now + 300_000
    || now - stamp >= USD_RATES_MAX_AGE_MS) throw new Error('exchange_rate_unavailable');
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(data.rates)) {
    if (/^[A-Z]{3}$/.test(code) && validUsdRate(rate)) rates[code] = rate;
  }
  return { rates, asOf: new Date(stamp).toISOString(), until: Math.min(stamp + USD_RATES_MAX_AGE_MS, now + USD_RATES_CACHE_MS) };
}
