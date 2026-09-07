/**
 * How long a build takes.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * Every project quoted 196 days — a `const PREDICTED_DAYS = 196` sitting in two
 * components — so a bungalow and an eight-storey block were given the same seven months.
 * Beta testers who had actually built in Cameroon said so plainly, and they were right:
 * the number was not an estimate, it was a placeholder.
 *
 * ── The rule, from Vanessa ───────────────────────────────────────────────────────────
 * Agreed on the call of 4 September 2026, and it is deliberately simple:
 *
 *   · a bungalow takes **14 days**
 *   · each storey above ground adds **42 days**
 *
 * So G+0 is 14 days, G+1 is 56, G+2 is 98. Three times the work per added floor, because
 * an upper storey is a slab, columns, walls and a stair — the ground floor is only the
 * last of those on top of a foundation that is already there.
 *
 * ── What it deliberately does NOT model ──────────────────────────────────────────────
 * Not footprint, not finish level, not season, not city. Those all move a real programme
 * and none of them were agreed, and a formula with invented coefficients would be the
 * same mistake as 196 with more decimal places. When Vanessa gives a rule for area or
 * finish, it goes here and the tests below change with it.
 */

/** A single-storey house, foundation to handover. */
export const BUNGALOW_DAYS = 14;

/** Each storey above ground. Slab, columns, walls and stair, on a foundation already in. */
export const DAYS_PER_UPPER_FLOOR = 42;

/** Days per month, for turning a programme into the months the fee formulas bill by. */
export const DAYS_PER_MONTH = 30;

/**
 * Build duration in days.
 *
 * `floors` counts storeys including the ground floor, which is how the wizard asks the
 * question — so 1 is a bungalow and there is no such thing as a zero-floor building.
 */
export function buildDurationDays(floors: number | null | undefined): number {
  const storeys = Math.max(1, Math.floor(Number(floors) || 1));
  return BUNGALOW_DAYS + (storeys - 1) * DAYS_PER_UPPER_FLOOR;
}

/**
 * Build duration in whole months, rounded up, minimum one.
 *
 * Rounded up because the professional fees bill monthly: a site manager engaged for
 * 46 days is paid for two months, not 1.53. Rounding down would under-quote every
 * project that does not land on a month boundary, which is nearly all of them.
 */
export function buildDurationMonths(floors: number | null | undefined): number {
  return Math.max(1, Math.ceil(buildDurationDays(floors) / DAYS_PER_MONTH));
}

/**
 * The relative weight of each of the ten stages.
 *
 * These are the old hard-coded `STAGE_DAYS` figures, kept as *proportions* rather than
 * days. They summed to exactly 196 — which is where the blanket seven months came from —
 * and were copy-pasted into three components and both public tools. The shape of a build
 * programme was never the problem; only its total length was, so the shape survives.
 *
 * Superstructure (index 4) dominates at 70/196, which is why a taller building stretches
 * mostly in the middle rather than spreading evenly.
 */
const STAGE_WEIGHTS = [14, 21, 7, 14, 70, 14, 14, 21, 14, 7] as const;

/** Every stage gets at least this, so no Gantt bar has zero width. */
const MIN_STAGE_DAYS = 1;

/**
 * Split the build duration across the ten stages, summing to it EXACTLY.
 *
 * Largest-remainder, the same method `allocate` uses for money in `index.ts` — floor every
 * share, then hand the shortfall to the biggest fractional remainders one day at a time.
 * Without it a rounded 14-day bungalow would show ten stages adding to 12 or 17 days, and
 * a timeline whose parts disagree with its own total is worse than no timeline.
 *
 * A floor of one day per stage comes out of the pool first. A 14-day bungalow genuinely
 * does have stages that finish inside a day, but a zero-width bar reads as broken rather
 * than as fast.
 */
export function stageDurationDays(floors: number | null | undefined): number[] {
  const total = buildDurationDays(floors);
  const n     = STAGE_WEIGHTS.length;

  const floorTotal = MIN_STAGE_DAYS * n;
  // Degenerate only if the rule ever produces fewer days than stages; spread evenly then.
  if (total <= floorTotal) return STAGE_WEIGHTS.map(() => Math.max(0, Math.floor(total / n)));

  const pool        = total - floorTotal;
  const totalWeight = STAGE_WEIGHTS.reduce((a, b) => a + b, 0);

  const out: number[] = [];
  const rems: { i: number; rem: number }[] = [];
  let assigned = 0;

  STAGE_WEIGHTS.forEach((w, i) => {
    const exact = pool * w / totalWeight;
    const base  = Math.floor(exact);
    out[i] = MIN_STAGE_DAYS + base;
    assigned += base;
    rems.push({ i, rem: exact - base });
  });

  rems.sort((a, b) => b.rem - a.rem);
  for (let k = 0; k < pool - assigned; k++) out[rems[k].i] += 1;

  return out;
}
