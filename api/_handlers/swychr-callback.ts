import { swychrSettings } from '../swychr/_config.js';
import {
  verifyPayinSignature, parsePayinCallback, payinEventType, payinEventKey, SWYCHR_EVENT,
} from '../swychr/_webhook.js';

/**
 * SwyChr → Groundwork: a collection changed state.
 *
 * ── Why this endpoint is the whole point ─────────────────────────────────────────────
 * 090 allows `expected → funded` and `release_authorised → initiated → disbursed` only
 * from `record_payment_event`, and until now NOTHING called it. Every release sat at
 * "approved" for ever and no payment could reach `disbursed`. This is the writer.
 *
 * ── It records before it decides ─────────────────────────────────────────────────────
 * `record_payment_event` is idempotent on (provider, provider_event_id) and stores the
 * event whether or not it produces a transition — an unmatched transaction, an illegal
 * move or a status we do not recognise is kept with an `outcome` rather than dropped.
 * That trail is what makes a disputed payment answerable.
 *
 * ── Their contract, followed ─────────────────────────────────────────────────────────
 * Respond 2xx within 15 seconds or they retry, up to five times with backoff, and the
 * same event may arrive more than once. So every path below answers quickly and the
 * idempotency key makes a repeat free. Only an actual failure to record returns 500,
 * because that is the one case where we DO want it sent again.
 */

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const header = (name: string): string | null => {
    const raw = req.headers?.[name];
    const v = Array.isArray(raw) ? raw[0] : raw;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  const settings = await swychrSettings();
  const secret = settings.SWYCHR_WEBHOOK_SECRET.value;
  if (!secret) {
    // An endpoint that accepts anything is worse than one that is switched off.
    console.error('[swychr-callback] no SWYCHR_WEBHOOK_SECRET is set — refusing');
    res.status(503).json({ error: 'Not configured' });
    return;
  }

  // Signed over `{timestamp}.{raw_body}`, so the untouched bytes are required.
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);
  const timestamp = header('x-webhook-timestamp');
  if (!verifyPayinSignature(raw, timestamp, header('x-webhook-signature'), secret)) {
    console.error('[swychr-callback] refused: signature or timestamp did not verify; bytes:', raw.length);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[swychr-callback] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const body = req.body ?? {};
  const event = typeof body.event === 'string' ? body.event : null;
  const parsed = parsePayinCallback(body);

  if (!parsed.transactionId) {
    // Their guidance is to deduplicate on transaction_id; without one there is no safe
    // key, and applying an unkeyed financial event twice would double-count money.
    // 200 so they stop resending something unusable.
    console.error('[swychr-callback] delivery carried no transaction_id; nothing recorded');
    res.status(200).json({ received: true, applied: false, reason: 'no_transaction_id' });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // `transaction_id` is the `payments.id` we sent. Resolved here rather than trusted: an
    // id naming no payment of ours is recorded as unmatched, not acted on.
    const { data: match } = await db.from('payments')
      .select('id').eq('id', parsed.transactionId).maybeSingle();
    const paymentId = (match?.id as string | null) ?? null;

    // An event type the ledger does not know is stored with an `unknown_type` outcome
    // rather than dropped — including a status of theirs we have not seen before.
    const eventType = payinEventType(parsed.statusCode) ?? 'unknown';

    const { data: recorded, error } = await db.rpc('record_payment_event', {
      p_provider: 'swychr',
      p_provider_event_id: payinEventKey(parsed.transactionId, parsed.statusCode),
      p_event_type: eventType,
      p_payload: body,
      p_payment: paymentId,
      p_provider_ref: parsed.providerRef,
    });

    if (error) {
      // 500 on purpose: they retry, and an event we failed to store is one we would
      // rather see again than lose.
      console.error('[swychr-callback] could not record the event:', error.message);
      res.status(500).json({ error: 'Could not record event' });
      return;
    }

    res.status(200).json({
      received: true,
      recorded,
      matched: !!paymentId,
      // Their words and ours, both, so a log line explains itself.
      status: parsed.statusWord ?? parsed.statusCode,
      eventType,
      // Recorded either way; flagged so an unexpected type is visible rather than silent.
      expectedEvent: event === SWYCHR_EVENT,
    });
  } catch (err) {
    console.error('[swychr-callback] failed:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
}
