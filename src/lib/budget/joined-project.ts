import type { BudgetBreakdown } from '@/types/project';
import { STAGE_KEYS, type StageKey } from '@/lib/projects/stage-from-description';

// =========================================================
// Pricing a build Groundwork joined halfway through.
//
// A partner contractor brings a client whose house is already at the roof. The stages below
// that were built and paid for long before Groundwork existed, so the client must not be
// asked for them — Favour, 30 Sep 2026: "it will not require any payment, we're not going to
// do anything, it will just start from where that contractor is".
//
// ── What the client is shown is what the client will pay ──────────────────────────────
// `budget_usd` becomes the cost of the REMAINING work, not of the whole house. A client who
// joins at stage 6 and sees $80,000 reads it as what they owe; the number they owe is
// smaller, and their payment schedule would never add up to the headline. The full build
// cost is still computed and recorded — `fullTotal` below — because it is a true fact about
// the building and an export wants it.
//
// ── The work still costs what the work costs ──────────────────────────────────────────
// Remaining STAGE milestones are not discounted or rescaled: a roof is priced as a roof,
// from its own share of the full construction figure. Only the stages that were already
// built are dropped. `apply_budget_milestones` is left to write every stage from the full
// construction fee, and migration 103 then zeroes the ones already done — so a remaining
// stage's milestone is identical whether the project joined at stage 1 or stage 6.
//
// ── Fees follow whether their work is still to come ───────────────────────────────────
// Each fee is asked one question: is there anything left for it to pay for?
//   design        stage 2's own fixed amount. Gone if the design is done.
//   permit        a % of construction, paid at the permit application (stage 2). Gone with it.
//   professional  site manager, QS, lawyer, project manager — per MONTH of build, so it is
//                 pro-rated by the share of construction still to come.
//   verification  per verified stage, so it is pro-rated by the number of stages left.
//   contingency   a % of the subtotal, so it follows whatever that subtotal turns out to be.
// Nothing is invented: every line is the existing figure, kept whole or scaled by a share
// this module computes from the same stage percentages the schedule already uses.
// =========================================================

/**
 * Each stage's share of the construction fee, as a percentage.
 *
 * The same numbers `stage-seeds.ts` writes to `project_stages.budget_pct`, kept here as a
 * plain list because this module is pure arithmetic and must not reach for the database.
 * Land Secured and Design Completed are 0: land is bought outside Groundwork and the design
 * carries its own fixed amount instead.
 */
export const STAGE_BUDGET_PCT: Record<StageKey, number> = {
  landSecured: 0, designCompleted: 0, sitePreparation: 2, foundation: 8,
  structureWalls: 30, roofing: 8, electricalPlumbing: 17, finishing: 30,
  exteriorWork: 0, finalHandover: 5,
};

/** Stages that raise a payment at all. `exteriorWork` is 0% in the canonical seed. */
const CHARGED = STAGE_KEYS.filter(k => STAGE_BUDGET_PCT[k] > 0);

export interface JoinedBudget {
  /** What this client will be asked for. Written to `projects.budget_usd`. */
  total: number;
  /** The whole house, for the record. Never shown as what they owe. */
  fullTotal: number;
  /** Passed to `apply_budget_milestones` UNCHANGED — see the header. */
  construction: number;
  /** The five fee lines, each kept or dropped or pro-rated. */
  design: number;
  permit: number;
  professional: number;
  verification: number;
  contingency: number;
  /** 1-based. Stages below this are marked already built. */
  startStage: number;
  /** Which stages will be marked complete without payment or verification. */
  skipped: { stageNumber: number; key: StageKey }[];
  /** The share of construction still to come, 0–1. Shown to the admin as a sanity check. */
  remainingShare: number;
}

const round = (n: number) => Math.round(n);

/**
 * Re-price a full breakdown for a project joining at `startStage`.
 *
 * `startStage` of 1 is an ordinary new build and returns the figures unchanged apart from
 * `fullTotal`, so one code path serves both and there is no "is this a joined project?"
 * branch at the call site.
 */
export function joinedBudget(full: BudgetBreakdown, startStage: number): JoinedBudget {
  const start = Math.min(Math.max(Math.trunc(startStage) || 1, 1), STAGE_KEYS.length);

  const skipped = STAGE_KEYS
    .slice(0, start - 1)
    .map((key, i) => ({ stageNumber: i + 1, key }));
  const skippedKeys = new Set(skipped.map(s => s.key));

  // The share of the build still to come, by the stage percentages the schedule uses.
  const totalPct = STAGE_KEYS.reduce((sum, k) => sum + STAGE_BUDGET_PCT[k], 0);
  const remainingPct = STAGE_KEYS
    .filter(k => !skippedKeys.has(k))
    .reduce((sum, k) => sum + STAGE_BUDGET_PCT[k], 0);
  const remainingShare = totalPct > 0 ? remainingPct / totalPct : 0;

  // Design and permit both belong to stage 2. Past it, neither is owed.
  const designDone = skippedKeys.has('designCompleted');
  const design = designDone ? 0 : full.design;
  const permit = designDone ? 0 : full.permit;

  // Per month of build, so it tracks the construction still to come.
  const professional = round(full.professional * remainingShare);

  // Per verified stage, so it tracks how many charged stages are left.
  const chargedLeft = CHARGED.filter(k => !skippedKeys.has(k)).length;
  const verification = CHARGED.length > 0
    ? round(full.verification * (chargedLeft / CHARGED.length))
    : 0;

  // The stage milestones the client will actually be billed for.
  const stagesDue = round(full.construction * remainingShare);

  // Contingency is a percentage of the subtotal, so it is re-derived from the new subtotal
  // rather than scaled — taking the old figure and multiplying would compound the rounding
  // of every line above it.
  const rate = contingencyRate(full);
  const subtotal = stagesDue + design + permit + professional + verification;
  const contingency = round(subtotal * rate);

  return {
    total: subtotal + contingency,
    fullTotal: full.total,
    // Unchanged on purpose: every remaining stage keeps its true milestone.
    construction: full.construction,
    design, permit, professional, verification, contingency,
    startStage: start,
    skipped,
    remainingShare,
  };
}

/**
 * The contingency rate this breakdown was built with, recovered from its own figures.
 *
 * Read back rather than hard-coded at 2%: the rate is a commercial decision that has already
 * changed once (5% → 2% between the 3 Sep and 4 Sep meetings), and a copy here would go
 * stale silently the next time it moves. A breakdown with no contingency yields 0.
 */
function contingencyRate(full: BudgetBreakdown): number {
  const subtotal = full.construction + full.design + full.permit
                 + full.professional + full.verification;
  if (subtotal <= 0 || !full.contingency) return 0;
  return full.contingency / subtotal;
}
