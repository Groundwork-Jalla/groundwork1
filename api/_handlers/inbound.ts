/**
 * GoHighLevel → Groundwork. The first thing that comes back the other way.
 *
 * Everything else in this integration is outbound: we tell the CRM what happened and it
 * never answers. So a booked appointment, a reply, or an unsubscribe lives only in GHL,
 * and the admin console shows a contractor as "waiting" while a call is already in the
 * diary.
 *
 * ── Authentication: three doors ──────────────────────────────────────────────────────
 * A *workflow* Webhook action can set a custom header, so it sends `X-Groundwork-Secret`
 * (constant-time compare; replayable if leaked — hence record-only). A *Marketplace*
 * webhook cannot set headers; GHL signs it over the exact bytes — `X-GHL-Signature`
 * (Ed25519, current) or the legacy `X-WH-Signature` (RSA-SHA256) — and we verify against
 * GHL's published public keys (`GHL_WEBHOOK_PUBLIC_KEY_ED25519` / `_RSA`), the GHL header
 * decisive when present. Every door opens the same, narrow endpoint; none → 401. Which one
 * opened is stored as `request.auth` — the method, never the credential. See
 * `../ghl/_inbound-auth.ts`.
 *
 * ── It records; and, since 6.2, may file a message ──────────────────────────────────
 * Nothing here changes an application's status, a subscription, or anything a person
 * relies on. An inbound event with weaker authentication than our other writes must not
 * be able to accept a contractor. It writes to `ghl_inbound_events` first, always — the
 * body as `payload` and, since 094, the sanitised request as `request` (06 §16.7), because
 * the first real payload carried no message id and the question moved to the headers.
 *
 * Phase 6.2 (06 §14) adds one narrow act, behind `GHL_INBOUND_ACT` (default off): a
 * client's inbound message from an IDENTIFIED person is filed onto their thread —
 * `ensure_inbound_conversation` (091, service role) then one `project_messages` upsert
 * with `direction = 'inbound'` set explicitly, idempotent on `ghl_message_id` (085) —
 * and only then is the event stamped `handled_at`. The 091 trigger moves the thread;
 * nothing here updates a conversation. The service role bypasses RLS, so what bounds this
 * write is the authentication, the parser, the person lookup, idempotency and the
 * shortness of this list — at worst a forged request puts a message on an existing
 * person's thread, marked origin=ghl, visible with its raw payload. It cannot create a
 * person, accept an application, touch a stage or move money.
 */

import { ghlSettings } from '../ghl/_config.js';
import { authenticateInbound } from '../ghl/_inbound-auth.js';
import { inboundMessageRow, parseInboundMessage, resolvePerson } from '../ghl/_inbound-message.js';
import { requestMeta } from '../ghl/_inbound-request.js';

const MAX_BODY = 64 * 1024;

const header = (req: any, name: string): string => {
  const raw = req.headers?.[name];
  return String(Array.isArray(raw) ? raw[0] : raw ?? '');
};

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const settings = await ghlSettings();
  const expectedSecret = settings.GHL_INBOUND_SECRET.value ?? '';
  const ed25519PublicKeyPem = settings.GHL_WEBHOOK_PUBLIC_KEY_ED25519.value ?? '';
  const rsaPublicKeyPem = settings.GHL_WEBHOOK_PUBLIC_KEY_RSA.value ?? '';
  if (!expectedSecret && !ed25519PublicKeyPem && !rsaPublicKeyPem) {
    // Refuse rather than accept anonymously. An unconfigured inbound endpoint that took
    // anything offered would be a public write into our database.
    console.error('[ghl-inbound] no inbound secret and no webhook public key is set — refusing');
    res.status(503).json({ error: 'Not configured' });
    return;
  }

  const providedGhlSignature = header(req, 'x-ghl-signature');
  const providedWhSignature = header(req, 'x-wh-signature');
  const auth = authenticateInbound({
    providedSecret: header(req, 'x-groundwork-secret'), expectedSecret,
    providedGhlSignature, providedWhSignature, ed25519PublicKeyPem, rsaPublicKeyPem,
    rawBody: Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0),
  });
  if (!auth) {
    // The log names the step, never the content: it is the evidence if GHL's real
    // signature scheme differs from the documented one. Nothing is recorded on a refusal.
    if (providedGhlSignature || providedWhSignature) {
      console.error('[ghl-inbound] signed request refused:',
        providedGhlSignature ? (ed25519PublicKeyPem ? 'x-ghl-signature (ed25519) did not verify' : 'x-ghl-signature present, no ed25519 key configured')
                             : (rsaPublicKeyPem ? 'x-wh-signature (rsa) did not verify' : 'x-wh-signature present, no rsa key configured'),
        'rawBody bytes:', req.rawBody?.length ?? 0);
    }
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

    // Recorded whole: the body as `payload`, and — since 094 — the request around it as
    // `request`, sanitised before this object exists (no secret, no signature, no cookie,
    // no client IP) plus which door opened (`auth`).
    // If 094 is not applied yet PostgREST refuses the unknown column (PGRST204); then the
    // event is still recorded without it. Capture must never fail on evidence-gathering.
    const row = { event_type: eventType, email, ghl_contact_id: contactId, payload: body };
    let inserted = await db.from('ghl_inbound_events').insert({ ...row, request: requestMeta(req, auth) }).select('id').single();
    if (inserted.error?.code === 'PGRST204') {
      inserted = await db.from('ghl_inbound_events').insert(row).select('id').single();
    }
    const { data: eventRow, error } = inserted;

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

    // ── Location authority (6.2 gate amendment, decided on the 21 Sep capture, 06 §16.13) ──
    // A real InboundMessage names its location. Acting is for OUR sub-account only: absent,
    // different, or nothing configured to compare against → recorded, unhandled, nothing
    // filed. The three cases are told apart in `detail` so the table says which it was.
    const expectedLocation = settings.GHL_LOCATION_ID.value ?? '';
    const locationDetail = !expectedLocation ? 'unconfigured' : !m.locationId ? 'absent' : m.locationId !== expectedLocation ? 'mismatch' : null;
    if (locationDetail) {
      res.status(200).json({ received: true, acted: false, reason: 'wrong_location', detail: locationDetail });
      return;
    }

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

    // ── The reply reaches the build it is about (128) ───────────────────────────────
    //
    // Filed above, the message sits on the PERSON's WhatsApp thread, which carries no
    // project (091) — so the contractor who wrote the original never saw the answer. That
    // made 126 a broadcast rather than a conversation.
    //
    // Only on a first filing: `duplicate` means a replay, and mirroring again would put
    // the same reply on the thread twice.
    if (!duplicate && m.channel === 'whatsapp') {
      try {
        await mirrorReplyToProject(db, personId, m);
      } catch (err) {
        // Never costs the filing. The reply is already recorded and already reachable in
        // the Inbox; a mirror that failed is a message in the wrong place, not a lost one.
        console.error('[ghl-inbound] could not mirror reply to project', err);
      }
    }

    // Only now — the message exists (inserted or already there) — is the event handled.
    const stamped = await db.from('ghl_inbound_events').update({ handled_at: new Date().toISOString() }).eq('id', eventRow.id);
    if (stamped.error) console.error('[ghl-inbound] filed but could not stamp event', eventRow.id, stamped.error.message);

    res.status(200).json({ received: true, acted: true, filed: duplicate ? 'duplicate' : 'inserted' });
  } catch (err) {
    console.error('[ghl-inbound] failed:', err);
    res.status(500).json({ error: 'Could not record event' });
  }
}

/**
 * Put a WhatsApp reply on the project thread, when it is clear which project that is.
 *
 * ── It must never mirror our own voice back ─────────────────────────────────────────
 * The first guard, and the one that matters: 126 sends outbound WhatsApp through the same
 * provider, and a provider that echoes its own sends to this webhook would have us file a
 * message we wrote as if the client had said it — then fan it out again. The ledger knows
 * every provider id we have ever sent, so an id we recognise is our own echo and stops
 * here.
 *
 * ── Why `channel: 'whatsapp'` on the mirror ─────────────────────────────────────────
 * It is true — the reader should see the reply came from a phone — and it closes the loop
 * structurally, because 126's trigger fires only on `jalla`. The contractor is still told:
 * 123 notifies every participant of a project-linked message on any channel.
 */
async function mirrorReplyToProject(
  db: any,
  personId: string,
  m: { ghlMessageId: string; senderName: string; body: string; sentAt: string | null; attachments: unknown[] },
): Promise<void> {
  const ours = await db.from('message_deliveries')
    .select('id').eq('provider_message_id', m.ghlMessageId).limit(1);
  if (ours.data && ours.data.length > 0) return;

  const { data: projectId } = await db.rpc('project_for_whatsapp_reply', { p_person: personId });
  // NULL means nobody can know which build this is about — none, or several. It stays in
  // the Inbox for a human to place, which is where it has always gone.
  if (!projectId) return;

  const { data: conversationId } = await db.rpc('ensure_project_conversation', { p_project: projectId });
  if (!conversationId) return;

  await db.from('project_messages').insert({
    project_id:      projectId,
    conversation_id: conversationId,
    // The author, so 126 excludes them from its own fan-out and the bubble is attributed
    // to the person rather than to nobody.
    sender_id:       personId,
    sender_name:     m.senderName,
    content:         m.body,
    origin:          'ghl',
    direction:       'inbound',
    channel:         'whatsapp',
    attachments:     m.attachments.length ? m.attachments : null,
    // Deliberately NOT ghl_message_id: 085's unique index already holds it for the row
    // filed on the person's own thread, and a second row claiming it would collide.
    ...(m.sentAt ? { created_at: m.sentAt } : {}),
  });
}
