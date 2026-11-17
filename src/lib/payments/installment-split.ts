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
