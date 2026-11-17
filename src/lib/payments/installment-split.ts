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
