import type { BudgetBreakdown, ProjectRow } from '@/types/project';

export interface BillBudgetSnapshot {
  amount: string;
  currencyCode: string;
  fxRate: number;
  sourceLabel?: string | null;
  fileName?: string | null;
}

/** Keep document precision separate from the cents used by payment providers. */
export function amountPrecision(amount: string): number {
  return Math.min(6, amount.split('.')[1]?.length ?? 0);
}

export function confirmedBillAmount(raw: string): number | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 && amount <= 1e12 ? amount : null;
}

/** Sum native allocations in integer source units rather than adding binary floats. */
export function sumBillAmounts(amounts: (number | null | undefined)[], precision: number): number | null {
  if (amounts.some(amount => amount == null || !Number.isFinite(amount))) return null;
  const scale = 10n ** BigInt(precision);
  const units = amounts.reduce<bigint>((sum, amount) => {
    const [whole, fraction = ''] = amount!.toFixed(precision).split('.');
    return sum + BigInt(whole) * scale + BigInt(fraction || '0');
  }, 0n);
  return Number(units) / Number(scale);
}

/** A bill supplies a contract sum; estimator fee and trade formulas do not apply. */
export function billBudget(total: number): BudgetBreakdown {
  return {
    total, construction: total, material: 0, labor: 0,
    design: 0, permit: 0, professional: 0, verification: 0, contingency: 0,
  };
}

export function isBoqProject(project: Pick<ProjectRow, 'budget_source'>): boolean {
  return project.budget_source === 'boq';
}

/** Deterministic allocation in source units, including fractional document units. */
export function allocateBill(amount: string, shares: { id: string; pct: number }[]): Map<string, string> {
  if (confirmedBillAmount(amount) === null) throw new Error('Invalid bill amount');
  const precision = amountPrecision(amount);
  const scale = 10n ** BigInt(precision);
  const [whole, fraction = ''] = amount.split('.');
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0') || '0');
  const weights = shares.map(s => {
    if (!Number.isFinite(s.pct) || s.pct < 0) throw new Error('Invalid stage percentage');
    return { ...s, weight: BigInt(Math.round(s.pct * 1e6)) };
  });
  const sum = weights.reduce((a, s) => a + s.weight, 0n);
  if (sum <= 0n || Math.abs(Number(sum) / 1e6 - 100) > 0.0001) {
    throw new Error('Stage percentages must total 100');
  }
  const rows = weights.map(s => ({ ...s, units: units * s.weight / sum, remainder: units * s.weight % sum }));
  let spare = units - rows.reduce((a, s) => a + s.units, 0n);
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder
    ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) if (spare > 0n && row.weight > 0n) { row.units++; spare--; }
  const format = (value: bigint) => precision
    ? `${value / scale}.${String(value % scale).padStart(precision, '0')}` : String(value);
  return new Map(rows.map(s => [s.id, format(s.units)]));
}
