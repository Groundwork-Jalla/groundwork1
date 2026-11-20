import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseAdmin } from '../_lib/stripe.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Public (signed-out) Live Chat API endpoint.
 *
 * Signed-in users talk directly to Supabase with RLS + Realtime; public website
 * visitors authenticate per-session using an opaque 32-byte token whose SHA-256
 * hash is stored on `live_chat_sessions.visitor_token_hash`. Internal staff notes
 * (`sender_type = 'internal'`) are strictly excluded from every public query.
 */
export async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.status(405).end();
    return;
  }

  try {
    const svc = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data, error } = await svc
        .from('live_chat_settings')
        .select('online, greeting_en, greeting_fr, away_message_en, away_message_fr')
        .eq('id', true)
        .maybeSingle();
      if (error && !['42P01', 'PGRST205'].includes(error.code ?? '')) {
        res.status(503).json({ error: 'live_chat_unavailable' });
        return;
      }
      res.status(200).json({
        online: data?.online ?? true,
        greetingEn: data?.greeting_en ?? 'Hi! How can we help with your build today?',
        greetingFr: data?.greeting_fr ?? 'Bonjour ! Comment pouvons-nous vous aider pour votre chantier ?',
        awayEn: data?.away_message_en ?? 'Our team is currently away. Leave your message and we will reply shortly.',
        awayFr: data?.away_message_fr ?? 'Notre équipe est momentanément absente. Laissez votre message et nous vous répondrons rapidement.',
      });
      return;
    }

    const body = req.body ?? {};
    const op = cleanString(body.operation, 32);

    if (op === 'start') {
      const name = cleanString(body.name, 120);
      const email = cleanString(body.email, 200).toLowerCase();
      const message = cleanString(body.message, 4000);
      const topic = cleanString(body.topic, 60) || null;
      const pagePath = cleanString(body.pagePath, 240) || '/';
      const lang = body.lang === 'fr' ? 'fr' : 'en';

      if (name.length < 2) { res.status(400).json({ error: 'name_required' }); return; }
      if (!EMAIL.test(email)) { res.status(400).json({ error: 'invalid_email' }); return; }
      if (!message) { res.status(400).json({ error: 'message_required' }); return; }

      const visitorToken = randomBytes(32).toString('hex');
      const tokenHash = hashToken(visitorToken);

      // Link to an existing Groundwork account if this visitor already has one
      let matchedUserId: string | null = null;
      const profileMatch = await svc
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
      if (!profileMatch.error && profileMatch.data?.id) {
        matchedUserId = profileMatch.data.id;
      }

      const created = await svc
        .from('live_chat_sessions')
        .insert({
          visitor_token_hash: tokenHash,
          user_id: matchedUserId,
          visitor_name: name,
          visitor_email: email,
          visitor_role: 'visitor',
          topic,
          page_path: pagePath,
          lang,
          status: 'waiting_on_us',
        })
        .select('id, status, visitor_name, visitor_email, topic, page_path, lang, last_message_at, unread_for_user')
        .single();

      if (created.error || !created.data) {
        res.status(503).json({ error: 'live_chat_start_failed' });
        return;
      }

      const insertedMsg = await svc
        .from('live_chat_messages')
        .insert({
          session_id: created.data.id,
          sender_type: 'user',
          sender_name: name,
          body: message,
        })
        .select('id, session_id, sender_type, sender_name, body, created_at')
        .single();

      if (insertedMsg.error || !insertedMsg.data) {
        res.status(503).json({ error: 'live_chat_send_failed' });
        return;
      }

      res.status(200).json({
        ok: true,
        sessionId: created.data.id,
        visitorToken,
        session: created.data,
        messages: [insertedMsg.data],
      });
      return;
    }

    if (op === 'poll' || op === 'send') {
      const sessionId = cleanString(body.sessionId, 64);
      const visitorToken = cleanString(body.visitorToken, 128);
      if (!UUID.test(sessionId) || visitorToken.length < 32) {
        res.status(401).json({ error: 'invalid_session' });
        return;
      }
      const tokenHash = hashToken(visitorToken);
      const sessRes = await svc
        .from('live_chat_sessions')
        .select('id, status, visitor_name, visitor_email, topic, page_path, lang, last_message_at, unread_for_user')
        .eq('id', sessionId)
        .eq('visitor_token_hash', tokenHash)
        .maybeSingle();

      if (sessRes.error || !sessRes.data) {
        res.status(401).json({ error: 'invalid_session' });
        return;
      }

      if (op === 'send') {
        const message = cleanString(body.message, 4000);
        if (!message) { res.status(400).json({ error: 'message_required' }); return; }

        // Basic per-session rate guard: max 20 messages per minute
        const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
        const recent = await svc
          .from('live_chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', sessionId)
          .eq('sender_type', 'user')
          .gte('created_at', oneMinAgo);
        if ((recent.count ?? 0) >= 20) {
          res.status(429).json({ error: 'rate_limited' });
          return;
        }

        const inserted = await svc
          .from('live_chat_messages')
          .insert({
            session_id: sessionId,
            sender_type: 'user',
            sender_name: sessRes.data.visitor_name || 'Visitor',
            body: message,
          })
          .select('id, session_id, sender_type, sender_name, body, created_at')
          .single();

        if (inserted.error || !inserted.data) {
          res.status(503).json({ error: 'live_chat_send_failed' });
          return;
        }
        res.status(200).json({ ok: true, message: inserted.data });
        return;
      }

      // op === 'poll'
      const msgsRes = await svc
        .from('live_chat_messages')
        .select('id, session_id, sender_type, sender_name, body, created_at')
        .eq('session_id', sessionId)
        .neq('sender_type', 'internal')
        .order('created_at', { ascending: true })
        .limit(200);

      if (msgsRes.error) {
        res.status(503).json({ error: 'live_chat_poll_failed' });
        return;
      }

      if ((sessRes.data.unread_for_user ?? 0) > 0 && body.markRead === true) {
        await svc.from('live_chat_sessions').update({ unread_for_user: 0 }).eq('id', sessionId);
      }

      res.status(200).json({
        ok: true,
        session: sessRes.data,
        messages: msgsRes.data ?? [],
      });
      return;
    }

    res.status(400).json({ error: 'unknown_operation' });
  } catch {
    res.status(500).json({ error: 'live_chat_unavailable' });
  }
}
