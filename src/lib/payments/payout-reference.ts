// =========================================================
// Attaching a SwyChr payout to the release it pays.
//
// Groundwork does not move this money. SwyChr does. What Groundwork owns is the
// RECORD: which authorised release corresponds to which SwyChr transaction, and what
// happened to it afterwards.
//
// The ledger already handles everything downstream. `record_payment_event` (090/098)
// accepts `release_authorised → initiated`, stamps `initiated_at`, and writes
// `provider_ref`; the five-minute poll then asks SwyChr about every row carrying a
// reference and drives it to `disbursed` or `failed`. The poll only looks at rows in
// `initiated` or `reconciling`, so a release with no reference is invisible to it —
// which is correct, because Groundwork has no way to ask "what transactions exist",
// only "what happened to this one".
//
// So exactly one fact is missing, and it is the one a human holds: the transaction id.
// =========================================================

/** Out-rows only, and only before a reference exists. */
export type AttachRefusal =
  | 'not_outgoing'      // an incoming payment is a client funding the project
  | 'not_authorised'    // no release has been authorised on this row yet
  | 'already_attached'  // a reference is recorded; changing it would rewrite history
  | 'bad_reference';    // not something a provider could have issued

export interface AttachCandidate {
  direction: 'in' | 'out';
  state: string;
  providerRef?: string | null;
}

/**
 * SwyChr's own transaction id, as the operator read it off their dashboard.
 *
 * Deliberately permissive about the format — the published contract does not fix one,
 * and rejecting a valid reference because it failed a shape we invented would leave a
 * real payout unrecordable. It rejects only what no provider could have issued: empty,
 * whitespace inside, control characters, or absurd length.
 */
export function normaliseReference(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 4 || trimmed.length > 128) return null;
  if (/\s/.test(trimmed)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Why this row cannot take a reference, or null when it can.
 *
 * `already_attached` is a refusal rather than an update on purpose. A reference is a
 * claim that a specific transaction paid this release; replacing it would silently
 * re-point a settled record at different money. A mistake there is corrected by
 * opening reconciliation, which leaves a trace, not by overwriting a column.
 */
export function attachRefusal(row: AttachCandidate, reference: string | null): AttachRefusal | null {
  if (row.direction !== 'out') return 'not_outgoing';
  if (row.state !== 'release_authorised') return 'not_authorised';
  if (row.providerRef) return 'already_attached';
  if (!reference) return 'bad_reference';
  return null;
}

/**
 * The idempotency key for the attach itself.
 *
 * `record_payment_event` is idempotent on `(provider, provider_event_id)` and returns
 * NULL on a repeat, so submitting the same reference twice records once. The prefix
 * keeps it clear of `payout:<ref>:<status>`, which the poll uses for its observations —
 * an attach and a later status report on the same transaction are different events and
 * must not collapse into one.
 */
export const attachEventKey = (reference: string): string => `payout-attach:${reference}`;

/** Rows an operator could act on, newest authorisation first. */
export function attachable<T extends AttachCandidate>(rows: readonly T[]): T[] {
  return rows.filter(r => attachRefusal(r, 'placeholder') === null);
}
