import { useCallback, useMemo } from 'react';
import { getApproxFx, getCurrencyCode } from './legacy';
import { moneyPair, type MoneyPair } from './money-pair';
import { useUsdRate } from './live-fx';

// =========================================================
// Money, as a contractor in Limbe reads it.
//
// Every stage figure Groundwork stores is in US dollars. A contractor is not paid in
// dollars, so a screen that leads with "$10,800" is quoting a currency nobody on the
// site uses. Philip, 29 October: the figure "should show me in the local currency".
//
// So: the project's own currency first, the dollar equivalent beside it, at ONE rate
// fetched today — shared across the dashboard, the project list, the Work tab and the
// Money tab, so four screens can never quote four different conversions of the same
// stage. The stored `approx_fx_rate` is the fallback when the live rate cannot be had.
//
// This hook reads; it never writes. What is actually released is governed by the
// ledger, not by whatever rate a browser happened to fetch this morning.
// =========================================================

export interface ProjectMoney {
  /** The project country's currency, e.g. XAF. */
  code: string;
  /** Units of `code` per US dollar, today's if we have it. */
  rate: number;
  /** A stored USD figure, as the pair the contractor should see. */
  pair: (usd: number | null | undefined) => MoneyPair | null;
  /** Just the local figure, grouped, for tight rows: "6,356,000 XAF". */
  local: (usd: number | null | undefined) => string | null;
}

/**
 * @param countryCode `projects.country` — a two-letter code. Unknown or missing
 *   falls back to USD at parity, which `moneyPair` renders as plain dollars with no
 *   invented conversion beside them.
 */
export function useProjectMoney(countryCode: string | null | undefined): ProjectMoney {
  const code = getCurrencyCode((countryCode ?? '').toUpperCase());
  const stored = getApproxFx((countryCode ?? '').toUpperCase());
  const live = useUsdRate(code, stored);
  const rate = live ?? stored;

  const pair = useCallback((usd: number | null | undefined) => {
    if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
    const converted = moneyPair(Math.round(usd * rate), code, rate);
    // Zero needs no conversion: "0 XAF ≈ $0" is two ways of saying nothing, and the
    // "≈" implies an approximation that is not happening. A stage priced at zero —
    // design on most builds, every stage on a job that joined half-built — says so
    // once. See the `pre_existing` note in tracking.ts.
    return usd === 0 ? { ...converted, usd: null, rate: null } : converted;
  }, [code, rate]);

  const local = useCallback(
    (usd: number | null | undefined) => pair(usd)?.local ?? null,
    [pair],
  );

  return useMemo(() => ({ code, rate, pair, local }), [code, rate, pair, local]);
}
