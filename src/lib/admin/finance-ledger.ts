import type { Payment } from '@/lib/supabase/payments';

// =========================================================
// Every movement of money, as a line an operator can read (01 §3 FINANCE) — pure.
//
// The ledger stores a payment as a state and two ids. What an operator actually asks is
// older and simpler: where did this money go, when, and what was it for. So each row is
// shaped into exactly those three answers plus the amount, and a field the ledger does
// not hold comes back `null` rather than as a plausible-looking blank.
//
// ── Two directions, two different questions ──────────────────────────────────────────
//   in   money arriving from the client who owns the project. "For" is the stage whose
//        milestone it funds; "who" is the account that owes it.
//   out  money leaving to a contractor. "For" is the stage whose work it pays for;
//        "who" is `beneficiary_id`, which 090 requires on every outgoing row.
//
// Nothing here is derived from a budget or a projection. A figure on this screen is a row
// in `payments` or it is not shown.
// =========================================================

export interface PartyLookup {
  /** id → a readable name, or `null` when the account cannot be read. */
  (id: string | null): string | null;
}

export interface StageRef { id: string; number: number; name: string }

export interface LedgerLine {
  id: string;
  direction: 'in' | 'out';
  state: Payment['state'];
  amount: number;
  currency: string;

  /** The project the money belongs to, and its name where we can read one. */
  projectId: string;
  projectName: string | null;

  /** WHAT FOR: the stage whose milestone this funds or pays for. */
  stage: StageRef | null;

  /**
   * WHO: the beneficiary on the way out, the project's client on the way in.
   * `null` when the account cannot be read — never a raw id, never a guess.
   */
  partyId: string | null;
  partyName: string | null;

  /**
   * WHEN this movement happened, and what that timestamp means.
   *
   * `confirmed` — receipt was established (in)
   * `settled`   — the provider reported the money moved (out)
   * `authorised`— a release was decided but has not moved (out)
   * `created`   — nothing has happened yet; this is when the row was written
   */
  at: string;
  atMeans: 'confirmed' | 'settled' | 'authorised' | 'created';

  /** HOW receipt was established, for incoming rows only. */
  via: Payment['fundingSource'];
  /** The staff member who confirmed or authorised it, where the ledger names one. */
  actorId: string | null;
  actorName: string | null;

  /** Only when the provider gave one. Never invented. */
  providerRef: string | null;
  failureReason: string | null;
  note: string | null;
}

/**
 * When this movement happened.
 *
 * Preference order is the strongest fact available: money that settled, then money whose
 * receipt was confirmed, then a decision that was taken, then the row's own birthday. The
 * label travels with the timestamp so a date is never read as more than it is — an
 * authorised release dated today has not moved today.
 */
function when(p: Payment): { at: string; atMeans: LedgerLine['atMeans'] } {
  if (p.settledAt)    return { at: p.settledAt,    atMeans: 'settled' };
  if (p.confirmedAt)  return { at: p.confirmedAt,  atMeans: 'confirmed' };
  if (p.authorisedAt) return { at: p.authorisedAt, atMeans: 'authorised' };
  return { at: p.createdAt, atMeans: 'created' };
}

export function ledgerLine(
  p: Payment,
  opts: {
    projectName: (id: string) => string | null;
    ownerOf: (projectId: string) => string | null;
    nameOf: PartyLookup;
    stageOf: (id: string | null) => StageRef | null;
  },
): LedgerLine {
  // Outgoing money names its beneficiary; incoming money is the project owner's, and 090
  // forbids a beneficiary on an incoming row, so the owner is the only honest answer.
  const partyId = p.direction === 'out' ? p.beneficiaryId : opts.ownerOf(p.projectId);
  const actorId = p.direction === 'out' ? p.authorisedBy : p.confirmedBy;
  const { at, atMeans } = when(p);

  return {
    id: p.id,
    direction: p.direction,
    state: p.state,
    amount: p.amount,
    currency: p.currency,
    projectId: p.projectId,
    projectName: opts.projectName(p.projectId),
    stage: opts.stageOf(p.stageId),
    partyId,
    partyName: opts.nameOf(partyId),
    at,
    atMeans,
    via: p.fundingSource,
    actorId,
    actorName: opts.nameOf(actorId),
    providerRef: p.providerRef,
    failureReason: p.failureReason,
    note: p.note,
  };
}

/**
 * What this money was for, in the order the ledger can actually answer it.
 *
 *   1. the stage it is attached to — the real reason a milestone moves
 *   2. the note a person wrote on the row
 *   3. nothing
 *
 * `null` is returned for the third case and the screen says "Purpose not recorded".
 * There is no fourth step: inferring a purpose from the project, the amount or the date
 * would put a sentence in an audit trail that nobody wrote.
 */
export function purposeOf(line: Pick<LedgerLine, 'stage' | 'note'>): string | null {
  if (line.stage) return line.stage.name;
  const note = (line.note ?? '').trim();
  return note || null;
}

/** Money that needs a person: a release that failed, or one whose fate is being established. */
export const needsAttention = (lines: LedgerLine[]): LedgerLine[] =>
  lines.filter(l => l.direction === 'out' && (l.state === 'failed' || l.state === 'reconciling'));

/** Newest movement first. The date shown is the date sorted on, so the order reads true. */
export const byWhen = (lines: LedgerLine[]): LedgerLine[] =>
  [...lines].sort((a, b) => b.at.localeCompare(a.at));

/** What a search box should match: the project, the person, the stage, the reference. */
export function matchesLine(line: LedgerLine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    line.projectName ?? '', line.partyName ?? '', line.stage?.name ?? '',
    line.providerRef ?? '', line.note ?? '', String(line.amount),
  ].some(v => v.toLowerCase().includes(q));
}

export interface DirectionTotals {
  /** Money that has actually moved: confirmed in, or disbursed out. */
  settled: number;
  /** Decided or expected, but not moved. */
  pending: number;
  /** Outgoing: authorised and sitting there. A decision, not a payment. */
  approved: number;
  /** Outgoing: handed to the provider and in flight. */
  processing: number;
  /** Outgoing rows the provider could not complete. */
  failed: number;
  count: number;
}

export function totalsFor(lines: LedgerLine[], direction: 'in' | 'out'): DirectionTotals {
  const mine = lines.filter(l => l.direction === direction);
  const sum = (pred: (l: LedgerLine) => boolean) => mine.filter(pred).reduce((a, l) => a + l.amount, 0);
  if (direction === 'in') {
    return {
      settled: sum(l => l.state === 'funded' || l.state === 'reconciled'),
      // Expected. Kept apart from `settled` everywhere: it has not arrived.
      pending: sum(l => l.state === 'expected'),
      approved: 0, processing: 0,
      failed: 0,   // 090 gives incoming rows no failed state.
      count: mine.length,
    };
  }
  const approved   = sum(l => l.state === 'release_authorised');
  const processing = sum(l => l.state === 'initiated' || l.state === 'reconciling');
  return {
    settled: sum(l => l.state === 'disbursed'),
    // Committed but not gone — the two above, together.
    pending: approved + processing,
    approved,
    processing,
    failed: sum(l => l.state === 'failed'),
    count: mine.length,
  };
}
