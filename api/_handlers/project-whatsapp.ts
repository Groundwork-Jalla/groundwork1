import { ghlConfig, ensureConversation, upsertContact } from '../ghl/_client.js';
import { normalisePhone } from '../ghl/_phone.js';
import { accessToken } from '../ghl/_oauth.js';
import { resolveWhatsAppThread, isDeliverablePhone, type WhatsAppRow } from '../../src/lib/admin/whatsapp-shortcut.js';

/**
 * "Message this project's client on WhatsApp" — resolve the thread, establish it if there
 * is none, and hand back its id for the Inbox to open.
 *
 * ── One client, one chat ─────────────────────────────────────────────────────────────
 * The conversation belongs to the PERSON. The project is only where the admin happened
 * to click, so this endpoint never writes `conversations.project_id` — not to set it, not
 * to move it. A thread already linked to another project is opened as it is. Linking a
 * thread to a project remains the separate, explicit act it already was
 * (`link_conversation`, 091).
 *
 * ── Why it is a server handler ───────────────────────────────────────────────────────
 * It talks to GoHighLevel, which the browser may never do: the API token lives on the
 * server and 091 writes conversations through privileged paths only. Admin is proved with
 * the caller's own token before the service-role client exists.
 *
 * ── It refuses rather than pretends ──────────────────────────────────────────────────
 * No phone, an unusable phone, a CRM that will not create the contact, a provider that
 * will not open the thread — each answers with its own reason and creates nothing. A
 * conversation row that exists but cannot carry a message is worse than no row: it looks
 * like a working chat.
 */

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Who the client is. `projects.user_id` and nothing else ─────────────────────────
  // Never a name, never a contractor or verifier on the project, never the conversation
  // store looked at the other way round.
  const { data: project, error: projErr } = await svc
    .from('projects').select('id, user_id').eq('id', projectId).maybeSingle();
  if (projErr || !project) {
    res.status(404).json({ error: 'No such project' });
    return;
  }
  const personId = (project.user_id as string | null) ?? null;
  if (!personId) {
    res.status(200).json({ ok: false, reason: 'no_client' });
    return;
  }

  const { data: profile } = await svc
    .from('profiles').select('id, email, full_name, phone, country, ghl_contact_id')
    .eq('id', personId).maybeSingle();

  // ── Is there already a chat with this person? ──────────────────────────────────────
  const { data: convRows, error: convErr } = await svc
    .from('conversations')
    .select('id, person_id, project_id, channel, ghl_conversation_id, ghl_contact_id, last_message_at, created_at')
    .eq('person_id', personId).eq('channel', 'whatsapp');
  if (convErr) {
    res.status(200).json({ ok: false, reason: 'conversations_unavailable' });
    return;
  }

  const rows: WhatsAppRow[] = ((convRows ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    personId: (r.person_id as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    channel: String(r.channel ?? ''),
    ghlConversationId: (r.ghl_conversation_id as string | null) ?? null,
    ghlContactId: (r.ghl_contact_id as string | null) ?? null,
    lastMessageAt: (r.last_message_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }));

  const resolved = resolveWhatsAppThread(rows, personId);
  if (resolved.kind === 'found') {
    // Opened exactly as it is. project_id is not read, not compared and not written.
    res.status(200).json({ ok: true, conversationId: resolved.conversationId, created: false });
    return;
  }
  if (resolved.kind === 'ambiguous') {
    // Two provider threads for one person is a data problem, not something to resolve by
    // picking one — and certainly not by adding a third.
    res.status(200).json({ ok: false, reason: 'ambiguous', conversationIds: resolved.conversationIds });
    return;
  }

  // ── Nothing yet: establish the one chat, through the provider ──────────────────────
  const phone = normalisePhone((profile?.phone as string | null) ?? null, (profile?.country as string | null) ?? null);
  const hasContact = !!(profile?.ghl_contact_id);
  if (!hasContact && !isDeliverablePhone(phone)) {
    // Without a contact we must create one, and a contact needs a number WhatsApp can
    // reach. `normalisePhone` hands back whatever it was given when it cannot place it,
    // so "it returned something" is not the same as "this is a phone number".
    res.status(200).json({ ok: false, reason: 'no_phone' });
    return;
  }

  const cfg = await ghlConfig();
  if (!cfg) {
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }

  let contactId = (profile?.ghl_contact_id as string | null) ?? null;
  if (!contactId) {
    const made = await upsertContact(cfg, {
      email: (profile?.email as string | null) ?? undefined,
      name: (profile?.full_name as string | null) ?? undefined,
      phone: phone ?? undefined,
      country: (profile?.country as string | null) ?? undefined,
      source: 'groundwork_project_whatsapp',
    } as never);
    if (!made.ok || !made.data?.contactId) {
      console.error('[project-whatsapp] the CRM would not resolve a contact', made.ok ? 'no id' : made.error);
      res.status(200).json({ ok: false, reason: 'contact_failed', detail: made.ok ? 'no_contact_id' : made.error });
      return;
    }
    contactId = made.data.contactId;
    // Learn it, so the next call — and every other part of the product — skips this.
    await svc.from('profiles').update({ ghl_contact_id: contactId }).eq('id', personId).is('ghl_contact_id', null);
  }

  const bearer = (await accessToken()) ?? undefined;
  const ghlConversationId = await ensureConversation(cfg, contactId, bearer);
  if (!ghlConversationId) {
    // No local row. A conversation that cannot carry a message is worse than none: it
    // looks like a working chat and silently drops what is typed into it.
    res.status(200).json({ ok: false, reason: 'provider_failed' });
    return;
  }

  // Another row may already hold this provider thread — a race, or a row whose person
  // differs. The unique index is the authority: on conflict, read back the row that owns
  // it and use that. Nothing is ever overwritten to win a collision.
  const { data: inserted, error: insErr } = await svc.from('conversations')
    .insert({ person_id: personId, channel: 'whatsapp', ghl_contact_id: contactId, ghl_conversation_id: ghlConversationId })
    .select('id').single();

  if (insErr) {
    const { data: owner } = await svc.from('conversations')
      .select('id').eq('ghl_conversation_id', ghlConversationId).maybeSingle();
    if (owner?.id) {
      res.status(200).json({ ok: true, conversationId: String(owner.id), created: false });
      return;
    }
    console.error('[project-whatsapp] could not record the conversation:', insErr.message);
    res.status(200).json({ ok: false, reason: 'record_failed' });
    return;
  }

  res.status(200).json({ ok: true, conversationId: String(inserted.id), created: true });
}
