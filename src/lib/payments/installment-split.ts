import { canonicalReceiptAmount } from './receipt-reading';

const scale = 1_000_000n;
const units = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
};
const decimal = (amount: bigint) => {
  const tail = (amount % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount / scale}${tail ? `.${tail}` : ''}`;
};

/** A split uses the stage currency; rounding its first part never changes the total. */
export function installmentSplit(total: string, first: string): { first: string; second: string } | null {
  const amount = canonicalReceiptAmount(total), start = canonicalReceiptAmount(first);
  if (!amount || !start || units(start) >= units(amount)) return null;
  return { first: start, second: decimal(units(amount) - units(start)) };
}

export function installmentSplitFromPercent(total: string, percentage: string) {
  const amount = canonicalReceiptAmount(total), percent = canonicalReceiptAmount(percentage);
  if (!amount || !percent || units(percent) >= 100n * scale) return null;
  const denominator = 100n * scale;
  const first = (units(amount) * units(percent) + denominator / 2n) / denominator;
  return installmentSplit(amount, decimal(first));
}

/** Display-only ratio. Switching input modes does not rewrite the saved amount. */
export function firstInstallmentPercent(total: string, first: string): string {
  const split = installmentSplit(total, first);
  const amount = canonicalReceiptAmount(total);
  if (!split || !amount) return '';
  return decimal((units(split.first) * 100n * scale + units(amount) / 2n) / units(amount));
}

/** Minor units a currency is quoted in: none for XAF, two for USD and NGN. */
export function currencyDigits(code: string): number {
  try { return Math.min(new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2, 6); }
  catch { return 2; }
}

/**
 * A first installment typed in another currency, expressed in the stage currency.
 *
 * The plan is agreed and stored in the stage currency; the other currency is only how the
 * client thinks about the money they are about to send. Both rates are units per USD, the
 * same two legs a receipt in that currency is converted through, so the figure the client
 * agrees to here is the figure their receipt will be measured against.
 *
 * Rounded to the stage currency's own minor unit. Unrounded, 315,000 NGN became
 * 138,453.873521 XAF on the plan, a figure nobody can pay.
 */
export function installmentInStageCurrency(
  entered: string, enteredPerUsd: number | null | undefined, stagePerUsd: string | number, stageCurrency: string,
): string | null {
  const amount = canonicalReceiptAmount(entered), stageRate = Number(stagePerUsd);
  if (!amount || typeof enteredPerUsd !== 'number' || !Number.isFinite(enteredPerUsd) || enteredPerUsd <= 0
    || !Number.isFinite(stageRate) || stageRate <= 0) return null;
  const value = Number(amount) / enteredPerUsd * stageRate;
  return Number.isFinite(value) ? canonicalReceiptAmount(value.toFixed(currencyDigits(stageCurrency))) : null;
}
