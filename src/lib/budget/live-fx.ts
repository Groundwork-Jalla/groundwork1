import { useEffect, useState } from 'react';

// =========================================================
// Today's exchange rate, not last year's.
//
// `construction_rates.approx_fx_rate` says 600 XAF to the dollar. It is a round
// number somebody typed, and the real rate has been nearer 580 for a while — Philip,
// 29 October: "you're showing that the exchange rate is 600 XAF per $1, which is
// inaccurate." On a 59,675,280 XAF bill that gap is about $3,400 of apparent budget.
//
// So the figure shown beside a bill is converted at a rate fetched today, and the
// stored one becomes the fallback for when the fetch cannot happen — offline, blocked,
// or a currency the feed does not carry. A wrong-but-close number beats a blank, and
// the stored rate is still what the budget engine itself divides by, so nothing here
// can move money; it only changes what the person is shown.
// =========================================================

/** Rates are per US dollar: `rates.XAF` is how many XAF one dollar buys. */
const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

/** One fetch per tab. A wizard reads the same rate on two screens in a row. */
let inFlight: Promise<Record<string, number> | null> | null = null;
let cached: Record<string, number> | null = null;

/** Long enough that nobody fetches twice in a sitting, short enough to be today's. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STORE_KEY = 'gw:fx:usd';

function readStored(): Record<string, number> | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; rates: Record<string, number> };
    if (!saved?.rates || Date.now() - saved.at > MAX_AGE_MS) return null;
    return saved.rates;
  } catch { return null; }
}

async function loadRates(): Promise<Record<string, number> | null> {
  if (cached) return cached;
  const stored = readStored();
  if (stored) { cached = stored; return cached; }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(ENDPOINT);
      if (!response.ok) return null;
      const body = await response.json() as { result?: string; rates?: Record<string, number> };
      if (body.result !== 'success' || !body.rates) return null;
      cached = body.rates;
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), rates: body.rates }));
      } catch { /* private mode; the in-memory copy still serves this tab */ }
      return cached;
    } catch {
      // Offline, blocked, or the feed is down. The caller falls back to the stored
      // rate rather than showing nothing.
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * How many units of `currencyCode` one US dollar buys, today.
 *
 * `fallback` is the rate Groundwork stores for the country, and is what is returned
 * until the live one arrives and whenever it cannot be fetched.
 */
export function useUsdRate(
  currencyCode: string | null | undefined,
  fallback: number | null | undefined,
): number | null {
  const code = (currencyCode ?? '').toUpperCase();
  const [rate, setRate] = useState<number | null>(fallback ?? null);

  useEffect(() => {
    setRate(fallback ?? null);
    if (!code || code === 'USD') return;

    let alive = true;
    void loadRates().then(rates => {
      const live = rates?.[code];
      // A rate of zero or a missing currency is not an improvement on the stored one.
      if (alive && typeof live === 'number' && live > 0) setRate(live);
    });
    return () => { alive = false; };
  }, [code, fallback]);

  return rate;
}
