import { ghlSettings } from '../ghl/_config.js';
import { getSupabaseAdmin, siteUrl } from '../_lib/stripe.js';
import { DEFAULT_SENDER } from '../../src/lib/email/senders.js';

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

const FROM = DEFAULT_SENDER;

/**
 * Put a reply typed in GoHighLevel into the Groundwork chat it belongs to.
 *
 * ── Which project ────────────────────────────────────────────────────────────────────
 * A GHL conversation is per CONTACT. A homeowner with three projects has one thread for
 * all three, and the reply carries no project with it — so there is nothing in the
 * payload to key on.
 *
 * `profiles.ghl_thread_project_id` is what the outbound mirror stamps as it goes past:
 * the project whose message was last pushed to this thread. A reply is filed against
 * that, on the reasoning that you are answering the thing you were just shown.
 *
 * That is a heuristic, and it is the honest ceiling of a per-contact thread rather than
 * a shortcut — a genuinely per-project thread needs the `conversations` generalisation.
 * When the column is null we file nothing and the email alone carries the reply, which
 * is exactly the behaviour that existed before this function.
 *
 * ── Never fails the delivery ─────────────────────────────────────────────────────────
 * Returns a string reason instead of throwing. The reply is already sent; GoHighLevel is
 * waiting on a delivery receipt, and answering it with an error would have GHL retry a
 * message the recipient has already read.
 */
async function fileIntoProjectChat(
  recipientEmail: string,
  bodyText: string,
  raw: Record<string, unknown>,
): Promise<{ filed: boolean; projectId?: string; conversationId?: string; reason: string; duplicate?: boolean }> {
  if (!recipientEmail || !bodyText) return { filed: false, reason: 'no_body' };

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { filed: false, reason: 'no_service_key' };
  }

  try {
    // The person the message is for. A reply to someone with no account has no thread
    // in Groundwork and goes out as email only.
    const { data: profile } = await admin
      .from('profiles')
      .select('id, ghl_thread_project_id')
      .ilike('email', recipientEmail)
      .maybeSingle();
    if (!profile?.id) return { filed: false, reason: 'no_person' };

    const who =
      str(raw.userName) || str(raw.fromName) || addr(raw.emailFrom) || 'Jalla';
    const ghlMessageId = str(raw.messageId) || str(raw.id) || null;

    // ── The thread (091) ──────────────────────────────────────────────────────────
    // Resolved in the database by GHL's conversation id, then contact id, then the
    // person's newest open thread; created pre-project when none exists. Idempotent and
    // safe under concurrent delivery (advisory lock + unique index).
    const resolved = await admin.rpc('ensure_inbound_conversation', {
      p_person:              profile.id,
      p_ghl_conversation_id: str(raw.conversationId) || null,
      p_ghl_contact_id:      str(raw.contactId) || null,
      p_channel:             'email',
    });

    if (resolved.error && resolved.error.code !== 'PGRST202' && resolved.error.code !== '42883') {
      console.error('[ghl-delivery] could not resolve the conversation:', resolved.error.message);
      return { filed: false, reason: 'no_conversation' };
    }

    if (!resolved.error) {
      const conversationId = resolved.data as string;
      // Staff wrote this in GHL to the client: outbound from Groundwork's side. The
      // BEFORE INSERT trigger fills project_id from the thread.
      const { data: inserted, error } = await admin
        .from('project_messages')
        .upsert({
          conversation_id: conversationId,
          sender_id:       null,
          sender_name:     who,
          content:         bodyText,
          origin:          'ghl',
          direction:       'outbound',
          channel:         'email',
          ghl_message_id:  ghlMessageId,
          ghl_synced_at:   new Date().toISOString(),
        }, { onConflict: 'ghl_message_id', ignoreDuplicates: true })
        .select('id, project_id');
      if (error) {
        console.error('[ghl-delivery] could not file reply into chat:', error.message);
        return { filed: false, reason: 'insert_failed' };
      }
      if (!inserted || inserted.length === 0) {
        return { filed: false, reason: 'duplicate', duplicate: true, conversationId };
      }
      return { filed: true, projectId: (inserted[0].project_id as string | null) ?? undefined, conversationId, reason: 'filed' };
    }

    // ── Before 091 is applied: the 077 heuristic, unchanged ───────────────────────
    if (!profile.ghl_thread_project_id) return { filed: false, reason: 'no_thread_project' };
    const { data: inserted, error } = await admin
      .from('project_messages')
      .upsert({
        project_id:  profile.ghl_thread_project_id,
        sender_id:   null,
        sender_name: who,
        content:     bodyText,
        origin:      'ghl',
        ghl_message_id: ghlMessageId,
        ghl_synced_at:  new Date().toISOString(),
      }, { onConflict: 'ghl_message_id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error('[ghl-delivery] could not file reply into chat:', error.message);
      return { filed: false, reason: 'insert_failed' };
    }
    if (!inserted || inserted.length === 0) {
      return { filed: false, reason: 'duplicate', duplicate: true, projectId: profile.ghl_thread_project_id as string };
    }
    return { filed: true, projectId: profile.ghl_thread_project_id as string, reason: 'filed' };
  } catch (e) {
    console.error('[ghl-delivery] chat filing threw:', e);
    return { filed: false, reason: 'exception' };
  }
}

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

  /**
   * File into the project chat BEFORE sending, because what the email should say depends
   * on whether it worked.
   *
   * Product rule, 9 Sep 2026: every form of contact happens inside Groundwork. A reply
   * whose full text is sitting in a mailbox is a conversation that has left the platform
   * — the person answers from their mail client and the thread splits in two.
   *
   * So when the reply lands in the chat, the email becomes a doorbell: it says there is
   * a message and links to it, and carries none of the body. When it does NOT land —
   * no project on the thread, no service key — the email keeps the full text, because
   * the alternative is a notification pointing at a message that does not exist.
   */
  const filing = await fileIntoProjectChat(to, str(body.plainText) || html, body);

  // A replayed event has already been filed AND already produced its doorbell email.
  // Stop here: sending again is the very duplicate 085 exists to prevent, and the
  // 200 tells GHL the delivery is complete so it stops retrying.
  if (filing.duplicate) {
    res.status(200).json({ ok: true, duplicate: true, projectId: filing.projectId ?? null, conversationId: filing.conversationId ?? null });
    return;
  }

  const base       = siteUrl(req);
  const threadLink = filing.projectId ? `${base}/projects/${filing.projectId}` : base;

  const notifyHtml =
    '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
    + '<tr><td style="padding:24px 28px;">'
    + '<p style="margin:0 0 10px;font-size:17px;font-weight:700;color:#0a0a0a;">You have a new message</p>'
    + '<p style="margin:0;font-size:13px;line-height:1.7;color:#4a4a48;">'
    + 'There is a new message on your project in Groundwork. Open the project to read it and reply.</p>'
    + `<p style="margin:22px 0 0;"><a href="${threadLink}" `
    + 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the conversation</a></p>'
    + '<p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">'
    + 'Replies are kept in Groundwork so the whole conversation stays with the project.</p>'
    + '</td></tr></table></body></html>';

  const sendSubject = filing.filed ? 'You have a new message' : subject;
  const sendHtml    = filing.filed ? notifyHtml : html;
  const sendText    = filing.filed ? undefined  : text;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: sendSubject,
        html: sendHtml,
        ...(sendText ? { text: sendText } : {}),
        // Only on the full-text path. A notification has nothing to copy anyone on, and
        // a Reply-To would invite exactly the off-platform answer this avoids.
        ...(!filing.filed && cc.length ? { cc } : {}),
        ...(!filing.filed && bcc.length ? { bcc } : {}),
        ...(!filing.filed && replyTo ? { reply_to: replyTo } : {}),
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
    res.status(200).json({
      ok: true,
      messageId: sent.id ?? null,
      filedToChat: filing.reason,
      // Which of the two emails went out, so the delivery log says why.
      emailKind: filing.filed ? 'notification' : 'full_text',
    });
  } catch (err) {
    console.error('[ghl-delivery] could not reach Resend:', err);
    res.status(502).json({ error: 'Could not reach the email service' });
  }
}
