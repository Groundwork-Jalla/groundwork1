/**
 * GoHighLevel → Groundwork. The first thing that comes back the other way.
 *
 * Everything else in this integration is outbound: we tell the CRM what happened and it
 * never answers. So a booked appointment, a reply, or an unsubscribe lives only in GHL,
 * and the admin console shows a contractor as "waiting" while a call is already in the
 * diary.
 *
 * ── Authentication ───────────────────────────────────────────────────────────────────
 * GHL's outbound webhooks do not sign their requests the way Stripe does — there is no
 * secret to verify a body against. What GHL *can* do is send a custom header, so this
 * requires a shared secret in `X-Groundwork-Secret` and compares it in constant time.
 * That is weaker than a signature (a leaked secret is replayable), which is exactly why
 * this endpoint only ever *records* — see below.
 *
 * ── It records; it does not act ──────────────────────────────────────────────────────
 * Nothing here changes an application's status, a subscription, or anything a person
 * relies on. An inbound event with weaker authentication than our other writes must not
 * be able to accept a contractor. It writes to `ghl_inbound_events` and stops; acting on
 * one is a later, deliberate step with its own review.
 */

const MAX_BODY = 64 * 1024;

/** Constant-time compare, so a wrong secret cannot be found a character at a time. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expected = process.env.GHL_INBOUND_SECRET;
  if (!expected) {
    // Refuse rather than accept anonymously. An unconfigured inbound endpoint that took
    // anything offered would be a public write into our database.
    console.error('[ghl-inbound] GHL_INBOUND_SECRET is not set — refusing');
    res.status(503).json({ error: 'Not configured' });
    return;
  }

  const raw = req.headers?.['x-groundwork-secret'];
  const provided = String(Array.isArray(raw) ? raw[0] : raw ?? '');
  if (!provided || !secretMatches(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  const serialised = JSON.stringify(body);
  if (serialised.length > MAX_BODY) {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }

  // GHL's payload shape varies by workflow action, so nothing is required beyond
  // something to file it under. Guessing at a schema would reject real events.
  const eventType = typeof body.type === 'string' ? body.type
                  : typeof body.event === 'string' ? body.event
                  : 'unknown';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  const contactId = typeof body.contactId === 'string' ? body.contactId
                  : typeof body.contact_id === 'string' ? body.contact_id
                  : null;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[ghl-inbound] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await db.from('ghl_inbound_events').insert({
      event_type: eventType,
      email,
      ghl_contact_id: contactId,
      payload: body,
    });

    if (error) {
      // 500 on purpose: GHL retries, and an event we failed to store is one we would
      // rather see again than lose.
      console.error('[ghl-inbound] could not record event:', error);
      res.status(500).json({ error: 'Could not record event' });
      return;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[ghl-inbound] failed:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
}
