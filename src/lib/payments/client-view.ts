import type { Payment } from '@/lib/supabase/payments';
import { availableFunds } from '@/lib/lifecycle/stage';

// =========================================================
// What the project owner is told about their money (01 §3) — pure.
//
// ── The ledger, and only the ledger ──────────────────────────────────────────────────
// `project_stages.payment_status` is a projection maintained by `project_payment_status()`
// (090). It is legacy compatibility and nothing here reads it: if the projection and the
// rows ever disagree, the client sees what the rows say. A mismatch is a problem for
// staff to see in diagnostics, not a badge to put in front of the person whose money it is.
//
// `project.budget_usd` is not money either. The screen this replaces computed
// `budget_usd − milestones marked paid` and called the result an escrow balance — an
// arithmetic figure presented as a held sum. Groundwork records and governs; it does not
// hold the funds, so there is no balance to show and no wallet to name.
//
// ── Approved is not paid ─────────────────────────────────────────────────────────────
// An authorised release is a DECISION. Until the provider reports movement the money has
// not gone anywhere, so it is counted separately and subtracted from what is available —
// otherwise the same money reads as spendable twice.
// =========================================================

/** What the client is shown, in their words rather than the column's. */
export type FundingLabel = 'awaiting' | 'confirmed' | 'notScheduled';
export type ReleaseLabel = 'none' | 'approved' | 'processing' | 'paid' | 'issue' | 'review';

export interface StageRowLike { id: string; stage_number: number; payment_milestone_usd: number | null }

export interface Totals {
  /** `in` rows whose receipt has been established. */
  funded: number;
  /** `out` rows the provider has reported as moved. */
  disbursed: number;
  /** `out` rows decided but not yet moved — approved, in flight, or under review. */
  approved: number;
  /** funded − everything out that has not failed. What is left to release. */
  available: number;
  /** `null` when the ledger could not be read. Never 0 — that is a different fact. */
  unavailable: boolean;
}

export function totals(rows: Payment[] | null): Totals | null {
  if (rows === null) return null;
  const sum = (p: (r: Payment) => boolean) => rows.filter(p).reduce((a, r) => a + r.amount, 0);
  return {
    funded:    sum(r => r.direction === 'in'  && (r.state === 'funded' || r.state === 'reconciled')),
    disbursed: sum(r => r.direction === 'out' && r.state === 'disbursed'),
    // Committed but not moved. `failed` is excluded: that money never left.
    approved:  sum(r => r.direction === 'out' && (r.state === 'release_authorised' || r.state === 'initiated' || r.state === 'reconciling')),
    // The same helper the admin ledger uses, so the two surfaces cannot disagree.
    available: availableFunds(rows),
    unavailable: false,
  };
}

/** The stage's incoming row. A stage has at most one — 090 seeds and maintains it. */
export const fundingRow = (rows: Payment[], stageId: string): Payment | null =>
  rows.find(r => r.stageId === stageId && r.direction === 'in') ?? null;

/** The stage's outgoing rows, newest decision first. */
export const releaseRows = (rows: Payment[], stageId: string): Payment[] =>
  rows.filter(r => r.stageId === stageId && r.direction === 'out')
      .sort((a, b) => (b.authorisedAt ?? b.createdAt).localeCompare(a.authorisedAt ?? a.createdAt));

export function fundingLabel(row: Payment | null, stage: StageRowLike): FundingLabel {
  if (row) return row.state === 'expected' ? 'awaiting' : 'confirmed';
  // No row and no milestone means this stage was never scheduled for funding — which is
  // not the same as awaiting it, and must not be drawn as zero.
  return (stage.payment_milestone_usd ?? 0) > 0 ? 'awaiting' : 'notScheduled';
}

export function releaseLabel(rows: Payment[]): ReleaseLabel {
  if (rows.length === 0) return 'none';
  // Worst first: a stage with a failed release and an older paid one is not "paid".
  const has = (s: Payment['state']) => rows.some(r => r.state === s);
  if (has('failed'))             return 'issue';
  if (has('reconciling'))        return 'review';
  if (has('initiated'))          return 'processing';
  if (has('release_authorised')) return 'approved';
  if (has('disbursed'))          return 'paid';
  return 'none';
}

export type NextPayment =
  /** The earliest stage still awaiting funding. */
  | { kind: 'due'; stage: StageRowLike; amount: number; payment: Payment }
  /** Every scheduled milestone has been funded. Not "$0 due". */
  | { kind: 'allFunded' }
  /** No stage carries a milestone, so there is nothing to fund yet. */
  | { kind: 'noMilestones' };

/**
 * What to pay next.
 *
 * By CONSTRUCTION ORDER, not by when the row happened to be written: the tranches are
 * seeded by a trigger and a later stage's row can be created first, so `created_at` would
 * point a client at the wrong stage.
 */
export function nextPayment(rows: Payment[], stages: StageRowLike[]): NextPayment {
  const scheduled = stages.filter(s => (s.payment_milestone_usd ?? 0) > 0);
  if (scheduled.length === 0) return { kind: 'noMilestones' };

  for (const stage of [...scheduled].sort((a, b) => a.stage_number - b.stage_number)) {
    const row = fundingRow(rows, stage.id);
    if (row && row.state === 'expected') {
      return { kind: 'due', stage, amount: row.amount, payment: row };
    }
  }
  return { kind: 'allFunded' };
}

export interface ActivityItem {
  key: string;
  kind: 'funded' | 'approved' | 'processing' | 'paid' | 'issue' | 'review';
  stageId: string | null;
  amount: number;
  /** The moment the ledger records for THAT event. `null` when the row carries none. */
  at: string | null;
}

/**
 * The activity feed, built from the payment rows themselves.
 *
 * Deliberately not `payment_events`: those carry provider payloads and internal
 * reconciliation detail, and the client's timeline needs none of it. Each row contributes
 * the one event its state represents, stamped with the timestamp the ledger actually
 * holds for it — `confirmed_at`, `authorised_at`, `settled_at` — and nothing invented
 * when a row has none.
 */
export function activity(rows: Payment[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const r of rows) {
    if (r.direction === 'in') {
      if (r.state === 'funded' || r.state === 'reconciled') {
        out.push({ key: r.id, kind: 'funded', stageId: r.stageId, amount: r.amount, at: r.confirmedAt });
      }
      continue;
    }
    const kind: ActivityItem['kind'] | null =
      r.state === 'disbursed'          ? 'paid'
      : r.state === 'initiated'        ? 'processing'
      : r.state === 'release_authorised' ? 'approved'
      : r.state === 'failed'           ? 'issue'
      : r.state === 'reconciling'      ? 'review'
      : null;
    if (!kind) continue;
    out.push({
      key: r.id, kind, stageId: r.stageId, amount: r.amount,
      at: r.state === 'disbursed' ? (r.settledAt ?? r.authorisedAt) : r.authorisedAt,
    });
  }
  // Newest first; anything undated sinks rather than claiming to be recent.
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
