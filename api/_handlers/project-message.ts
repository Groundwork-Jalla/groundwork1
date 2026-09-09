import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { ghlConfig, ghlSettingValue } from '../ghl/_client.js';
import { addConversationMessage, upsertContact } from '../ghl/_client.js';
import { accessToken } from '../ghl/_oauth.js';

/**
 * Groundwork chat → the owner's GoHighLevel thread.
 *
 * ── Why the mirror exists ────────────────────────────────────────────────────────────
 * `project_messages` and the GHL conversation provider were two finished systems that
 * had never been introduced. Chat was platform-only; the team could not see it, could
 * not follow it up, and had no way to answer from the inbox they actually work in.
 *
 * ── Which thread ─────────────────────────────────────────────────────────────────────
 * The PROJECT OWNER'S. A GHL conversation is per contact, and a project has three kinds
 * of participant — owner, invited contractors, Jalla staff — of whom only the owner is
 * the customer the thread is about. So every message on a project lands on the owner's
 * thread, and everyone else's is `outbound` on it. Mirroring to the contractor's thread
 * as well would duplicate the conversation into two half-views of itself.
 *
 * `profiles.ghl_thread_project_id` is stamped on the way past, so a reply typed in GHL
 * knows which project it belongs to — see conversation-delivery.
 *
 * ── Failure is not an error here ─────────────────────────────────────────────────────
 * The message is already in the database and already on the recipient's screen; the
 * mirror is bookkeeping. A failure leaves `ghl_message_id` null, which is exactly the
 * backlog the partial index in migration 077 was built to answer, so a reconcile can
 * pick it up later. Never surface it to the person who just sent a message.
 */
export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { messageId } = req.body ?? {};
  if (typeof messageId !== 'string' || !messageId) {
    res.status(400).json({ error: 'messageId is required' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[chat-mirror] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: msg } = await admin
    .from('project_messages')
    .select('id, project_id, sender_id, sender_name, content, created_at, origin, ghl_message_id')
    .eq('id', messageId)
    .maybeSingle();

  if (!msg) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  // Idempotent. A double-click, a re-render, a retry — all collapse to the first mirror
  // rather than posting the same sentence to the thread twice.
  if (msg.ghl_message_id) {
    res.status(200).json({ ok: true, alreadyMirrored: true });
    return;
  }

  // The echo guard, restated where it is enforced. A row that came FROM GoHighLevel must
  // never go back to it; migration 077 stops the browser setting this, and this stops the
  // handler ignoring it.
  if (msg.origin !== 'platform') {
    res.status(200).json({ ok: true, skipped: 'not_ours' });
    return;
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, name, user_id')
    .eq('id', msg.project_id)
    .maybeSingle();

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // The caller has to be on the project — its owner, or the person who wrote the line.
  // Not a security boundary in the usual sense (the worst a stranger could do is push a
  // message onto the thread it already belongs to) but there is no reason to allow it.
  if (project.user_id !== user.id && msg.sender_id !== user.id) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  const { data: owner } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', project.user_id)
    .maybeSingle();

  if (!owner?.email) {
    res.status(200).json({ ok: false, reason: 'owner_has_no_email' });
    return;
  }

  const cfg = await ghlConfig();
  const providerId = await ghlSettingValue('GHL_CONVERSATION_PROVIDER_ID');
  if (!cfg || !providerId) {
    res.status(200).json({ ok: false, reason: 'crm_not_configured' });
    return;
  }

  try {
    const bearer = await accessToken();

    const contact = await upsertContact(cfg, {
      email: owner.email,
      name:  owner.full_name ?? null,
    });
    if (!contact.ok || !contact.data?.contactId) {
      res.status(200).json({ ok: false, reason: 'no_contact' });
      return;
    }
    const contactId = contact.data.contactId;

    const posted = await addConversationMessage(cfg, providerId, {
      contactId,
      body:       msg.content,
      senderName: msg.sender_name,
      // Only the owner is the contact. Everything from a contractor or from Jalla is us
      // talking to them, whatever the chat UI shows.
      direction:  msg.sender_id === project.user_id ? 'inbound' : 'outbound',
      sentAt:     msg.created_at ? new Date(msg.created_at) : undefined,
    }, bearer ?? undefined);

    if (!posted.ok) {
      console.error('[chat-mirror] GHL rejected the message:', posted.status, posted.error);
      res.status(200).json({ ok: false, reason: 'ghl_rejected', status: posted.status });
      return;
    }

    await admin
      .from('project_messages')
      .update({
        ghl_message_id: posted.data?.messageId ?? 'sent',
        ghl_synced_at:  new Date().toISOString(),
      })
      .eq('id', msg.id);

    // Which project this thread is currently about, so a reply lands in the right chat.
    await admin
      .from('profiles')
      .update({ ghl_thread_project_id: project.id })
      .eq('id', owner.id);

    res.status(200).json({ ok: true, messageId: posted.data?.messageId });
  } catch (e) {
    console.error('[chat-mirror] failed:', e);
    // Still a 200: the message is sent and delivered, only the CRM copy is missing, and
    // the caller is a chat box that has nothing useful to do with a failure.
    res.status(200).json({ ok: false, reason: 'exception' });
  }
}
