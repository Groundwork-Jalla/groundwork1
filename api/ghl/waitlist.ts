/**
 * Waitlist → GoHighLevel.
 *
 * Server-side proxy for a GHL inbound-webhook workflow. The webhook URL is the only
 * secret involved, and it stays on the server — anything named `VITE_*` is compiled into
 * the browser bundle, so a public URL would let anyone inject contacts into the CRM.
 *
 * This is a MIRROR, not the source of truth. The person is already recorded in Supabase
 * before this is called, and `waitlist_members` drives the live social-proof ticker on the
 * landing page. A failure here must never surface as a failed signup.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Flag the waitlist row as forwarded, so `WHERE NOT synced_to_ghl` can find anything that
 * missed the CRM during an outage. Never throws — the lead is already in GHL by the time
 * this runs, and losing the bookkeeping is not worth failing the request over.
 */
async function markSynced(email: string): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      .from('waitlist_emails')
      .update({ synced_to_ghl: true, synced_to_ghl_at: new Date().toISOString() })
      .eq('email', email);
  } catch (err) {
    console.warn('[ghl] lead forwarded but could not be marked synced:', err);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const webhookUrl = process.env.GHL_WAITLIST_WEBHOOK_URL;
  if (!webhookUrl) {
    // Not configured yet. Report it, but as a soft failure — the caller ignores the
    // response either way and the signup is already saved.
    console.warn('[ghl] GHL_WAITLIST_WEBHOOK_URL is not set — waitlist lead not forwarded');
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }

  const { name, location } = req.body ?? {};
  // Normalised here as well as in the client: this endpoint is reachable directly,
  // and a stray-case address would miss markSynced()'s WHERE and look unforwarded.
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : req.body?.email;

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required' });
    return;
  }

  // GHL stores first and last name separately. The form asks for one "Name" field, so
  // send both the split and the original: splitting on the first space is a heuristic,
  // not a truth — many names do not divide that way — and `name` stays authoritative.
  // Same shape as api/ghl/contractor.ts so one workflow mapping fits both.
  const fullName = typeof name === 'string' ? name.trim() : '';
  const spaceAt   = fullName.indexOf(' ');
  const firstName = spaceAt === -1 ? fullName : fullName.slice(0, spaceAt);
  const lastName  = spaceAt === -1 ? ''       : fullName.slice(spaceAt + 1).trim();

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name:       fullName || null,
        first_name: firstName || null,
        last_name:  lastName  || null,
        location: typeof location === 'string' && location.trim() ? location.trim() : null,
        // Which language to write the launch announcement in.
        lang: req.body?.lang === 'fr' ? 'fr' : 'en',
        source: 'groundwork_waitlist',
        submitted_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('[ghl] webhook rejected the lead:', response.status);
      // Deliberately no upstream body in the response — it can carry account detail,
      // and the browser has no use for it.
      res.status(502).json({ error: 'Upstream rejected the lead' });
      return;
    }

    // Mark the row so an outage leaves a trail. Best-effort: the lead did reach GHL, so a
    // failure to record that must not be reported as a failed forward.
    await markSynced(email);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[ghl] webhook unreachable:', err);
    res.status(502).json({ error: 'Upstream unreachable' });
  }
}
