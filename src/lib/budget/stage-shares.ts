import type { CityRate, ConstructionRate, WizardFormData } from '@/types/project';
import { runTakeoff, SECTION_KEYS, type SectionKey } from './engine';
import { buildLegacyRate } from './legacy';
import { STAGE_KEYS, type StageKey } from '@/lib/projects/stage-from-description';
import { STAGE_BUDGET_PCT } from './joined-project';

// =========================================================
// The payment schedule follows the take-off, not a national average.
//
// Philip, 9 Nov 2026, reading a live project's costing down the screen with its owner:
// the platform "incorrectly distributes funds starting from stage five onwards", and
// should "stick to the exact amounts allocated to specific stages". The correction he
// asked for was that the distribution "flow to previous stages rather than only building
// from current stages upward".
//
// ── What was actually happening ───────────────────────────────────────────────────────
// Every project's schedule came from ONE fixed list of percentages in `stage-seeds.ts`
// — 2 / 8 / 30 / 8 / 17 / 30 / 5 — applied to the construction fee. Those are a sensible
// national average and they are not this building. The engine had already priced the
// building section by section; nothing ever read that back out.
//
// Run against the four Cameroonian bills of quantities the engine is calibrated on, the
// gap is not a rounding question. Buea Residence, $86,339 of construction:
//
//     stage                 flat model    its own take-off
//     foundation               $6,907            $13,125     model pays HALF
//     structure & walls       $25,902            $44,039     model pays 59%
//     electrical & plumbing   $14,678             $7,203     model pays DOUBLE
//     finishing               $25,902            $14,011     model pays 85% over
//
// The schedule is back-loaded exactly as described: the money that belongs to the
// foundation and the frame is held back and paid out later, against work that costs less
// than the schedule says. A contractor is underpaid through the stages where the spending
// actually happens — which is the half of the build where running out of money stops it.
//
// ── What this module does ─────────────────────────────────────────────────────────────
// Takes the section totals the take-off already produced and reads them onto the stages
// that do that work. Nothing is re-priced and no new rate is introduced: these are the
// engine's own figures, expressed as shares instead of being thrown away.
//
// Shares, not amounts, because `apply_budget_milestones` (036/072) derives every
// milestone from `budget_pct` x the construction fee. Keeping that shape means a later
// re-price — an admin confirming a Management budget, a project joining mid-build
// through 103 — still flows through one place and still lands on the right split.
// =========================================================

/**
 * Which stage does the work each BQ section prices.
 *
 * Six of the ten stages are priced by the take-off. The other four are priced by
 * something else and stay exactly as they were:
 *
 *   landSecured      land is bought outside Groundwork and is not in the budget at all
 *   designCompleted  an absolute design fee on `fixed_amount_usd`, never a share
 *   exteriorWork     never charged — the budget covers the main building
 *   finalHandover    see RETENTION below
 */
export const SECTION_TO_STAGE: Record<SectionKey, StageKey> = {
  preliminary:  'sitePreparation',
  foundation:   'foundation',
  // The frame, ground floor and every floor above it. One stage builds all of it.
  ground_floor: 'structureWalls',
  upper_floor:  'structureWalls',
  roof:         'roofing',
  // Both services run while the walls are still open, and are approved together.
  electrical:   'electricalPlumbing',
  plumbing:     'electricalPlumbing',
  // Doors and windows are hung as part of finishing, and the BQ prices them apart.
  joinery:      'finishing',
  finishing:    'finishing',
};

/**
 * Held back for final handover, as a percentage of the construction fee.
 *
 * The one figure here that the take-off cannot supply. No BQ section prices snagging,
 * cleaning and handover, but the stage exists, has substages, and is the last thing
 * standing between a contractor and being paid in full. Dropping it to zero because no
 * section maps to it would pay the build out completely before anybody inspected it.
 *
 * So it keeps the share the seed always gave it, and the take-off distributes the other
 * 95% among the stages it actually prices. This is the single judgement call in the
 * module and it is deliberately the seed's own number, not a new one.
 */
const RETENTION_PCT = STAGE_BUDGET_PCT.finalHandover;

/** Percentages, keyed by stage, summing to exactly 100. */
export type StageShares = Record<StageKey, number>;

/** How closely two share tables have to agree before the difference is real money. */
const EPSILON = 1e-9;

/**
 * This project's own payment schedule, as percentages of the construction fee.
 *
 * Returns null when the project has no take-off — a country with no model, or a legacy
 * project priced by the flat rate per m². There is nothing to read a split out of, so
 * the caller keeps the seed percentages rather than inventing a split from an average.
 */
export function stageSharesFromTakeoff(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): StageShares | null {
  // The same rate resolution `calculateBudgetDetail` performs, so the shares and the
  // construction fee they will be multiplied by come from one take-off and not two.
  const takeoff = runTakeoff(data as never, rate ?? buildLegacyRate(data), cityRate);
  if (!takeoff) return null;

  // Local currency throughout: these are ratios, and dividing by the FX rate first only
  // adds nine roundings to a number that is about to become a percentage.
  const total = SECTION_KEYS.reduce((a, k) => a + Math.max(0, takeoff.sectionsLocal[k] ?? 0), 0);
  if (total <= 0) return null;

  const priced = 100 - RETENTION_PCT;
  const shares = Object.fromEntries(STAGE_KEYS.map(k => [k, 0])) as StageShares;

  for (const section of SECTION_KEYS) {
    const amount = Math.max(0, takeoff.sectionsLocal[section] ?? 0);
    if (amount <= 0) continue;
    shares[SECTION_TO_STAGE[section]] += (amount / total) * priced;
  }
  shares.finalHandover = RETENTION_PCT;

  return settle(shares);
}

/**
 * Force the table to sum to exactly 100.
 *
 * Nine divisions and a multiplication do not land on a round number, and the drift is
 * then multiplied by the construction fee in two different places — once in TypeScript
 * at creation, once in SQL on every re-price. Left alone it is cents; it is corrected
 * anyway, onto the largest stage, where a cent is invisible. A schedule that does not
 * add up to the budget printed above it is the first thing a client notices.
 */
function settle(shares: StageShares): StageShares {
  const sum = STAGE_KEYS.reduce((a, k) => a + shares[k], 0);
  const drift = 100 - sum;
  if (Math.abs(drift) < EPSILON) return shares;

  const largest = STAGE_KEYS.reduce((a, k) => (shares[k] > shares[a] ? k : a), STAGE_KEYS[0]);
  shares[largest] += drift;
  return shares;
}

/**
 * The share table a project actually gets, take-off or not.
 *
 * `seeds` is the canonical pipeline for this project type. Falling back to it rather
 * than to `STAGE_BUDGET_PCT` keeps one source of truth for the default, and means a
 * project type that ever gets its own percentages is picked up here for free.
 */
export function stageShares(
  seeds: { key: string; budget_pct: number }[],
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): { shares: StageShares; fromTakeoff: boolean } {
  const derived = stageSharesFromTakeoff(data, rate, cityRate);
  if (derived) return { shares: derived, fromTakeoff: true };

  const shares = Object.fromEntries(STAGE_KEYS.map(k => [k, 0])) as StageShares;
  for (const seed of seeds) {
    if ((STAGE_KEYS as readonly string[]).includes(seed.key)) {
      shares[seed.key as StageKey] = seed.budget_pct;
    }
  }
  return { shares, fromTakeoff: false };
}

/**
 * A share as a reader wants to see it: "48.5%", "8%", "0%".
 *
 * Since 183 the stored share is a ratio of priced work, so it arrives as 48.455900 and
 * printing it raw puts six meaningless digits beside a figure in francs. One decimal is
 * enough to tell two stages apart and few enough that the column still lines up; a whole
 * number drops back to a whole number, which is what a project with no take-off has.
 */
export function formatShare(pct: number | null | undefined): string {
  const n = Number(pct ?? 0);
  if (!Number.isFinite(n)) return '0%';
  return `${Number(n.toFixed(1))}%`;
}
