/**
 * Is this total obviously too low?
 *
 * ── What this is ─────────────────────────────────────────────────────────────────────
 * A floor check on the figure a client is shown. If it lands below half of a quantity
 * surveyor's back-of-envelope for a building that size, the screen says so and tells them
 * to have a contractor confirm it. It never blocks anything and never changes a price.
 *
 * ── What it was originally for, and what changed ─────────────────────────────────────
 * It was built to paper over a counting error: `engine.ts` charged ONE suspended deck
 * slab, one soffit and one stair flight for a building of any height, so a G+7 was priced
 * with a single deck where it needs seven and the shortfall grew with every storey.
 *
 * That is fixed — codes 403/407/408 now carry every deck above the first — and the gap it
 * produced is closed: across every city and footprint the engine no longer falls under
 * half the reference at ANY height. So on the estimate path this check is now silent, and
 * `sanity.test.ts` asserts that silence, which is how we know the fix held.
 *
 * It stays because the estimate is not the only number that reaches this function. The
 * costing tab reads `projectBudget`, which returns the owner's own confirmed `budget_usd`
 * when they have set one — and a person can type anything. A client who commits to a
 * quarter of what their building costs is the case this now catches.
 *
 * ── What it compares against ─────────────────────────────────────────────────────────
 * `construction_rates.rule_of_thumb_per_m2` (migration 073). Vanessa's figure, 4 Sep
 * 2026: a Yaoundé build runs about 180,000 XAF per built m². It lives in the database
 * with every other rate because it is the kind of number a quantity surveyor revises
 * after the next project, and that must not need a deploy.
 *
 * It is crude on purpose — blind to finish, shape, roof and room count — which is exactly
 * what makes it usable here. A rough number that disagrees with a precise one by more
 * than half means the precise one is wrong, not the rough one.
 *
 * ── What it must never do ────────────────────────────────────────────────────────────
 * **Show the reference figure to a client.** We cannot defend it as an estimate; it is a
 * check, not a second quotation, and two numbers on one screen invite the reader to
 * average them. The copy says the figure looks low for a building this size and to
 * confirm with a contractor. No number. A test enforces that the copy has no digits.
 */

import type { CityRate, ConstructionRate } from '@/types/project';

/**
 * Warn below half the reference.
 *
 * Half is the point where the two numbers cannot both be describing the same building,
 * whatever you think of the reference's precision. It is deliberately not tuned to sit
 * just under the engine's output: after the deck-slab fix the engine's worst case across
 * every city, footprint and height is about 0.50, so the check sits at the edge of the
 * engine's range rather than inside it. That is the right place for a floor check — it
 * catches a number that has gone wrong, not a number that is merely conservative.
 */
export const UNDER_ESTIMATE_RATIO = 0.5;

export interface EstimateSanity {
  /** Show the warning. False whenever we have no defensible basis to compare against. */
  low: boolean;
  /** Total ÷ reference. `null` when not comparable. Diagnostics only — never rendered. */
  ratio: number | null;
  /** Footprint × floors, in m². */
  builtAreaSqm: number;
}

const NOT_COMPARABLE = (builtAreaSqm: number): EstimateSanity =>
  ({ low: false, ratio: null, builtAreaSqm });

/**
 * Check a total against the regional reference.
 *
 * `totalUSD` is the client-facing total — the same figure the screen prints — so fees are
 * covered, not just the construction line.
 *
 * Returns `low: false` rather than throwing on anything it cannot judge:
 *
 *  · **No reference rate on the country's row.** Nigeria is null and stays null until a
 *    Nigerian Bill of Quantity exists (see the ABUJA note in `model.ts`). A warning drawn
 *    from a guess is a guess wearing a warning's clothes.
 *  · **The rate row and the city row disagree on country**, which would scale a figure by
 *    the wrong city's difference.
 *  · **No city rate resolved**, or one flagged `estimated_index` — Adamawa and Garoua
 *    carry unverified concrete columns.
 *  · **No footprint or floor count yet.** The wizard calls this part-way through.
 */
export function checkEstimate(
  totalUSD: number | null | undefined,
  opts: {
    sqm: number | null | undefined;
    floors: number | null | undefined;
    /** The country rate row. Carries both the reference figure and the FX rate. */
    rate: ConstructionRate | null | undefined;
    cityRate: CityRate | null | undefined;
  },
): EstimateSanity {
  const sqm    = Number(opts.sqm) || 0;
  const floors = Math.max(0, Math.floor(Number(opts.floors) || 0));
  const built  = sqm * floors;

  if (built <= 0) return NOT_COMPARABLE(built);

  const total = Number(totalUSD);
  if (!Number.isFinite(total) || total <= 0) return NOT_COMPARABLE(built);

  const rate = opts.rate;
  const city = opts.cityRate;
  if (!rate || !city) return NOT_COMPARABLE(built);
  if (rate.country_code !== city.country_code) return NOT_COMPARABLE(built);
  if (city.data_source !== 'real_bq')          return NOT_COMPARABLE(built);

  const baseline = Number(rate.rule_of_thumb_per_m2);
  if (!Number.isFinite(baseline) || baseline <= 0) return NOT_COMPARABLE(built);

  const fx = Number(rate.approx_fx_rate);
  if (!Number.isFinite(fx) || fx <= 0) return NOT_COMPARABLE(built);

  // `cost_delta_pct` is the whole-building difference from the baseline city, which is
  // the right basis for scaling a whole-building reference. `index_vs_baseline` is
  // vestigial and scales non-concrete trades only — the wrong number here. So is
  // `rc_350`, which collides with the Yaoundé figure by coincidence of digits alone.
  const cityBaseline = baseline * (1 + (city.cost_delta_pct ?? 0) / 100);
  const referenceUSD = cityBaseline * built / fx;
  if (referenceUSD <= 0) return NOT_COMPARABLE(built);

  const ratio = total / referenceUSD;
  return { low: ratio < UNDER_ESTIMATE_RATIO, ratio, builtAreaSqm: built };
}
