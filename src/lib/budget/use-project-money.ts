import { useCallback, useMemo } from 'react';
import type { MoneyPair } from './money-pair';
import { projectMoneyBasis, projectMoneyPair, type ProjectMoneySource } from './project-money';
import { useUsdQuote } from './live-fx';

// Read-only currency formatting: saved project basis, or a market quote for a country preview.


export interface ProjectMoney {
  /** The project country's currency, e.g. XAF. */
  code: string;
  /** Units of `code` per US dollar on this screen's explicitly identified basis. */
  rate: number;
  /** Canonical budget basis, independent of a browser's live display quote. */
  budgetRate: number;
  rateSource?: 'saved_budget' | 'configured_budget' | 'ExchangeRate-API' | 'configured' | 'USD' | null;
  rateAsOf?: string | null;
  rateRecordedAt?: string | null;
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
  const quote = useUsdQuote(initial.project ? null : initial.code, initial.fallback);
  const { code, rate } = projectMoneyBasis(source, quote.rate);

  const pair = useCallback((usd: number | null | undefined, sourceAmount?: number | null) => {
    return projectMoneyPair(source, usd, rate, sourceAmount);
  }, [source, rate]);

  const local = useCallback(
    (usd: number | null | undefined, sourceAmount?: number | null) => pair(usd, sourceAmount)?.local ?? null,
    [pair],
  );

  const budgetRate = initial.fallback;
  const rateSource = initial.locked ? 'saved_budget' : initial.project ? 'configured_budget' : quote.source;
  const rateAsOf = initial.project ? null : quote.asOf;
  const rateRecordedAt = initial.locked ? initial.project?.budget_fx_recorded_at ?? null : null;
  return useMemo(() => ({ code, rate, budgetRate, rateSource, rateAsOf, rateRecordedAt, pair, local }), [code, rate, budgetRate, rateSource, rateAsOf, rateRecordedAt, pair, local]);
}
