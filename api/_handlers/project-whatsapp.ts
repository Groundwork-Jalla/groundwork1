import { resolveOrEstablishWhatsApp } from '../_lib/whatsapp-thread.js';
import { resolveRecipient,
         type RecipientRole, type RecipientContractor, type RecipientVerifier } from '../../src/lib/admin/whatsapp-shortcut.js';

/**
 * "Message someone on this project on WhatsApp" — resolve the thread, establish it if there
 * is none, and hand back its id for the Inbox to open.
 *
 * ── Three kinds of person, one mechanism ─────────────────────────────────────────────
 * `recipient` is `client` (the default, and the original behaviour), `contractor` or
 * `verifier`. Nothing below the resolution changes for any of them, because a conversation
 * is keyed on the PERSON (091) and never on a role — so widening this was a question of
 * deciding WHO, not of a second code path.
 *
 * A role held by several people is not resolved here: `contractor` falls back to the primary
 * (101), since that is already the project's designated point of contact, but two verifiers
 * of different disciplines are two different people doing two different checks, and picking
 * one would send a project's details to whichever sorted first. That answers `choose_person`
 * with the candidates and lets the admin say.
 *
 * ── One person, one chat ─────────────────────────────────────────────────────────────
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

  // ── Who on this project is being messaged ──────────────────────────────────────────
  // `client` keeps the original behaviour and is the default, so every existing caller is
  // unchanged. `contractor` and `verifier` resolve through the project's assignments — the
  // conversation store is still keyed on the PERSON (091), so nothing downstream changes.
  const role: RecipientRole =
    req.body?.recipient === 'contractor' ? 'contractor'
    : req.body?.recipient === 'verifier' ? 'verifier'
    : 'client';
  const askedFor = typeof req.body?.personId === 'string' ? req.body.personId : null;

  const { data: project, error: projErr } = await svc
    .from('projects').select('id, user_id').eq('id', projectId).maybeSingle();
  if (projErr || !project) {
    res.status(404).json({ error: 'No such project' });
    return;
  }

  // Only what the chosen role needs. A client-only call does not read the assignment tables.
  let contractors: RecipientContractor[] = [];
  let verifiers: RecipientVerifier[] = [];
  if (role === 'contractor') {
    const { data } = await svc.from('contractor_invites')
      .select('contractor_user_id, is_primary')
      .eq('project_id', projectId).eq('status', 'accepted');
    contractors = ((data ?? []) as Record<string, unknown>[])
      .filter(r => r.contractor_user_id)
      .map(r => ({ userId: String(r.contractor_user_id), isPrimary: r.is_primary === true }));
  }
  if (role === 'verifier') {
    const { data } = await svc.from('project_verifiers')
      .select('user_id, discipline')
      .eq('project_id', projectId).eq('status', 'active');
    verifiers = ((data ?? []) as Record<string, unknown>[])
      .map(r => ({ userId: String(r.user_id), discipline: String(r.discipline ?? '') }));
  }

  const who = resolveRecipient(role, {
    clientId: (project.user_id as string | null) ?? null,
    contractors, verifiers,
  }, askedFor);

  if (who.kind === 'none') {
    // One reason code per role, so the admin is told who is missing rather than "no client"
    // for a project that has one.
    res.status(200).json({ ok: false, reason: role === 'client' ? 'no_client'
      : role === 'contractor' ? 'no_contractor' : 'no_verifier' });
    return;
  }
  if (who.kind === 'choose') {
    // Several people hold that role. Picking one here would send a project's details to
    // whichever happened to sort first.
    res.status(200).json({ ok: false, reason: 'choose_person', candidates: who.candidates, role: who.role });
    return;
  }
  const personId = who.personId;

  // The thread itself — resolved, or established through the provider. Shared with the
  // message fan-out, which reaches several people in one request: "one person, one chat"
  // is a rule, and two implementations of it drift into two chats for one person.
  const thread = await resolveOrEstablishWhatsApp(svc, personId);
  if (!thread.ok) {
    res.status(200).json({ ok: false, reason: thread.reason,
      ...(thread.conversationIds ? { conversationIds: thread.conversationIds } : {}),
      ...(thread.detail ? { detail: thread.detail } : {}) });
    return;
  }
  res.status(200).json({ ok: true, conversationId: thread.conversationId, created: thread.created });
}
