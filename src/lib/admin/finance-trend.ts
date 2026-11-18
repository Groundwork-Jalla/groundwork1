import type { LedgerLine } from './finance-ledger';

// =========================================================
// Finance, month by month (18 Nov redesign, finance-desktop.png).
//
// The chart counts exactly what the KPI cards count, so a bar and a card can never
// disagree: confirmed inflows are `funded` + `reconciled` rows coming in, disbursed is
// `disbursed` rows going out — the same states `totalsFor()` sums. Each row lands in the
// month of its own `at`, which for those states is when receipt was confirmed or the
// provider settled. Nothing expected, authorised or in flight is drawn: it has not moved.
// =========================================================

export interface MonthFlow {
  /** `YYYY-MM`, UTC. */
  key: string;
  inflow: number;
  disbursed: number;
}

const IN_SETTLED = new Set(['funded', 'reconciled']);

export function monthlyFlows(lines: LedgerLine[], months: number, now: Date = new Date()): MonthFlow[] {
  const out: MonthFlow[] = [];
  const index = new Map<string, MonthFlow>();
  for (let back = months - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = { key, inflow: 0, disbursed: 0 };
    out.push(row); index.set(key, row);
  }
  for (const l of lines) {
    if (!l.at) continue;
    const row = index.get(l.at.slice(0, 7));
    if (!row) continue;
    if (l.direction === 'in' && IN_SETTLED.has(l.state)) row.inflow += l.amount;
    else if (l.direction === 'out' && l.state === 'disbursed') row.disbursed += l.amount;
  }
  return out;
}

/** Shares of a whole, for the "where the money stands" bar. Zero total → all zero. */
export function shares(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + Math.max(0, b), 0);
  return parts.map(p => (total > 0 ? (Math.max(0, p) / total) * 100 : 0));
}
