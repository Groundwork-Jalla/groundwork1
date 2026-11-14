import { useEffect, useState } from 'react';
import { parseUsdRates, validUsdRate, USD_RATES_CACHE_MS, USD_RATES_ENDPOINT, USD_RATES_PROVIDER, type UsdRatesSnapshot } from './usd-rates';

const STORE_KEY = 'gw:fx:usd';
let inFlight: Promise<UsdRatesSnapshot | null> | null = null;
let cached: UsdRatesSnapshot | null = null;

function readStored(now: number): UsdRatesSnapshot | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null');
    if (!Number.isFinite(saved?.at) || saved.at > now || now - saved.at >= USD_RATES_CACHE_MS
      || typeof saved.asOf !== 'string') return null;
    const snapshot = parseUsdRates({ result: 'success', base_code: 'USD', rates: saved.rates,
      time_last_update_unix: Date.parse(saved.asOf) / 1000 }, now);
    return { ...snapshot, until: Math.min(snapshot.until, saved.at + USD_RATES_CACHE_MS) };
  } catch { return null; }
}

/** Expired in-memory rates are refreshed too; a long-lived tab is not a rate lock. */
export async function loadUsdRates(): Promise<UsdRatesSnapshot | null> {
  const now = Date.now();
  if (cached && cached.until > now) return cached;
  const stored = readStored(now);
  if (stored && stored.until > now) return cached = stored;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(USD_RATES_ENDPOINT, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      cached = parseUsdRates(await response.json());
      try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), rates: cached.rates, asOf: cached.asOf })); }
      catch { /* The in-memory cache also works when storage is unavailable. */ }
      return cached;
    } catch { return null; }
    finally { inFlight = null; }
  })();
  return inFlight;
}

export interface UsdQuote {
  code: string;
  rate: number | null;
  source: 'ExchangeRate-API' | 'configured' | 'USD' | null;
  asOf: string | null;
}

/** An indicative market quote, with an explicitly identified configured fallback. */
export function useUsdQuote(currencyCode: string | null | undefined, fallback: number | null | undefined): UsdQuote {
  const code = (currencyCode ?? '').toUpperCase();
  const initial: UsdQuote = { code, rate: code === 'USD' ? 1 : validUsdRate(fallback) ? fallback : null,
    source: code === 'USD' ? 'USD' : validUsdRate(fallback) ? 'configured' : null, asOf: null };
  const scope = `${code}:${fallback}`;
  const [value, setValue] = useState<{ scope: string; quote: UsdQuote }>({ scope, quote: initial });

  useEffect(() => {
    let alive = true, generation = 0;
    const refresh = async () => {
      const request = ++generation;
      const snapshot = code && code !== 'USD' ? await loadUsdRates() : null;
      const rate = snapshot?.rates[code];
      if (alive && request === generation) setValue({ scope, quote: snapshot && validUsdRate(rate)
        ? { code, rate, source: USD_RATES_PROVIDER, asOf: snapshot.asOf } : initial });
    };
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    if (!code || code === 'USD') return () => { alive = false; };
    const timer = window.setInterval(visibleRefresh, USD_RATES_CACHE_MS);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [scope]);
  return value.scope === scope ? value.quote : initial;
}

/** Compatibility for callers that only need the numeric quote. */
export function useUsdRate(currencyCode: string | null | undefined, fallback: number | null | undefined): number | null {
  return useUsdQuote(currencyCode, fallback).rate;
}
