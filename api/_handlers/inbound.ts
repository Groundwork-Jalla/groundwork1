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
 * ── It records; and, since 6.2, may file a message ──────────────────────────────────
 * Nothing here changes an application's status, a subscription, or anything a person
 * relies on. An inbound event with weaker authentication than our other writes must not
 * be able to accept a contractor. It writes to `ghl_inbound_events` first, always.
 *
 * Phase 6.2 (06 §14) adds one narrow act, behind `GHL_INBOUND_ACT` (default off): a
 * client's inbound message from an IDENTIFIED person is filed onto their thread —
 * `ensure_inbound_conversation` (091, service role) then one `project_messages` upsert
 * with `direction = 'inbound'` set explicitly, idempotent on `ghl_message_id` (085) —
 * and only then is the event stamped `handled_at`. The 091 trigger moves the thread;
 * nothing here updates a conversation. The service role bypasses RLS, so what bounds this
 * write is the secret, the parser, the person lookup, idempotency and the shortness of
 * this list — at worst a forged request puts a message on an existing person's thread,
 * marked origin=ghl, visible with its raw payload. It cannot create a person, accept an
 * application, touch a stage or move money.
 */

import { ghlSettings } from '../ghl/_config.js';
import { inboundMessageRow, parseInboundMessage, resolvePerson } from '../ghl/_inbound-message.js';

const MAX_BODY = 64 * 1024;

/** Constant-time compare, so a wrong secret cannot be found a character at a time. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expected = (await ghlSettings()).GHL_INBOUND_SECRET.value;
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

    const { data: eventRow, error } = await db.from('ghl_inbound_events').insert({
      event_type: eventType,
      email,
      ghl_contact_id: contactId,
      payload: body,
    }).select('id').single();

    if (error || !eventRow?.id) {
      // 500 on purpose: GHL retries, and an event we failed to store is one we would
      // rather see again than lose.
      console.error('[ghl-inbound] could not record event:', error);
      res.status(500).json({ error: 'Could not record event' });
      return;
    }

    // ── 6.2: act, only when switched on, only on an identified person's inbound message ──
    // Every branch below answers 200: the event IS recorded, and a non-2xx would make
    // GHL resend something we already hold. The `reason` is for the logs.
    const acting = (await ghlSettings()).GHL_INBOUND_ACT.value === 'on';
    if (!acting) { res.status(200).json({ received: true, acted: false, reason: 'capture' }); return; }

    const parsed = parseInboundMessage(body);
    if (!parsed.ok) {
      res.status(200).json({ received: true, acted: false, reason: parsed.reason, detail: parsed.detail });
      return;
    }
    const m = parsed.message;
    const personId = await resolvePerson({
      byGhlContactId: async id => (await db.from('profiles').select('id').eq('ghl_contact_id', id).limit(1).maybeSingle()).data?.id ?? null,
      byEmail:        async e  => (await db.from('profiles').select('id').ilike('email', e).limit(1).maybeSingle()).data?.id ?? null,
    }, m.ghlContactId, email);
    if (!personId) {
      // Recorded, unhandled, counted (D2): no person-less thread, no message.
      res.status(200).json({ received: true, acted: false, reason: 'unmatched' });
      return;
    }

    const thread = await db.rpc('ensure_inbound_conversation', {
      p_person: personId, p_ghl_conversation_id: m.ghlConversationId, p_ghl_contact_id: m.ghlContactId, p_channel: m.channel,
    });
    if (thread.error || !thread.data) {
      console.error('[ghl-inbound] could not resolve the thread for event', eventRow.id, thread.error?.message);
      res.status(200).json({ received: true, acted: false, reason: 'no_conversation' });
      return;
    }

    // Idempotent on ghl_message_id (085): a replay inserts nothing and is still "filed".
    const filed = await db.from('project_messages')
      .upsert(inboundMessageRow(thread.data as string, m), { onConflict: 'ghl_message_id', ignoreDuplicates: true })
      .select('id');
    if (filed.error) {
      // handled_at stays NULL: GHL's retry (or a replay) will file it. Never stamp first.
      console.error('[ghl-inbound] could not file message for event', eventRow.id, filed.error.message);
      res.status(200).json({ received: true, acted: false, reason: 'insert_failed' });
      return;
    }
    const duplicate = !filed.data || filed.data.length === 0;

    // Only now — the message exists (inserted or already there) — is the event handled.
    const stamped = await db.from('ghl_inbound_events').update({ handled_at: new Date().toISOString() }).eq('id', eventRow.id);
    if (stamped.error) console.error('[ghl-inbound] filed but could not stamp event', eventRow.id, stamped.error.message);

    res.status(200).json({ received: true, acted: true, filed: duplicate ? 'duplicate' : 'inserted' });
  } catch (err) {
    console.error('[ghl-inbound] failed:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
}
