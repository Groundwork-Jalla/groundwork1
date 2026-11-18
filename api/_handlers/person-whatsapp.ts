import { resolveOrEstablishWhatsApp } from '../_lib/whatsapp-thread.js';

/**
 * "Message this person on WhatsApp" — any account, with or without a project (18 Nov).
 *
 * The WhatsApp CRM's New chat offers three ways to choose someone: through a project (the
 * `project-whatsapp` action), from the contractors, or from every user who signed up. The
 * last two land here. Outreach to people who have signed up but not started a build is the
 * point: they have no project to go through.
 *
 * Nothing new is decided here. A conversation already belongs to the PERSON (091), and
 * `resolveOrEstablishWhatsApp` is the one place that finds their thread or opens it through
 * the provider — the same call `project-whatsapp` makes once it has worked out who. This
 * handler only proves the caller is an admin and that the person exists.
 *
 * It refuses rather than pretends, exactly as the project path does: no phone, an unusable
 * phone, a CRM that will not create the contact, a provider that will not open the thread —
 * each answers with its own reason and creates nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const personId = typeof req.body?.personId === 'string' ? req.body.personId : '';
  if (!UUID.test(personId)) {
    res.status(400).json({ error: 'personId is required' });
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

  // Admin is proved with the caller's own token before the service-role client exists.
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
  const { data: profile, error: profileErr } = await svc.from('profiles').select('id').eq('id', personId).maybeSingle();
  if (profileErr || !profile) {
    res.status(404).json({ error: 'No such person' });
    return;
  }

  const thread = await resolveOrEstablishWhatsApp(svc, personId);
  if (!thread.ok) {
    res.status(200).json({ ok: false, reason: thread.reason,
      ...(thread.conversationIds ? { conversationIds: thread.conversationIds } : {}),
      ...(thread.detail ? { detail: thread.detail } : {}) });
    return;
  }
  res.status(200).json({ ok: true, conversationId: thread.conversationId, created: thread.created });
}
