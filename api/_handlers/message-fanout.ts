import { ghlConfig, sendWhatsAppMessage } from '../ghl/_client.js';
import { accessToken } from '../ghl/_oauth.js';
import { resolveOrEstablishWhatsApp } from '../_lib/whatsapp-thread.js';
import { siteLink } from '../../src/lib/site-url.js';
import { composeWhatsAppBody } from '../../src/lib/admin/whatsapp-body.js';

/**
 * Carry a project message to the other participants' WhatsApp.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────────────
 * Reported from testing: a client has a real WhatsApp number, their contractor writes to
 * them in Groundwork, and the phone stays silent. `sendWhatsAppMessage` was reachable
 * only from the admin Inbox, on a `whatsapp` thread, for an `outbound` message — and a
 * contractor and a client on the project's own thread are none of those three.
 *
 * ── Who hears about it ───────────────────────────────────────────────────────────────
 * `project_participants` (123) decides, which is the same set that gets the bell and the
 * email, minus the person who wrote it. One definition of "everybody on this project", so
 * the phone and the inbox cannot disagree about who was told.
 *
 * ── Every recipient is independent ───────────────────────────────────────────────────
 * One person with no phone number must not cost the others their message, so each is
 * resolved, sent and recorded on its own and a failure is written down rather than
 * thrown. The endpoint answers 200 with a per-recipient breakdown — the caller is a
 * database trigger, and a non-200 would only produce a retry that the ledger refuses.
 *
 * ── It is called by the database, not the browser ────────────────────────────────────
 * 126 posts here with the shared secret. The browser never reaches it: it carries no
 * GoHighLevel token, and a page that closed before its fetch left would be a message
 * that silently never arrived.
 */

function secretMatches(bearer: string): boolean {
  const candidates = [
    process.env.MESSAGE_FANOUT_SECRET?.trim(),
    process.env.AGENT_DISPATCH_SECRET?.trim(),
  ].filter((s): s is string => !!s);
  // No secret configured must never mean "everybody is authorised".
  return candidates.length > 0 && candidates.includes(bearer);
}

export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '').trim();
  if (!secretMatches(bearer)) {
    res.status(401).json({ error: 'Unauthorized' });
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
  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: message } = await svc.from('project_messages')
    .select('id, project_id, sender_id, sender_name, content, direction, channel, attachments')
    .eq('id', messageId).maybeSingle();
  if (!message) {
    res.status(404).json({ error: 'No such message' });
    return;
  }

  // The same three guards as the trigger, restated here rather than trusted. This
  // endpoint is reachable with the secret alone, and an internal note on a client's
  // phone is not a bug anybody could take back.
  if (message.direction === 'internal') {
    res.status(200).json({ ok: false, reason: 'internal_never_leaves' });
    return;
  }
  if (!message.project_id || (message.channel ?? 'jalla') !== 'jalla') {
    res.status(200).json({ ok: false, reason: 'not_a_project_thread' });
    return;
  }

  const { data: project } = await svc.from('projects')
    .select('id, name').eq('id', message.project_id).maybeSingle();

  const { data: people } = await svc.rpc('project_participants', { p_project: message.project_id });
  const participants = ((people ?? []) as Record<string, unknown>[])
    .map(r => ({ userId: String(r.user_id), role: String(r.role ?? '') }))
    .filter(p => p.userId && p.userId !== message.sender_id);

  // Staff are not participants, so a sender who is not in the list wrote as Jalla.
  const senderRole = ((people ?? []) as Record<string, unknown>[])
    .find(r => String(r.user_id) === String(message.sender_id));
  const role = senderRole ? String(senderRole.role ?? 'staff') : 'staff';

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const cfg = await ghlConfig();
  const bearerToken = cfg ? ((await accessToken()) ?? undefined) : undefined;

  const results: { recipient: string; status: string; reason?: string }[] = [];

  for (const person of participants) {
    // ── Claim the send before making it ───────────────────────────────────────────
    // The unique index (126) is what stops a duplicate: whoever inserts the row owns the
    // send, and a second caller — a retried trigger, a reconcile — finds it taken and
    // leaves it alone rather than sending the message twice.
    const { error: claimErr } = await svc.from('message_deliveries').insert({
      message_id: messageId, recipient_id: person.userId, channel: 'whatsapp', status: 'pending',
    });
    if (claimErr) {
      // 23505: already claimed. Any other error means we could not record the attempt,
      // and an unrecorded send is one nobody can tell happened — so we do not make it.
      results.push({ recipient: person.userId,
        status: claimErr.code === '23505' ? 'already' : 'not_recorded', reason: claimErr.code });
      continue;
    }

    const finish = async (status: string, reason?: string, providerId?: string) => {
      await svc.from('message_deliveries')
        .update({ status, reason: reason ?? null, provider_message_id: providerId ?? null,
                  updated_at: new Date().toISOString() })
        .eq('message_id', messageId).eq('recipient_id', person.userId).eq('channel', 'whatsapp');
      results.push({ recipient: person.userId, status, ...(reason ? { reason } : {}) });
    };

    if (!cfg) { await finish('skipped', 'not_configured'); continue; }

    const thread = await resolveOrEstablishWhatsApp(svc, person.userId);
    if (!thread.ok) {
      // `no_phone` is the ordinary case, not a fault: plenty of people have not given us
      // one. It is recorded so "why did they not get it?" has an answer.
      await finish('skipped', thread.reason);
      continue;
    }
    if (!thread.contactId) { await finish('skipped', 'no_contact'); continue; }

    const { data: profile } = await svc.from('profiles')
      .select('preferred_lang').eq('id', person.userId).maybeSingle();

    const body = composeWhatsAppBody({
      senderName: String(message.sender_name ?? ''),
      senderRole: role,
      projectName: String(project?.name ?? ''),
      content: String(message.content ?? ''),
      hasAttachments: attachments.length > 0,
      lang: String(profile?.preferred_lang ?? 'en'),
      // Never hardcoded: a preview deployment that links to production mails testers
      // into live data, and `?tab=messages` is there because 125 established that a
      // link about a message opens the message, not the project overview.
      link: siteLink(`projects/${message.project_id}?tab=messages`),
    });

    const sent = await sendWhatsAppMessage(cfg,
      { contactId: thread.contactId, conversationId: thread.ghlConversationId, body }, bearerToken);

    if (!sent.ok) {
      console.error('[message-fanout] provider refused:', sent.error);
      await finish('failed', String(sent.error ?? 'provider_failed'));
      continue;
    }
    await finish('sent', undefined, sent.data?.messageId);
  }

  res.status(200).json({ ok: true, messageId, carried: results });
}
