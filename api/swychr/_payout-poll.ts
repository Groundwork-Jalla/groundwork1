import { payoutEventType } from './_webhook.js';

/**
 * Watching money leave — the half SwyChr does not push.
 *
 * Their pay-in sends a webhook on every status change. Their payout sends nothing:
 * `transaction_status` is the only way to learn an outcome, so the outgoing leg has to be
 * asked where the incoming one is told. That asymmetry is theirs, not a shortcut here.
 *
 * ── The poller observes; it never decides ────────────────────────────────────────────
 * Nothing in this file writes to `payments`. It reads a provider status, translates it,
 * and hands it to `record_payment_event` — the same RPC the webhook calls, and the only
 * thing 090 permits to move a payment's state. Two provider paths, one authority:
 *
 *     pay-in webhook  ─┐
 *                      ├→ record_payment_event() → ledger
 *     payout poll     ─┘
 */

export type PayoutRow = {
  id: string;
  direction: string;
  state: string;
  provider: string | null;
  providerRef: string | null;
};

/**
 * Which payouts are worth asking about.
 *
 * `initiated` is money in flight. `reconciling` is money whose fate is being established
 * after a failure — `open_reconciliation` put it there deliberately, and it is the one
 * way out of `failed`, so it keeps being asked.
 *
 * Everything else is either not with the provider yet (`release_authorised` — nothing has
 * been sent, so there is nothing to ask about), terminal (`disbursed`), or terminal until
 * a person decides otherwise (`failed`). Incoming rows are never polled: they have a
 * webhook, and asking would be a second, slower answer to a question already answered.
 */
export const POLLABLE_STATES = ['initiated', 'reconciling'] as const;

export function isPollable(row: PayoutRow): boolean {
  return row.direction === 'out'
    && row.provider === 'swychr'
    && !!row.providerRef
    && (POLLABLE_STATES as readonly string[]).includes(row.state);
}

/**
 * The idempotency key for a polled observation.
 *
 * Deliberately free of any clock: keyed on the provider's own transaction reference and
 * the status it is reporting, so asking the same question every five minutes inserts one
 * event and then nothing. A key containing the poll time would create a row per poll, and
 * `record_payment_event` would re-apply a transition it has already applied.
 *
 * A genuine change still gets a new key, so nothing is swallowed.
 */
export const payoutEventKey = (providerRef: string, status: string | null): string =>
  `payout:${providerRef}:${(status ?? 'unknown').toLowerCase()}`;

export interface PollOutcome {
  paymentId: string;
  /** What SwyChr said, verbatim. */
  providerStatus: string | null;
  /** What that means to the ledger, or `null` when it means nothing yet. */
  eventType: 'initiated' | 'disbursed' | 'failed' | null;
  /** True when the RPC actually inserted — a repeat returns null and counts as unchanged. */
  recorded: boolean;
  /** Set when the provider could not be reached. NEVER a payment failure. */
  error?: string;
}

export interface PollSummary {
  checked: number;
  transitioned: number;
  unchanged: number;
  failed: number;
  outcomes: PollOutcome[];
}

export const emptySummary = (): PollSummary => ({ checked: 0, transitioned: 0, unchanged: 0, failed: 0, outcomes: [] });

export function tally(outcomes: PollOutcome[]): PollSummary {
  return {
    checked: outcomes.length,
    // A transition is an event the RPC accepted AND that meant something to the ledger.
    transitioned: outcomes.filter(o => !o.error && o.recorded && o.eventType !== null).length,
    unchanged: outcomes.filter(o => !o.error && (!o.recorded || o.eventType === null)).length,
    failed: outcomes.filter(o => !!o.error).length,
    outcomes,
  };
}

/** SwyChr's word for a payout → the event type 090 accepts. Shared with the webhook side. */
export const mapPayoutStatus = payoutEventType;
