import { ghlSettings } from '../ghl/_config.js';

/**
 * GoHighLevel → us → Resend. What makes a reply from Conversations actually send.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * `addConversationEmail` puts a record of an email we ALREADY sent onto a contact's
 * thread. That is one direction. The moment somebody types into the reply box in GHL and
 * hits send, GoHighLevel does not deliver anything itself — it POSTs the message to the
 * conversation provider's **delivery URL** and expects that provider to do the sending.
 *
 * We are the provider. Without this endpoint a reply typed in GHL leaves the thread
 * looking sent and never reaches the contractor — the worst possible failure for a
 * feature whose entire purpose is following someone up.
 *
 * ── Authentication ───────────────────────────────────────────────────────────────────
 * GHL does not sign these calls. Two checks, neither strong alone:
 *
 *   · a shared secret in the URL, which we control because we choose the delivery URL
 *   · the locationId must match the one we are configured for
 *
 * That is the same reasoning as the inbound webhook (see `inbound.ts`): the strongest
 * check available, and deliberately limited in what it can cause. This endpoint can only
 * send an email to an address GHL supplies — it cannot change an application, a
 * subscription, or anything a person relies on.
 *
 * ── Unverified against a live account ────────────────────────────────────────────────
 * The payload shape is from GoHighLevel's documentation. Field names are read
 * tolerantly, and anything unrecognised is logged in full rather than dropped, so the
 * first real reply tells us what the contract actually is.
 */

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';

/** Constant-time compare, so a wrong secret cannot be found a character at a time. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * One address from a field that may be a string or an array.
 *
 * GoHighLevel sends `emailTo` as an array — `["someone@example.com"]` — while `emailFrom`
 * and `subject` are plain strings. Reading it with `str()` returned an empty string, so
 * the endpoint rejected its own perfectly valid input as an unusable payload and the
 * reply vanished. Confirmed against a live delivery on 3 Sep 2026.
 */
const addr = (v: unknown): string => {
  if (Array.isArray(v)) return str(v[0]);
  return str(v);
};

/** Every address in a field, for cc/bcc where more than one is meaningful. */
const addrs = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : [v];
  return list.map(str).filter(Boolean);
};

/**
 * Write down what happened, successes included.
 *
 * "No rows at all" is the diagnosis for GoHighLevel never having called us, and that is
 * indistinguishable from "nothing went wrong" unless the successes are recorded too. See
 * migration 068.
 *
 * Best-effort: a logging failure must never stop a reply being delivered.
 */
async function record(entry: {
  outcome: string;
  recipient?: string | null;
  subject?: string | null;
  ghlMessageId?: string | null;
  detail?: string | null;
  payload?: unknown;
}): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await db.from('ghl_delivery_log').insert({
      outcome:        entry.outcome,
      recipient:      entry.recipient ?? null,
      subject:        entry.subject ?? null,
      ghl_message_id: entry.ghlMessageId ?? null,
      detail:         entry.detail?.slice(0, 500) ?? null,
      payload:        entry.payload ?? null,
    });
  } catch (err) {
    console.warn('[ghl-delivery] could not record the attempt:', err);
  }
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cfg = await ghlSettings();
  const expected = cfg.GHL_INBOUND_SECRET.value;
  if (!expected) {
    // Refuse rather than run open. An unauthenticated endpoint that sends mail from our
    // domain is an open relay, and "not configured yet" must never mean "no checks".
    console.error('[ghl-delivery] no inbound secret set — refusing to send');
    res.status(503).json({ error: 'Not configured' });
    return;
  }

  const provided = str(req.query?.secret) || String(req.headers?.['x-groundwork-secret'] ?? '');
  if (!secretMatches(provided, expected)) {
    // Recorded: a wrong secret and a call that never happened look identical from the
    // outside, and they need opposite fixes.
    await record({ outcome: 'unauthorized', payload: req.body ?? null });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // A message for a different sub-account is not ours to send, whatever the secret says.
  const location = str(body.locationId);
  const ours = cfg.GHL_LOCATION_ID.value;
  if (ours && location && location !== ours) {
    console.warn('[ghl-delivery] refused a message for another location:', location);
    await record({ outcome: 'wrong_location', detail: location, payload: req.body ?? null });
    res.status(403).json({ error: 'Wrong location' });
    return;
  }

  // Field names read tolerantly — see the header. GHL's docs and its live payloads have
  // not always agreed, and losing a reply to a renamed key is not an acceptable failure.
  const to      = addr(body.emailTo) || addr(body.to) || addr(body.email);
  const subject = str(body.subject) || '(no subject)';
  // `plainText` is GHL's own text rendering of what was typed. Sent alongside the markup
  // so the mail has a text part, which matters for deliverability and for anyone reading
  // on a client that does not render HTML.
  const html    = str(body.html) || str(body.message) || str(body.body);
  const text    = str(body.plainText) || undefined;
  const cc      = addrs(body.emailCc);
  const bcc     = addrs(body.emailBcc);
  const messageId = str(body.messageId) || str(body.id);

  /**
   * Where a contractor's reply should go.
   *
   * The mail is sent from our verified domain — Resend will not send as
   * `favour@tryjalla.com` and a spoofed From fails DMARC — but `emailFrom` carries the
   * GHL user who actually typed the message. Setting it as Reply-To means the answer
   * reaches that person rather than a noreply mailbox nobody reads.
   */
  const replyTo = str(body.emailReplyTo) || str(body.replyTo) || addr(body.emailFrom) || undefined;

  if (!to || !html) {
    // Logged whole: the first real reply is what tells us the true contract.
    console.error('[ghl-delivery] unusable payload:', JSON.stringify(body).slice(0, 800));
    // The whole body, because the field names are guesswork until a real one arrives.
    await record({
      outcome: 'unusable_payload',
      detail: `to=${to ? 'yes' : 'no'} html=${html ? 'yes' : 'no'}`,
      payload: body,
    });
    res.status(400).json({ error: 'Missing recipient or body' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[ghl-delivery] RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Email is not configured' });
    return;
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('[ghl-delivery] Resend rejected the reply:', r.status, detail.slice(0, 300));
      await record({
        outcome: 'rejected', recipient: to, subject, ghlMessageId: messageId || null,
        detail: `resend ${r.status}: ${detail.slice(0, 300)}`,
      });
      // 200 with an error status would show as delivered in GHL. Fail loudly instead:
      // a reply that did not send must not look like one that did.
      res.status(502).json({ error: 'Could not send', upstreamStatus: r.status });
      return;
    }

    const sent = await r.json().catch(() => ({})) as { id?: string };
    console.log(`[ghl-delivery] sent reply to ${to} (ghl message ${messageId || 'unknown'})`);
    await record({
      outcome: 'sent', recipient: to, subject, ghlMessageId: messageId || null,
      detail: sent.id ? `resend ${sent.id}` : null,
    });
    res.status(200).json({ ok: true, messageId: sent.id ?? null });
  } catch (err) {
    console.error('[ghl-delivery] could not reach Resend:', err);
    res.status(502).json({ error: 'Could not reach the email service' });
  }
}
