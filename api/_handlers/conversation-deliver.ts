import { ghlConfig, sendWhatsAppMessage } from '../ghl/_client.js';
import { accessToken } from '../ghl/_oauth.js';

/**
 * Deliver a staff reply to the client, through whatever carries that channel today.
 *
 * ── The seam ─────────────────────────────────────────────────────────────────────────
 * The Inbox does not know who delivers a message. It writes the message through 091 and
 * asks for delivery; this decides the provider from the conversation's CHANNEL:
 *
 *     whatsapp → GoHighLevel            (today; Meta's Cloud API later)
 *     email    → crm-delivery / Resend   (already its own path)
 *     jalla    → nothing to carry: the client reads it in Groundwork
 *
 * That table is the whole coupling. Replacing GoHighLevel for WhatsApp is a change to
 * one arm of it, not to the Inbox, the composer, `send_message`, or the stored message —
 * which is the point: the provider is an implementation detail of the transport, and the
 * conversation is ours. `ghl_message_id` is today's provider message id; a second
 * provider gets its own column rather than overloading that one.
 *
 * ── Why a server action ──────────────────────────────────────────────────────────────
 * `send_message` (091) has already written the row when this is called: the message
 * exists, in the thread, whatever happens next. This only carries it to WhatsApp and
 * records what GHL answered. So a failure here is a *delivery* failure on a message that
 * is still real in Groundwork — never a lost message, and never a silent one: the row is
 * marked `failed` and the caller is told, rather than the UI implying it was sent.
 *
 * ── What it refuses ──────────────────────────────────────────────────────────────────
 *   not an outbound message   an internal note NEVER leaves Groundwork; inbound is theirs
 *   not a whatsapp thread     email and platform threads have their own paths
 *   already carries a GHL id  it was delivered; a retry would send it twice
 *   no contact id             we do not know whose phone this is; nothing is invented
 *
 * Admin-only, on the caller's own token: the browser proves who it is, the service role
 * does the writing.
 */

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : '';
  if (!messageId) {
    res.status(400).json({ error: 'messageId is required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: message, error: msgErr } = await svc
    .from('project_messages')
    .select('id, conversation_id, content, direction, channel, ghl_message_id, status')
    .eq('id', messageId)
    .maybeSingle();
  if (msgErr || !message) {
    res.status(404).json({ error: 'No such message' });
    return;
  }
  if (message.direction !== 'outbound') {
    // An internal note is a note. This is the guarantee the composer's two buttons rest on.
    res.status(200).json({ ok: false, reason: 'not_outbound' });
    return;
  }
  if (message.ghl_message_id) {
    // Already carried. Saying "delivered" again is honest; sending again is not.
    res.status(200).json({ ok: true, alreadyDelivered: true, providerMessageId: message.ghl_message_id });
    return;
  }

  const { data: conversation, error: convErr } = await svc
    .from('conversations')
    .select('id, channel, person_id, ghl_conversation_id, ghl_contact_id')
    .eq('id', message.conversation_id)
    .maybeSingle();
  if (convErr || !conversation) {
    res.status(404).json({ error: 'No such conversation' });
    return;
  }
  // ── channel → provider ─────────────────────────────────────────────────────────────
  // One table, and the only place that knows who carries what.
  const PROVIDER_FOR: Record<string, 'ghl' | null> = { whatsapp: 'ghl', email: null, call: null, jalla: null };
  const provider = PROVIDER_FOR[String(conversation.channel)] ?? null;
  if (!provider) {
    // Not an error: a platform message needs no carrying, and email has its own path.
    res.status(200).json({ ok: false, reason: 'not_deliverable', channel: conversation.channel });
    return;
  }

  // Whose phone. The thread's contact first; the person's profile as the fallback for a
  // thread opened before the contact id was learnt.
  let contactId = (conversation.ghl_contact_id as string | null) ?? null;
  if (!contactId && conversation.person_id) {
    const { data: profile } = await svc.from('profiles').select('ghl_contact_id').eq('id', conversation.person_id).maybeSingle();
    contactId = (profile?.ghl_contact_id as string | null) ?? null;
  }
  if (!contactId) {
    await svc.from('project_messages').update({ status: 'failed' }).eq('id', messageId);
    res.status(200).json({ ok: false, reason: 'no_contact' });
    return;
  }

  const cfg = await ghlConfig();
  if (!cfg) {
    await svc.from('project_messages').update({ status: 'failed' }).eq('id', messageId);
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }

  // The Marketplace app's token where we have one (the conversations scopes live on the
  // app, not the PIT); the PIT is the fallback and may well be refused — which is
  // reported rather than hidden.
  const bearer = (await accessToken()) ?? undefined;
  const sent = await sendWhatsAppMessage(cfg, {
    contactId,
    conversationId: (conversation.ghl_conversation_id as string | null) ?? null,
    body: String(message.content ?? ''),
  }, bearer);

  if (!sent.ok) {
    await svc.from('project_messages').update({ status: 'failed' }).eq('id', messageId);
    console.error('[conversation-deliver] the provider refused the send', provider, sent.status, sent.error);
    res.status(200).json({ ok: false, reason: 'provider_rejected', provider, status: sent.status, detail: sent.error });
    return;
  }

  // Delivered. The GHL id is what makes a retry a no-op and what ties our row to theirs.
  const ghlMessageId = sent.data?.messageId ?? null;
  const { error: stampErr } = await svc.from('project_messages').update({
    status: 'sent',
    ...(ghlMessageId ? { ghl_message_id: ghlMessageId, ghl_synced_at: new Date().toISOString() } : {}),
  }).eq('id', messageId);
  if (stampErr) console.warn('[conversation-deliver] sent but not stamped:', stampErr.message);

  // Learn the thread id if this is the first message we ever sent on it.
  if (!conversation.ghl_conversation_id && sent.data?.conversationId) {
    await svc.from('conversations').update({ ghl_conversation_id: sent.data.conversationId })
      .eq('id', conversation.id).is('ghl_conversation_id', null);
  }

  res.status(200).json({ ok: true, provider, providerMessageId: ghlMessageId, stamped: !stampErr });
}
