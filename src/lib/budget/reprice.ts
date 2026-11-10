import type { StageKey } from '@/lib/projects/stage-from-description';
import type { StageShares } from './stage-shares';

// =========================================================
// Re-cutting the schedule of a build that is already running.
//
// 183 widened `budget_pct` and `stage-shares.ts` writes each building's own split — but
// only at CREATION. Every caller of `apply_budget_milestones` (036, 042, 072, 103, 109,
// 121, 162) is a one-time creation or join step, so a project that started before the
// fix keeps the national-average split for ever. Philip, 10 Nov, looking at exactly such
// a project: "why is the costing still same thing".
//
// ── MONEY THAT HAS MOVED IS NOT RE-CUT ────────────────────────────────────────────────
//
// A stage that was paid for is a number a client transferred and a contractor received.
// Rewriting it would make the schedule disagree with the ledger and with a receipt
// somebody is holding. So settled stages keep their milestone to the dollar, their
// amount is taken OUT of the pot, and only what is still owed is re-cut.
//
// That is why this is not simply "apply the new shares". The new shares describe the
// whole building; what is left to allocate is the whole building minus what has already
// been settled, and the unsettled stages divide that in the proportions the take-off
// gives them RELATIVE TO EACH OTHER.
//
// ── THE PERCENTAGE HAS TO REPRODUCE THE AMOUNT ───────────────────────────────────────
//
// `apply_budget_milestones` re-derives every milestone as `construction x budget_pct/100`
// and runs again on any later re-price. So the percentage written back is not the
// take-off share — it is whatever share yields the amount computed here. Write the
// take-off share instead and the next re-price would quietly undo the protection above
// and re-cut the settled stages after all.
// =========================================================

/** What a re-price needs to know about a stage. */
export interface RepriceStage {
  id: string;
  stage_number: number;
  stage_key: string | null;
  budget_pct: number | null;
  payment_milestone_usd: number | null;
  fixed_amount_usd: number | null;
  payment_status: string | null;
  status: string;
  pre_existing?: boolean | null;
}

export interface RepriceRow {
  stageId: string;
  stageNumber: number;
  stageKey: string | null;
  /** Untouched: money has already moved against it, or it carries a fixed fee. */
  settled: boolean;
  /** Why it was left alone, for the preview. Null when it was re-cut. */
  heldReason: 'paid' | 'complete' | 'pre_existing' | 'fixed_fee' | null;
  wasPct: number;
  nowPct: number;
  wasAmount: number;
  nowAmount: number;
}

export interface RepricePlan {
  rows: RepriceRow[];
  /** Only the rows that actually change — what gets sent to the database. */
  changes: { stageId: string; budgetPct: number; milestoneUsd: number }[];
  /** Already settled and therefore out of the pot. */
  settledTotal: number;
  /** What the unsettled stages divide between them. */
  remaining: number;
  /**
   * True when the settled stages already account for more than the construction fee.
   *
   * Reachable: a project re-priced DOWN after stages were paid at the old, higher
   * figures. Every remaining stage then goes to zero and the overrun is reported rather
   * than spread as negative milestones.
   */
  overcommitted: boolean;
}

const SETTLED_STATUSES = new Set(['complete']);

/** Money has moved, or will not: this stage keeps exactly what it has. */
function heldReason(stage: RepriceStage): RepriceRow['heldReason'] {
  if (stage.pre_existing) return 'pre_existing';
  if (stage.payment_status === 'paid') return 'paid';
  if (SETTLED_STATUSES.has(stage.status)) return 'complete';
  // The design fee is an absolute amount on `fixed_amount_usd` (036), not a share of
  // construction. It is not the take-off's to redistribute.
  if (stage.fixed_amount_usd != null && Number(stage.fixed_amount_usd) > 0) return 'fixed_fee';
  return null;
}

/**
 * Work out the new schedule without writing anything.
 *
 * Deliberately pure and deliberately separate from the call that applies it, so an
 * administrator sees the before and after of every line before any of it is committed.
 */
export function planReprice(
  stages: RepriceStage[],
  construction: number,
  shares: StageShares,
): RepricePlan {
  const ordered = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  const held: RepriceStage[] = [];
  const open: RepriceStage[] = [];
  for (const s of ordered) (heldReason(s) ? held : open).push(s);

  const amountOf = (s: RepriceStage) => Number(s.payment_milestone_usd ?? 0);

  // Out of the pot: what the settled stages already carry. The design fee is excluded
  // from `construction` to begin with, so a held fixed-fee stage contributes nothing to
  // this sum and nothing to what is left.
  const settledTotal = held
    .filter(s => heldReason(s) !== 'fixed_fee')
    .reduce((a, s) => a + amountOf(s), 0);

  const remaining = construction - settledTotal;
  const overcommitted = remaining < 0;
  const pot = Math.max(0, remaining);

  // The take-off shares of the stages still open, renormalised against each other.
  const shareOf = (s: RepriceStage) =>
    Math.max(0, shares[(s.stage_key ?? '') as StageKey] ?? 0);
  const openShareTotal = open.reduce((a, s) => a + shareOf(s), 0);

  // Whole dollars, shared out by largest remainder so the open stages add up to the pot
  // exactly. Rounding each one alone let the column drift from the construction fee, and
  // the stage list then read a little MORE than the budget it came from. The pot is
  // floored, so a schedule can fall short by under a dollar but never exceed it.
  const amounts = new Map<string, number>();
  if (openShareTotal > 0) {
    const whole = Math.floor(pot + 1e-9);
    const exact = open.map(s => ({ id: s.id, v: whole * (shareOf(s) / openShareTotal) }));
    let spare = whole - exact.reduce((a, e) => a + Math.floor(e.v), 0);
    const byRemainder = [...exact].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
    for (const e of exact) amounts.set(e.id, Math.floor(e.v));
    for (const e of byRemainder) {
      if (spare <= 0) break;
      amounts.set(e.id, (amounts.get(e.id) ?? 0) + 1);
      spare -= 1;
    }
  }

  const rows: RepriceRow[] = [];
  const changes: RepricePlan['changes'] = [];

  for (const s of ordered) {
    const reason = heldReason(s);
    const wasPct = Number(s.budget_pct ?? 0);
    const wasAmount = amountOf(s);

    if (reason) {
      rows.push({
        stageId: s.id, stageNumber: s.stage_number, stageKey: s.stage_key,
        settled: true, heldReason: reason,
        wasPct, nowPct: wasPct, wasAmount, nowAmount: wasAmount,
      });
      continue;
    }

    // Nothing to divide, or this stage has no share of the priced work. Either way it
    // goes to zero rather than keeping a figure the take-off does not support.
    const nowAmount = amounts.get(s.id) ?? 0;

    // The percentage that reproduces this amount — see the header. With no construction
    // fee there is nothing meaningful to express a share of, so it keeps what it had.
    const nowPct = construction > 0
      ? Number(((nowAmount / construction) * 100).toFixed(6))
      : wasPct;

    rows.push({
      stageId: s.id, stageNumber: s.stage_number, stageKey: s.stage_key,
      settled: false, heldReason: null, wasPct, nowPct, wasAmount, nowAmount,
    });

    if (nowAmount !== wasAmount || nowPct !== wasPct) {
      changes.push({ stageId: s.id, budgetPct: nowPct, milestoneUsd: nowAmount });
    }
  }

  return { rows, changes, settledTotal, remaining, overcommitted };
}

/**
 * Does this plan still add up?
 *
 * The property an administrator is really being asked to approve: every stage milestone,
 * settled and re-cut together, sums to the construction fee the project was quoted. A
 * re-price that silently changes the project total is the bug this whole exercise exists
 * to remove, not a new feature.
 *
 * Tolerance is one dollar per re-cut stage: each is an independent `Math.round`.
 */
export function repriceBalances(plan: RepricePlan, construction: number): boolean {
  if (plan.overcommitted) return false;
  const total = plan.rows
    .filter(r => r.heldReason !== 'fixed_fee')
    .reduce((a, r) => a + r.nowAmount, 0);
  // Never over the fee; under it by less than a dollar, from flooring the pot.
  return total <= construction + 1e-6 && construction - total < 1 + 1e-6;
}
