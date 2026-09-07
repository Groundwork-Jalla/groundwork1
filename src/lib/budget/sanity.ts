/**
 * Is this estimate obviously too low?
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * The take-off engine under-prices tall buildings, and we know exactly why. Three lines
 * in `engine.ts` are charged once per BUILDING where they belong once per FLOOR:
 *
 *   · `303` suspended deck slab   · `307` soffit plaster   · `308` staircase
 *
 * A G+7 is therefore priced with one deck slab where it structurally needs seven. The
 * comment at `engine.ts:126-128` shows these are deliberate simplifications from the
 * original calibration, not bugs someone left behind, so correcting them is Vanessa's
 * call and not ours — it moves every number in the book.
 *
 * Until she signs that off, this module is a guard rail. It cannot make the estimate
 * right; it can stop a client being quoted half of what their building will cost without
 * anybody saying so out loud.
 *
 * ── What it compares against ─────────────────────────────────────────────────────────
 * Vanessa's rule of thumb, given on 4 September 2026: a Yaoundé build runs about
 * **180,000 XAF per built m²** — footprint × floors × 180,000. It is crude by design.
 * It knows nothing about finish, shape, room count or roof, which is precisely why it is
 * useful here: a rough number that disagrees with a precise one by more than half means
 * the precise one is wrong, not the rough one.
 *
 * ── What it must never do ────────────────────────────────────────────────────────────
 * **Show the rule-of-thumb figure to a client.** We cannot defend 180,000 × A × f as an
 * estimate — it is a sanity check, not a second quotation, and putting two numbers on
 * one screen invites the reader to average them. The copy says the estimate looks low
 * for a building this size and to confirm with a contractor. No number.
 */

import type { CityRate } from '@/types/project';

/**
 * Yaoundé, per built m², from Vanessa on 4 September 2026.
 *
 * NOT the same quantity as `CityRate.rc_350`, which is also 180,000 for Yaoundé. That
 * one is XAF per m³ of RC-350 concrete. The collision is a coincidence and reading the
 * rule of thumb off that column would silently break the day a concrete rate moves.
 */
export const RULE_OF_THUMB_XAF_PER_M2 = 180_000;

/**
 * Warn below half the rule of thumb.
 *
 * Chosen from the engine's own output rather than picked round. Across every city, at
 * footprints from 70 to 300 m², the estimate-to-rule-of-thumb ratio runs:
 *
 *   1 floor  0.98 – 1.91      4 floors  0.48 – 0.86
 *   2 floors 0.65 – 1.22      6 floors  0.42 – 0.75
 *   3 floors 0.54 – 0.99      8 floors  0.39 – 0.69
 *
 * At 0.5 the warning is SILENT across the whole 1–3 storey range — which is very nearly
 * every real Groundwork project — and fires progressively from four storeys up, exactly
 * where the omitted per-floor slabs bite. It tracks the known defect instead of noise.
 *
 * A single-storey estimate sitting above the rule of thumb is expected, not a fault: the
 * fixed costs of a build amortise over area, so small buildings genuinely cost more per
 * m². The rule of thumb is the crude one there.
 */
export const UNDER_ESTIMATE_RATIO = 0.5;

export interface EstimateSanity {
  /** Show the warning. False whenever we have no defensible basis to compare against. */
  low: boolean;
  /** Estimate ÷ rule of thumb. `null` when not comparable. Diagnostics only — never rendered. */
  ratio: number | null;
  /** Footprint × floors, in m². */
  builtAreaSqm: number;
}

const NOT_COMPARABLE = (builtAreaSqm: number): EstimateSanity =>
  ({ low: false, ratio: null, builtAreaSqm });

/**
 * Check a total against the regional rule of thumb.
 *
 * `totalUSD` is the client-facing total — the same figure the screen prints — so the
 * check covers the fees too and not just the construction line.
 *
 * Returns `low: false` rather than throwing on anything it cannot judge:
 *
 *  · **Outside Cameroon.** The rule of thumb is Vanessa's and it is Cameroonian. There
 *    is no Nigerian Bill of Quantity at all (see `model.ts` on ABUJA), so there is no
 *    honest figure to compare an Abuja build against and a warning there would be a
 *    guess wearing a warning's clothes.
 *  · **No city rate resolved**, or one flagged `estimated_index` — Adamawa and Garoua
 *    carry unverified concrete columns, and a warning drawn off an estimate about an
 *    estimate is not worth showing.
 *  · **No footprint or floor count yet.** The wizard calls this part-way through.
 */
export function checkEstimate(
  totalUSD: number | null | undefined,
  opts: {
    sqm: number | null | undefined;
    floors: number | null | undefined;
    cityRate: CityRate | null | undefined;
    /** XAF per USD, from the construction rate row that produced `totalUSD`. */
    fxRate: number;
  },
): EstimateSanity {
  const sqm    = Number(opts.sqm) || 0;
  const floors = Math.max(0, Math.floor(Number(opts.floors) || 0));
  const built  = sqm * floors;

  if (built <= 0) return NOT_COMPARABLE(built);

  const total = Number(totalUSD);
  if (!Number.isFinite(total) || total <= 0) return NOT_COMPARABLE(built);

  const city = opts.cityRate;
  if (!city || city.country_code !== 'CM') return NOT_COMPARABLE(built);
  if (city.data_source !== 'real_bq')      return NOT_COMPARABLE(built);

  const fx = Number(opts.fxRate);
  if (!Number.isFinite(fx) || fx <= 0) return NOT_COMPARABLE(built);

  // `cost_delta_pct` is the whole-building difference from the baseline city, which is
  // the right basis for scaling a whole-building rule of thumb. `index_vs_baseline` is
  // vestigial and scales non-concrete trades only — it is the wrong number here.
  const cityXafPerM2 = RULE_OF_THUMB_XAF_PER_M2 * (1 + (city.cost_delta_pct ?? 0) / 100);
  const thumbUSD     = cityXafPerM2 * built / fx;
  if (thumbUSD <= 0) return NOT_COMPARABLE(built);

  const ratio = total / thumbUSD;
  return { low: ratio < UNDER_ESTIMATE_RATIO, ratio, builtAreaSqm: built };
}
