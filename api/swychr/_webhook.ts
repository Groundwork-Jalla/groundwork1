import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The payin callback, from SwychrPay's webhook documentation (Sep 2026).
 *
 *   event    payment_link_status_updated   — the only type they dispatch
 *   headers  X-Webhook-Timestamp   unix epoch seconds at the moment of signing
 *            X-Webhook-Signature   HMAC-SHA256 hex of `{timestamp}.{raw_body}`
 *   body     { event, timestamp, data: { data: { id, type, attributes: {…} } } }
 *
 * Their contract also states: respond 2xx within 15 seconds, delivery is retried up to
 * five times with backoff, the same event may arrive more than once, and deduplication
 * should be keyed on `transaction_id`.
 */

export const SWYCHR_EVENT = 'payment_link_status_updated';

/** Numeric `data.data.attributes.status`, from their status reference table. */
export const PAYIN_STATUS = {
  0: 'pending',
  1: 'successful',
  2: 'failed',
  3: 'expired',
  4: 'processing',
  5: 'declined',
  6: 'rejected',
} as const;

export interface InboundPayin {
  /** OURS — the `payments.id` we sent as `transaction_id`. */
  transactionId: string | null;
  /** Their numeric code, kept as the number so nothing is lost in translation. */
  statusCode: number | null;
  statusWord: string | null;
  amount: number | null;
  currency: string | null;
  providerRef: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v)
  : null;

/**
 * Verify the delivery, exactly as their reference implementation does.
 *
 * The signed string is `{timestamp}.{raw_body}` — NOT the body alone, which is what most
 * providers sign and what this originally assumed. Getting that wrong would have failed
 * every real webhook while passing every test we wrote ourselves.
 *
 * A stale timestamp is refused as well as an unsigned one: without that, a captured
 * delivery could be replayed for ever, and it is still correctly signed.
 *
 * No secret configured is NOT a pass. A financial webhook anyone could forge would let a
 * stranger mark a stage funded.
 */
export function verifyPayinSignature(
  raw: Buffer,
  timestamp: string | null,
  provided: string | null,
  secret: string | undefined,
  now: number = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (!secret || !provided || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${raw.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided.trim(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull what we need out of the documented envelope, tolerant of its nesting. */
export function parsePayinCallback(body: unknown): InboundPayin {
  const root = (body ?? {}) as Record<string, unknown>;
  const outer = (root.data ?? {}) as Record<string, unknown>;
  const inner = (outer.data ?? outer) as Record<string, unknown>;
  const attrs = ((inner.attributes ?? inner) ?? {}) as Record<string, unknown>;

  const code = num(attrs.status);
  return {
    transactionId: str(attrs.transaction_id) ?? str(root.transaction_id),
    statusCode: code,
    statusWord: code !== null && code in PAYIN_STATUS ? PAYIN_STATUS[code as keyof typeof PAYIN_STATUS] : null,
    amount: num(attrs.amount),
    currency: str(attrs.currency_code) ?? str(attrs.currency),
    providerRef: str(inner.id) ?? str(attrs.id) ?? (num(attrs.id) !== null ? String(num(attrs.id)) : null),
  };
}

/**
 * The idempotency key for `record_payment_event`.
 *
 * Their headers carry no delivery id, and their own guidance is to deduplicate on
 * `transaction_id` — but a link legitimately reports more than once as it moves from
 * pending to successful, and collapsing those would lose the transition. So the key is
 * the transaction AND the status it is reporting: a genuine retry of the same state is
 * free, while a real change still gets through.
 */
export const payinEventKey = (transactionId: string, statusCode: number | null): string =>
  `${transactionId}:${statusCode ?? 'unknown'}`;

/**
 * Their status → the event type 090 understands.
 *
 * `record_payment_event` accepts funded, reconciled, initiated, disbursed and failed and
 * refuses anything else as `unknown_type` — recorded, applied to nothing. An incoming
 * tranche can only ever mean funded or failed; pending and processing are real but are
 * not transitions the ledger records for money that has not arrived.
 */
export function payinEventType(statusCode: number | null): 'funded' | 'failed' | null {
  if (statusCode === 1) return 'funded';
  // Failed, expired, declined and rejected all mean the money is not coming.
  if (statusCode === 2 || statusCode === 3 || statusCode === 5 || statusCode === 6) return 'failed';
  return null;
}

/**
 * The same mapping for a POLLED payout status.
 *
 * Payout publishes no webhook — `transaction_status` is the only way to learn an outcome,
 * so the outgoing leg has to be polled where the incoming one is pushed.
 */
export function payoutEventType(status: string | null): 'initiated' | 'disbursed' | 'failed' | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (['pending', 'processing', 'initiated', 'queued'].includes(s)) return 'initiated';
  if (['success', 'successful', 'completed', 'complete', 'paid', 'settled', 'disbursed'].includes(s)) return 'disbursed';
  if (['failed', 'failure', 'cancelled', 'canceled', 'declined', 'reversed', 'rejected', 'expired'].includes(s)) return 'failed';
  return null;
}
