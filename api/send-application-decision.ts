/**
 * Tell a contractor applicant they were accepted or rejected.
 *
 * Two things are deliberately NOT taken from the request body: the recipient address
 * and the message. The caller sends an application id and a decision; the address, the
 * name and the language are read from `contractor_applications` with the service role,
 * and the body is built from our own templates.
 *
 * That matters because this endpoint sends mail as noreply@mail.tryjalla.com. If it
 * accepted a `to` field it would be an open relay on the brand's sending domain — worth
 * a phishing campaign to anyone who found it, and a fast route to the domain being
 * blacklisted. The only thing a caller can influence is *which* application is notified,
 * and only an admin may do that.
 */

type Decision = 'accepted' | 'rejected';

import { siteUrl } from '../src/lib/site-url.js';
import { isValidEmail } from '../src/lib/email/is-valid-email.js';
import { forwardToGhl } from './ghl/_forward.js';
import { handler as acknowledge } from './_handlers/send-application-acknowledgement.js';

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';

function admin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { applicationId, decision } = req.body ?? {};
  if (typeof applicationId !== 'string' || !applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  // Same endpoint, because Vercel's Hobby plan allows 12 serverless functions and every
  // file under api/ is one — see the note in api/events.ts. Both actions are "an admin
  // acted on an application and the applicant should hear about it", so they sit
  // together rather than in a grab-bag.
  if (decision === 'acknowledge') return acknowledge(req, res);

  if (decision !== 'accepted' && decision !== 'rejected') {
    res.status(400).json({ error: 'decision must be "accepted", "rejected" or "acknowledge"' });
    return;
  }

  const cfg = admin();
  if (!cfg) {
    console.error('[decision] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? cfg.key;

  // Authorise as the caller, not as the service role: is_admin() reads auth.uid(), so
  // this answers "is *this person* an admin", which a service-role client cannot.
  const asCaller = createClient(cfg.url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  // Now read the application with the service role. RLS would also allow the admin to
  // read it, but the service role keeps the recipient independent of the caller's
  // session in case those policies are ever loosened.
  const svc = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: app, error: readErr } = await svc
    .from('contractor_applications')
    .select('email, full_name, lang')
    .eq('id', applicationId)
    .maybeSingle();

  if (readErr || !app) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[decision] RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Email is not configured' });
    return;
  }

  // Same guard as the acknowledgement, for the same reason: an address Resend will
  // never accept is not a failed send, it is a row that can never be emailed, and
  // "press the button again to retry" is the wrong thing to tell someone about it.
  // See the note in src/lib/email/is-valid-email.ts.
  if (!isValidEmail(String(app.email ?? ''))) {
    console.error('[decision] stored address is not deliverable:', applicationId, app.email);
    res.status(422).json({
      error: 'The stored address is not a valid email address',
      stage: 'address',
      address: app.email ?? null,
    });
    return;
  }

  const lang: 'en' | 'fr' = app.lang === 'fr' ? 'fr' : 'en';
  const site = siteUrl();

  try {
    // Templates live in src/lib/email so the app and this function build the same message.
    // Inside the try: this import previously sat above it, so a resolution failure became
    // an unhandled rejection and a bare 500 rather than the 502 the admin UI understands.
    const { buildApplicationDecisionHtml, applicationDecisionSubject } =
      await import('../src/lib/email/application-decision-html.js');

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [app.email],
        subject: applicationDecisionSubject(lang, decision as Decision),
        html: buildApplicationDecisionHtml(
          lang, decision as Decision, app.full_name ?? '', site,
        ),
      }),
    });

    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      console.error('[decision] Resend rejected the message:', r.status, detail);
      const stage = r.status === 401 || r.status === 403 ? 'credentials'
                  : r.status === 422                     ? 'address'
                  : 'send';
      res.status(r.status === 422 ? 422 : 502)
         .json({ error: 'Could not send the email', stage, upstreamStatus: r.status });
      return;
    }

    // Tell the CRM the outcome. Without this a contractor stays a fresh application in
    // GHL for ever — accepted or rejected months ago, still sitting in the same stage.
    // Awaited but never fatal: the decision and the applicant's email are already done,
    // and a CRM outage must not turn a completed decision into a 502.
    await forwardToGhl('application_decision', {
      email: app.email,
      fullName: app.full_name,
      lang: lang,
    }, {
      decision,
      application_id: applicationId,
      application_url: `${site}/admin/applications/${applicationId}`,
    }, {
      // Accepted and rejected are opposite ends of a pipeline, not one event.
      variant: decision,
      dedupeKey: `application_decision:${applicationId}:${decision}`,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[decision] Resend unreachable:', err);
    res.status(502).json({ error: 'Could not send the email', stage: 'network' });
  }
}
