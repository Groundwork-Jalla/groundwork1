/**
 * Two emails for one waitlist signup: the person's welcome, and an alert to the team
 * inbox so a signup is never something you only find by opening the admin panel.
 *
 * The community was only ever offered on the success screen, which people close. This
 * gives them somewhere to come back to.
 *
 * Callers are anonymous — someone joining a waitlist has no account — so this cannot sit
 * behind a session. It is bounded a different way: the address must already exist in
 * `waitlist_emails`, and the body is our own template. So it cannot be used to mail a
 * stranger; the worst it does is re-send a welcome to someone who really did sign up.
 * That is the same shape as /api/contractor-application-notify.
 */

import { siteUrl } from '../src/lib/site-url.js';

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';
const TEAM_INBOX = process.env.TEAM_INBOX ?? 'contact@tryjalla.com';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Internal alert. English only — it goes to the team, not the subscriber.
 *
 * Name and build location come from the request rather than the database: they live on
 * `waitlist_members`, which deliberately has no email column to join on. The address
 * itself is still verified against `waitlist_emails`, so the recipient cannot be forged;
 * these two are display-only, escaped, and length-capped.
 */
function teamAlertHtml(email: string, name: string, location: string, lang: string, siteUrl: string): string {
  const row = (label: string, value: string) => value
    ? `<tr>
         <td style="padding:5px 12px 5px 0;font-size:12px;color:#8a8a87;white-space:nowrap;">${esc(label)}</td>
         <td style="padding:5px 0;font-size:13px;color:#0a0a0a;">${esc(value)}</td>
       </tr>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
    <tr><td style="padding:22px 26px;border-bottom:1px solid #f0f0f0;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a8a87;">New waitlist signup</p>
      <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#0a0a0a;">${esc(name || email)}</p>
    </td></tr>
    <tr><td style="padding:18px 26px;">
      <table cellpadding="0" cellspacing="0" width="100%">
        ${row('Email', email)}
        ${row('Building in', location)}
        ${row('Language', lang.toUpperCase())}
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-top:20px;">
        <tr><td style="background:#0a0a0a;border-radius:9px;">
          <a href="${esc(siteUrl)}/admin/waitlist"
             style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:600;color:#fff;text-decoration:none;">
            View the waitlist
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const raw = req.body?.email;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !key || !apiKey) {
    console.error('[waitlist-welcome] missing SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // The gate. Only a real signup gets mail, and `lang` decides which language.
  const { data: row, error } = await svc
    .from('waitlist_emails')
    .select('email, lang')
    .eq('email', email)
    .maybeSingle();

  if (error || !row) {
    res.status(404).json({ error: 'Not on the waitlist' });
    return;
  }

  // The name lives on waitlist_members, which has no email column to join on — it is
  // deliberately the non-identifying half of the pair. A missing name is fine: the
  // template drops the greeting line rather than saying "Hi ,".
  const { buildWaitlistWelcomeHtml, waitlistWelcomeSubject } =
    await import('../src/lib/email/waitlist-welcome-html.js');

  const lang: 'en' | 'fr' = row.lang === 'fr' ? 'fr' : 'en';
  const name     = typeof req.body?.name === 'string'     ? req.body.name.slice(0, 80)     : '';
  const location = typeof req.body?.location === 'string' ? req.body.location.slice(0, 120) : '';
  const site     = siteUrl();

  async function send(to: string, subject: string, html: string) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text().catch(() => '')}`);
  }

  // Independent: a bounced welcome must not cost the team its alert, and vice versa.
  const results = await Promise.allSettled([
    send(row.email, waitlistWelcomeSubject(lang), buildWaitlistWelcomeHtml(lang, name)),
    send(TEAM_INBOX, `New waitlist signup — ${name || row.email}`,
         teamAlertHtml(row.email, name, location, lang, site)),
  ]);

  const welcome = results[0].status === 'fulfilled';
  const team    = results[1].status === 'fulfilled';
  if (!welcome) console.error('[waitlist-welcome] welcome failed:', (results[0] as any).reason);
  if (!team)    console.error('[waitlist-welcome] team alert failed:', (results[1] as any).reason);

  res.status(welcome || team ? 200 : 502).json({ ok: welcome && team, welcome, team });
}
