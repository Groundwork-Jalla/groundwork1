import { useCallback, useMemo } from 'react';
import type { MoneyPair } from './money-pair';
import { projectMoneyBasis, projectMoneyPair, type ProjectMoneySource } from './project-money';
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
  pair: (usd: number | null | undefined, sourceAmount?: number | null) => MoneyPair | null;
  /** Just the local figure, grouped, for tight rows: "6,356,000 XAF". */
  local: (usd: number | null | undefined, sourceAmount?: number | null) => string | null;
}

/**
 * @param countryCode `projects.country` — a two-letter code. Unknown or missing
 *   falls back to USD at parity, which `moneyPair` renders as plain dollars with no
 *   invented conversion beside them.
 */
export function useProjectMoney(source: ProjectMoneySource): ProjectMoney {
  const initial = projectMoneyBasis(source);
  const live = useUsdRate(initial.locked ? null : initial.code, initial.fallback);
  const { code, rate } = projectMoneyBasis(source, live);

  const pair = useCallback((usd: number | null | undefined, sourceAmount?: number | null) => {
    return projectMoneyPair(source, usd, rate, sourceAmount);
  }, [source, rate]);

  const local = useCallback(
    (usd: number | null | undefined, sourceAmount?: number | null) => pair(usd, sourceAmount)?.local ?? null,
    [pair],
  );

  return useMemo(() => ({ code, rate, pair, local }), [code, rate, pair, local]);
}
