import { projectBudget } from './index';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

// =========================================================
// What a stage is worth, defined once for every surface that prints it.
//
// ── WHY THIS IS A MODULE AND NOT A COMPONENT DETAIL ────────────────────────────────
// The client reads a stage figure on the costing tab; the contractor reads the SAME
// figure on /work, twice, plus a contract total and a progress bar. They are two people
// looking at one payment, and on 11 Nov 2026 they disagreed about it: the costing page
// was corrected to split a bill-of-quantities project across the project total, and the
// contractor's screens went on printing the stored amount — about 3.34% higher on every
// stage.
//
// That is the same shape as the bug that preceded it (one currency change applied to
// the five screens somebody happened to have open) and the same shape as 169's verified
// branch. The repository's answer each time has been: one definition, imported.
//
// ── THE RULE ───────────────────────────────────────────────────────────────────────
// An uploaded bill of quantities ALREADY IS the whole figure, so each stage is its
// percentage of the project total. A build from scratch is priced the other way round —
// the estimator produces a construction cost and the permit, project manager,
// contingency and the rest sit on top — so its stages are shares of construction alone.
//
// ── WHY THE STORED AMOUNT IS NOT SIMPLY TRUSTED ────────────────────────────────────
// It was written when the project was created and can predate a re-price or a corrected
// budget. `20261110000000_stages_sum_to_construction.sql` brings the stored column back
// into line, but it deliberately never touches a stage that is paid, complete,
// pre-existing or fixed-fee — so even after it runs, settled stages keep amounts that a
// percentage would no longer reproduce. Deriving here means the screen is right before
// the migration runs and stays right for the rows it will not touch.
//
// ── SCHEDULE vs PAYABLE: READ THIS BEFORE USING EITHER ─────────────────────────────
// They are different questions and the difference has already caused a bug.
//
//   stageScheduleUsd  what this stage is WORTH.
//   stagePayableUsd   what it counts for on the contractor's side — for work already
//                     standing when the build joined, exactly what was recorded: its
//                     share of a bill, or zero on an estimate. Never derived.
//
// A `pre_existing` stage is complete but was "never approved, verified or funded by us"
// (103). Printing its notional value beside the word "Released" on a contractor's money
// tab would say they had been paid for work Groundwork never financed. The client's
// costing page shows the value, because there the question is what the building cost;
// the contractor's page shows zero, because there the question is what they are owed.
// =========================================================

/** What a stage's percentage is a percentage OF. */
export interface StageBasis {
  /**
   * True when the price came from an uploaded bill of quantities, so the stored
   * percentages describe shares of the PROJECT TOTAL rather than of construction.
   */
  wholeProject: boolean;
  /** The figure a `budget_pct` is applied to. Null when nothing can be derived. */
  base: number | null;
  agreed?: boolean;
}

/**
 * Rebuild the construction total from the stages themselves.
 *
 * Only reached for a build from scratch. It scales the remaining stages' stored amounts
 * back up by their share of the percentages, which recovers the base those amounts were
 * written against — including on a project that joined mid-build, where the completed
 * stages carry a percentage but no money.
 *
 * It is a LAST resort and was briefly the first: keyed on "joined mid-build" it rebuilt
 * the base from amounts written against an older budget and came out about 3.3% high on
 * every stage. Where a bill of quantities exists the project total is a fact and is used
 * instead; this only answers where there is no such fact.
 */
export function inferConstructionTotal(stages: ProjectStageRow[]): number | null {
  const charged = stages.filter(s => (s.budget_pct ?? 0) > 0);
  if (charged.length === 0) return null;

  const totalPct = charged.reduce((acc, s) => acc + (s.budget_pct ?? 0), 0);
  const remaining = charged.filter(s => !s.pre_existing);
  const remainingPct = remaining.reduce((acc, s) => acc + (s.budget_pct ?? 0), 0);
  const remainingMilestones = remaining.reduce((acc, s) => acc + (s.payment_milestone_usd ?? 0), 0);

  if (totalPct <= 0 || remainingPct <= 0 || remainingMilestones <= 0) return null;
  const inferred = Math.round((remainingMilestones * totalPct) / remainingPct);
  return Number.isFinite(inferred) && inferred > 0 ? inferred : null;
}

/**
 * The basis for every stage figure on one project.
 *
 * `hasBoq` is the ONLY thing that decides which way round the pricing went, and it is
 * asked of the documents rather than inferred from the stages. Keying it on
 * `pre_existing` — "did this project join mid-build" — was wrong: joining mid-build says
 * nothing about whether a bill was uploaded, and the two are independent (of the live
 * projects on 11 Nov 2026, five were both, four were a bill alone and five were a
 * mid-build join with no bill at all).
 */
export function stageBasisFor(
  project: ProjectRow,
  stages: ProjectStageRow[],
  hasBoq: boolean,
): StageBasis {
  const budget = projectBudget(project);
  if ((project.pricing_revision ?? 0) > 0) return { wholeProject: project.budget_source === 'boq', base: budget.construction, agreed: true };
  if (project.budget_source === 'boq' || (project.budget_source == null && hasBoq)) {
    return { wholeProject: true, base: budget.total };
  }
  return {
    wholeProject: false,
    base: inferConstructionTotal(stages) ?? budget.construction ?? null,
  };
}

/** `budget_pct` of the basis, or null when the stage carries no percentage. */
function fromPercentage(stage: ProjectStageRow, basis: StageBasis): number | null {
  if (basis.base == null || (stage.budget_pct ?? 0) <= 0) return null;
  return Math.round(basis.base * ((stage.budget_pct ?? 0) / 100) * 100) / 100;
}

/** Work that was already standing when this build joined Groundwork. */
function isHistorical(stage: ProjectStageRow): boolean {
  return stage.pre_existing === true && stage.status === 'complete';
}

/**
 * What this stage is WORTH.
 *
 * Derived from the percentage whenever the percentage is meaningful — always on a bill
 * of quantities project, and on any project for a stage completed before tracking began,
 * whose stored amount is deliberately zero. Otherwise the stored amount stands, because
 * on a build from scratch it is what the client confirmed.
 */
export function stageScheduleUsd(stage: ProjectStageRow, basis: StageBasis): number {
  if (basis.agreed) return stage.payment_milestone_usd ?? 0;
  const derived = fromPercentage(stage, basis);
  // The database allocated rounding remainders across the complete schedule. Reading
  // that allocation preserves the same figure on client, contractor and payment views.
  if (basis.wholeProject) return stage.payment_milestone_usd ?? derived ?? 0;
  if (isHistorical(stage)) {
    return derived ?? stage.payment_milestone_usd ?? 0;
  }
  return stage.payment_milestone_usd ?? 0;
}

/**
 * What this stage counts for on the contractor's side.
 *
 * A stage completed before the build joined Groundwork shows EXACTLY what the system
 * recorded for it, never a figure derived here. On a bill-of-quantities project that is
 * its share of the bill — "stages 1 to 4 should be completed with the actual amount,
 * not zero" (11 Nov 2026). On an estimated build it is the zero that 162 wrote, because
 * that total was only ever for the work to come, and a value invented beside the word
 * "Released" would claim money moved that never did. Either way the number on screen
 * is one the database holds, which is the only kind a contractor can be asked to
 * reconcile against.
 */
export function stagePayableUsd(stage: ProjectStageRow, basis: StageBasis): number {
  if (stage.pre_existing === true) return stage.payment_milestone_usd ?? 0;
  return stageScheduleUsd(stage, basis);
}

/** Payable across a set of stages — the contract value, what is still to come, and so on. */
export function sumPayableUsd(stages: ProjectStageRow[], basis: StageBasis): number {
  return stages.reduce((total, s) => total + stagePayableUsd(s, basis), 0);
}
