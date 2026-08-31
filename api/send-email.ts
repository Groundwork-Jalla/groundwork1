// Vercel Serverless Function — sends transactional email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.
import { logEmailToCrm } from './ghl/_email-log.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // This endpoint takes `to`, `subject` and `html` straight from the caller, so without
  // a check it is an open relay on noreply@mail.tryjalla.com — anyone could send mail
  // that looks like it came from us. A valid session is now required. The contractor
  // application form used to be the one anonymous caller; it goes through
  // /api/contractor-application-notify instead, which derives its recipients from the
  // database rather than the request.
  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey     = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('[email] Supabase env missing — cannot verify caller');
    return res.status(500).json({ error: 'Server is not configured' });
  }
  const { createClient } = await import('@supabase/supabase-js');
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // `getUser` may not be present on the typed `SupabaseAuthClient` in some
  // versions; use a runtime call with an `any` assertion to keep TypeScript
  // happy while preserving runtime behaviour.
  const getUserRes = await (caller.auth as any).getUser();
  const { data: { user } = { user: null }, error: authErr } = getUserRes ?? {};
  if (authErr || !user) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  const { to, subject, html } = req.body ?? {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
      to: [to],
      subject,
      html,
    }),
  });

  const data = await r.json().catch(() => ({}));

  if (r.ok) {
    // Onto the recipient's GHL contact. This endpoint is the generic one — it does not
    // know what it just sent — so the note carries the subject and body and a neutral
    // label rather than pretending to a category it cannot determine.
    void logEmailToCrm({ to, subject, html, kind: 'other' });
    return res.status(200).json({ success: true });
  }
  return res.status(500).json({ error: 'Resend API error', details: data });
}
