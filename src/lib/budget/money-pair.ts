// =========================================================
// A figure in the currency it was written in, and what that is in dollars.
//
// A bill of quantities from Limbe says 26,687,728 XAF. Groundwork stores budgets in
// USD, so the wizard showed the bill's figure in one card and $44,480 in another,
// with nothing to connect them. Philip, 29 October: "it will be different figures,
// and I don't know what exchange rate it is using."
//
// So the two always travel together, local first because that is the number on the
// document in front of them, and the RATE IS NAMED. A conversion you cannot check is
// a conversion you have to take on trust, and this one decides what a contractor is
// paid at every stage.
// =========================================================

export interface MoneyPair {
  /** The figure as the document states it, with its currency. */
  local: string;
  /** The same money in dollars, or null when it already is dollars. */
  usd: string | null;
  /** "600 XAF = $1" — shown so the conversion can be checked rather than believed. */
  rate: string | null;
}

const group = (value: number, maxFractionDigits = 0) =>
  value.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });

/**
 * Pair a document's figure with its dollar equivalent.
 *
 * `fxRate` is units of local currency per US dollar, the same number the budget
 * engine divides by — taken from `construction_rates.approx_fx_rate` so the summary
 * and the budget can never quote different rates for the same project.
 */
export function moneyPair(
  amount: number,
  currencyCode: string | null | undefined,
  fxRate: number | null | undefined,
): MoneyPair {
  const code = (currencyCode ?? '').toUpperCase();

  // Already dollars, or a currency we were given no rate for. Saying "≈ $x" from a
  // rate of 1 would be inventing a conversion that never happened.
  if (!code || code === 'USD' || !fxRate || fxRate <= 0 || fxRate === 1) {
    return {
      local: code === 'USD' || !code ? `$${group(amount)}` : `${group(amount)} ${code}`,
      usd: null,
      rate: null,
    };
  }

  return {
    local: `${group(amount)} ${code}`,
    usd: `$${group(amount / fxRate)}`,
    rate: `${group(fxRate, 2)} ${code} = $1`,
  };
}
