/**
 * Welcome a waitlist signup, with the community link.
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

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';

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
    await import('../src/lib/email/waitlist-welcome-html');

  const lang: 'en' | 'fr' = row.lang === 'fr' ? 'fr' : 'en';
  const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 80) : '';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [row.email],
        subject: waitlistWelcomeSubject(lang),
        html: buildWaitlistWelcomeHtml(lang, name),
      }),
    });
    if (!r.ok) {
      console.error('[waitlist-welcome] Resend rejected:', r.status, await r.text().catch(() => ''));
      res.status(502).json({ error: 'Could not send the email' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[waitlist-welcome] Resend unreachable:', err);
    res.status(502).json({ error: 'Could not send the email' });
  }
}
