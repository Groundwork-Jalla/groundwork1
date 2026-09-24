import type { Payment } from '@/lib/supabase/payments';

// =========================================================
// Where a stage's money has actually got to (01 §3 FINANCE) — pure.
//
// ── The four legs ────────────────────────────────────────────────────────────────────
//   1  client → Groundwork      the `in` row: expected → funded → reconciled
//   2  Groundwork decides       the `out` row is born `release_authorised`
//   3  Groundwork → provider    `release_authorised` → `initiated`
//   4  provider → contractor    `initiated` → `disbursed`   (or failed / reconciling)
//
// ── Legs 3 and 4 have no writer ──────────────────────────────────────────────────────
// 090's transition table only allows those two moves from `record_payment_event`, and
// NOTHING in the application calls it — the function is written, granted and unreferenced.
// So in production today a release is authorised and stops there for good: no payment can
// reach `disbursed`, and `payment_events` is permanently empty.
//
// That is a fact about the system, not about any one project, and this file's job is to
// make it visible rather than to render legs 3 and 4 as "pending" — which would suggest
// the money is on its way when nothing is carrying it. `providerConnected` below is
// derived from the rows themselves, so the day a provider does write, the view corrects
// itself without anyone editing this comment.
// =========================================================

export type LegState =
  /** Nothing has happened on this leg yet, and something could. */
  | 'waiting'
  /** Under way — the provider has taken it but not finished. */
  | 'inFlight'
  /** Done. */
  | 'done'
  /** It went wrong. */
  | 'failed'
  /** Its outcome is being established. */
  | 'review'
  /** Nothing can happen on this leg because no provider is connected. */
  | 'noProvider'
  /** This stage was never scheduled for money. */
  | 'notScheduled';

export interface Leg {
  key: 'funding' | 'authorised' | 'toProvider' | 'toContractor';
  state: LegState;
  amount: number | null;
  /** The timestamp the ledger holds for this leg. `null` when it holds none. */
  at: string | null;
  /** The person the ledger names, where it names one. */
  actorId: string | null;
}

export interface StageFlow {
  stageId: string;
  milestone: number | null;
  legs: [Leg, Leg, Leg, Leg];
}

/**
 * Has any provider ever touched this ledger?
 *
 * Derived, never asserted: a single row carrying a provider — or one settled payment —
 * flips this, and the view stops saying no provider is connected.
 */
export const providerConnected = (rows: Payment[]): boolean =>
  rows.some(r => !!r.provider || !!r.providerRef || !!r.settledAt);

/** The live release for a stage: the one that has not failed, else the newest. */
export function liveRelease(rows: Payment[], stageId: string): Payment | null {
  const out = rows.filter(r => r.stageId === stageId && r.direction === 'out');
  if (out.length === 0) return null;
  return out.find(r => r.state !== 'failed')
      ?? [...out].sort((a, b) => (b.authorisedAt ?? b.createdAt).localeCompare(a.authorisedAt ?? a.createdAt))[0];
}

export function stageFlow(
  rows: Payment[],
  stage: { id: string; payment_milestone_usd: number | null },
  connected: boolean,
): StageFlow {
  const inRow = rows.find(r => r.stageId === stage.id && r.direction === 'in') ?? null;
  const out   = liveRelease(rows, stage.id);
  const milestone = stage.payment_milestone_usd;
  const scheduled = (milestone ?? 0) > 0 || !!inRow;

  // 1. The client's money arriving.
  const funding: Leg = {
    key: 'funding',
    state: !scheduled ? 'notScheduled'
         : !inRow ? 'waiting'
         : inRow.state === 'expected' ? 'waiting' : 'done',
    amount: inRow?.amount ?? milestone,
    at: inRow?.confirmedAt ?? null,
    actorId: inRow?.confirmedBy ?? null,
  };

  // 2. Groundwork's own decision. An out row cannot exist without it (090 CHECK).
  const authorised: Leg = {
    key: 'authorised',
    state: !scheduled ? 'notScheduled' : out ? 'done' : 'waiting',
    amount: out?.amount ?? null,
    at: out?.authorisedAt ?? null,
    actorId: out?.authorisedBy ?? null,
  };

  // 3. Handed to the provider. Only `record_payment_event` can do this.
  const toProvider: Leg = {
    key: 'toProvider',
    state: !scheduled ? 'notScheduled'
         : !out ? 'waiting'
         : out.state === 'initiated' ? 'inFlight'
         : out.state === 'disbursed' ? 'done'
         : out.state === 'failed' ? 'failed'
         : out.state === 'reconciling' ? 'review'
         // Authorised and sitting there. Say why nothing is moving.
         : connected ? 'waiting' : 'noProvider',
    amount: out?.amount ?? null,
    at: null,
    actorId: null,
  };

  // 4. The contractor being paid.
  const toContractor: Leg = {
    key: 'toContractor',
    state: !scheduled ? 'notScheduled'
         : !out ? 'waiting'
         : out.state === 'disbursed' ? 'done'
         : out.state === 'failed' ? 'failed'
         : out.state === 'reconciling' ? 'review'
         : out.state === 'initiated' ? 'waiting'
         : connected ? 'waiting' : 'noProvider',
    amount: out?.amount ?? null,
    at: out?.settledAt ?? null,
    actorId: out?.beneficiaryId ?? null,
  };

  return { stageId: stage.id, milestone, legs: [funding, authorised, toProvider, toContractor] };
}

/** How far down the chain this stage has got, for a compact progress read. */
export const legsDone = (flow: StageFlow): number => flow.legs.filter(l => l.state === 'done').length;
