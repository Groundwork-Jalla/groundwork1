import type { SectionKey } from './engine';
import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// Take-off line items.
//
// The engine used to compute each section as one closed-form expression:
//
//     const preliminary = (250_000 + A * 1_600) * ci;
//
// which is fine for producing a number and useless for anything else. A contractor
// cannot say "my blockwork is 4,200/m², not 3,800" against an expression — only against
// the whole section total, which is not a statement about blockwork.
//
// So the engine now emits LINES and derives section totals by summing them. Same
// arithmetic, same numbers, one engine. This file holds the shape; engine.ts still owns
// every rate and coefficient.
//
// `code` is the real BQ item number (204 footings, 305 blockwork, 503 roof sheet,
// 801-810 plumbing) so a Groundwork take-off can sit beside a real quotation line for
// line. That is the whole point of the exercise — a contractor who has to translate our
// categories into theirs will not bother.
// =========================================================

export type LineKind =
  /** qty x rate. The normal case, and the only kind a contractor can meaningfully edit. */
  | 'measured'
  /** A lump sum: qty is 1 and `rate` is the sum. Site setup, roof accessories. */
  | 'item'
  /** A percentage of other lines. Evaluated AFTER overrides — see `applyOverrides`. */
  | 'percentage';

export interface TakeoffLine {
  /** Real BQ item number. Stable — overrides are keyed on it. */
  code: string;
  section: SectionKey;
  labelKey: TKey;
  /** m², m³, ml, nr, item, % */
  unit: string;
  qty: number;
  /** Local currency per unit, city index already applied. */
  rate: number;
  /** qty x rate, or base x pct for a percentage line. Local currency. */
  amount: number;
  kind: LineKind;
  /**
   * Whether the rate is measured from a real Bill of Quantity or inferred. Shown in the
   * UI so a contractor knows which of our numbers to trust — a document that presents a
   * guess with the same confidence as a measurement gets discarded whole.
   */
  rateSource: 'real_bq' | 'estimated';
  /** True once a contractor has overridden qty or rate on this line. */
  overridden?: boolean;
  /**
   * Percentage lines only: which sections the percentage is taken over. Section 900's
   * contingency excludes `finishing`, which is the section it lives in.
   */
  basis?: readonly SectionKey[];
  /** Percentage lines only: the rate expressed as a percent, for display. */
  pct?: number;
}

export interface LineOverride {
  qty?: number;
  rate?: number;
  note?: string;
}

export type OverrideMap = Record<string, LineOverride>;

/**
 * Sum lines into section totals.
 *
 * Every section key is present even when it has no lines, because `SectionAmounts` is a
 * total record and callers index it directly.
 */
export function sectionsFromLines(
  lines: readonly TakeoffLine[],
  keys: readonly SectionKey[],
): Record<SectionKey, number> {
  const out = Object.fromEntries(keys.map(k => [k, 0])) as Record<SectionKey, number>;
  for (const l of lines) out[l.section] += l.amount;
  return out;
}

export function totalFromLines(lines: readonly TakeoffLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0);
}

/** A finite, non-negative number, or undefined. Garbage never reaches a total. */
function clean(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Apply a contractor's overrides and re-evaluate the percentage lines.
 *
 * ORDER MATTERS and is easy to get backwards:
 *
 *   1. override qty/rate on measured lines
 *   2. recompute those amounts
 *   3. evaluate percentage lines against the ALREADY-OVERRIDDEN amounts
 *   4. apply overrides to the percentage lines themselves
 *
 * Do step 3 before step 2 and an overridden blockwork rate silently fails to move the
 * contingency that is calculated on it — the total changes by less than it should, and
 * nothing in the UI reveals why.
 *
 * Invalid input (NaN, Infinity, negative) falls back to the model value rather than
 * propagating. A contractor mid-typing should not blank the total.
 */
export function applyOverrides(
  lines: readonly TakeoffLine[],
  overrides: OverrideMap | null | undefined,
): TakeoffLine[] {
  const ov = overrides ?? {};

  // Steps 1-2 — measured and item lines.
  const priced = lines.map((l): TakeoffLine => {
    if (l.kind === 'percentage') return { ...l };
    const o = ov[l.code];
    const qty  = clean(o?.qty)  ?? l.qty;
    const rate = clean(o?.rate) ?? l.rate;
    const changed = qty !== l.qty || rate !== l.rate;
    return { ...l, qty, rate, amount: qty * rate, overridden: changed || undefined };
  });

  // Step 3 — percentages, over the overridden amounts.
  // Step 4 — then overrides on the percentage lines themselves.
  return priced.map((l): TakeoffLine => {
    if (l.kind !== 'percentage') return l;
    const o = ov[l.code];
    const rate = clean(o?.rate) ?? l.rate;      // rate is the fraction, e.g. 0.05
    const basis = l.basis ?? [];
    const base = priced
      .filter(x => x.kind !== 'percentage' && basis.includes(x.section))
      .reduce((s, x) => s + x.amount, 0);
    const qty = clean(o?.qty) ?? base;
    return {
      ...l,
      qty, rate, amount: qty * rate,
      pct: rate * 100,
      overridden: (rate !== l.rate || clean(o?.qty) !== undefined) || undefined,
    };
  });
}
