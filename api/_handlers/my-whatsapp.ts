import { resolveOrEstablishWhatsApp } from '../_lib/whatsapp-thread.js';

/**
 * "My own WhatsApp thread" — establish it if it does not exist, and hand back its id.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * Reported from testing: a contractor sees a WhatsApp tab in Messages and the CLIENT sees
 * only Groundwork. Not a rendering difference — the client had no WhatsApp thread to show.
 * A `whatsapp` conversation row was only ever created by three things: an admin pressing
 * the WhatsApp button, a message arriving FROM that person's phone, or 126's fan-out. The
 * contractor had been messaged by an admin at some point; nothing had ever happened to the
 * client, so there was nothing to list.
 *
 * Waiting for one of those three is the wrong answer. Whether somebody can see the channel
 * that reaches their own phone should not depend on a member of staff having clicked
 * something, or on a message having already been sent to them.
 *
 * ── Why it is safe without an admin check ────────────────────────────────────────────
 * It takes NO person parameter. The subject is `auth.getUser()` on the caller's own token
 * and nothing else, so the only thread anybody can ask for is their own — there is no
 * argument to tamper with. That is the whole security property, and it is why this is a
 * separate endpoint rather than `project-whatsapp` with its admin check relaxed: that one
 * takes a `recipient` and a `personId`, and loosening it would let any signed-in user
 * open a thread with somebody else.
 *
 * It still needs the server: the browser may not hold the GoHighLevel token, and 091
 * writes conversations through privileged paths only.
 *
 * ── It refuses rather than pretends ──────────────────────────────────────────────────
 * No phone on file is the ordinary case and answers `no_phone`, creating nothing. The
 * caller shows no WhatsApp tab, which is honest: we cannot reach them there.
 */
export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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

  // The subject of this request, decided by the token and never by the body.
  const { data: me, error: whoErr } = await asCaller.auth.getUser();
  const personId = me?.user?.id;
  if (whoErr || !personId) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const thread = await resolveOrEstablishWhatsApp(svc, personId);

  if (!thread.ok) {
    // 200 with a reason, not an error status: "you have no number on file" is a normal
    // answer to this question and must not surface as a broken page.
    res.status(200).json({ ok: false, reason: thread.reason });
    return;
  }
  res.status(200).json({ ok: true, conversationId: thread.conversationId, created: thread.created });
}
