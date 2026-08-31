/**
 * Send the "we received your application" email to one applicant, on purpose.
 *
 * This is the recovery tool for the applicants who never got it. Between the 20 August
 * meeting and 21 August 11:32, contractor-application-notify died before it could send
 * and the browser threw the error away, so those people submitted an application and
 * heard nothing at all.
 *
 * Two deliberate differences from the automatic send:
 *
 *   - **Applicant only.** The automatic path also alerts the team inbox. Re-alerting
 *     the team about an application they have had for weeks is noise, and noise in the
 *     inbox that is supposed to mean "someone new applied" is worse than useless.
 *   - **Admin only.** The automatic endpoint has to accept anonymous callers, because
 *     applicants have no account. This one is a deliberate act by a person, so it is
 *     gated the same way the accept/reject mail is — and gating it keeps a button that
 *     sends mail from our domain out of anonymous hands.
 *
 * The recipient, name and language all come from the stored row. Nothing about who
 * receives mail is taken from the request.
 */
import { siteUrl } from '../../src/lib/site-url.js';
import { isValidEmail } from '../../src/lib/email/is-valid-email.js';
import { logEmailToCrm } from '../ghl/_email-log.js';

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';

function config() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { applicationId } = req.body ?? {};
  if (typeof applicationId !== 'string' || !applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  const cfg = config();
  const apiKey = process.env.RESEND_API_KEY;
  if (!cfg || !apiKey) {
    console.error('[ack] missing SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY');
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

  // Authorise as the caller: is_admin() reads auth.uid(), which a service-role client
  // does not have. Same pattern as api/send-application-decision.ts.
  const asCaller = createClient(cfg.url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const svc = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: app, error } = await svc
    .from('contractor_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

  if (error || !app) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  // Checked before anything is built or sent, because a malformed address is the one
  // failure that no amount of retrying can clear, and it looked exactly like a transient
  // one on screen. `ngamfonjoel.@gmail.com` — a trailing dot on the local part — passed
  // the old, looser rule at submission, so it was stored, and Resend then answered 422
  // to every send. The admin saw "Try again" and did, for ever. Reported as its own
  // stage so the page can say what is actually wrong and who can fix it.
  if (!isValidEmail(String(app.email ?? ''))) {
    console.error('[ack] stored address is not deliverable:', applicationId, app.email);
    res.status(422).json({
      error: 'The stored address is not a valid email address',
      stage: 'address',
      address: app.email ?? null,
    });
    return;
  }

  const lang: 'en' | 'fr' = app.lang === 'fr' ? 'fr' : 'en';

  // Building the message and sending it are reported separately.
  //
  // They were one try/catch returning one 502, so "the template threw on a row shape it
  // could not read" and "Resend refused the address" were the same message on screen —
  // which is why the last failure needed the network tab and a repro to identify. The
  // admin cannot fix either, but knowing which one it is decides whether to retry or to
  // call someone.
  let subject: string;
  let html: string;
  try {
    // Inside a try: a failure to resolve this module used to be an unhandled rejection
    // and a bare 500. See api/README.md on the .js extension.
    const { buildContractorApplicationHtml, contractorApplicationSubject } =
      await import('../../src/lib/email/contractor-application-html.js');
    const { applicationFromRow } = await import('../../src/lib/contractor/application-types.js');

    subject = contractorApplicationSubject(lang);
    html = buildContractorApplicationHtml(lang, applicationFromRow(app));
  } catch (err) {
    // Not retryable: the same row will fail the same way every time.
    console.error('[ack] could not build the message for', applicationId, err);
    res.status(500).json({ error: 'Could not build the email', stage: 'template' });
    return;
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [app.email],
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      console.error('[ack] Resend rejected the message:', r.status, detail);
      // The upstream *status* comes back, the body does not. A 401 or 403 means our
      // credentials, not this application — an admin clicking "try again" for ever
      // cannot fix a revoked key, and nothing on screen was telling them that.
      // 422 is Resend refusing the address itself, not the send — the guard above
      // catches the shapes we know about, and this catches the rest rather than
      // filing them under "try again".
      const stage = r.status === 401 || r.status === 403 ? 'credentials'
                  : r.status === 422                     ? 'address'
                  : 'send';
      res.status(r.status === 422 ? 422 : 502).json({
        error: 'Could not send the email',
        stage,
        upstreamStatus: r.status,
      });
      return;
    }

    // Onto the applicant's GHL contact. Placed before the stamping and not awaited, so
    // it happens on both exits below — the note is as useful when the `acknowledged_at`
    // write fails as when it succeeds, and arguably more so.
    void logEmailToCrm({
      to: app.email, subject, html,
      kind: 'contractor_application_received', name: app.full_name ?? null,
    });

    // Stamped only after Resend accepts it. Stamping first would mark someone as
    // contacted who never was, and this column is the only record of who still needs
    // chasing — a false positive there is exactly the failure this is meant to end.
    const sentAt = new Date().toISOString();
    const { error: stampErr } = await svc
      .from('contractor_applications')
      .update({ acknowledged_at: sentAt })
      .eq('id', applicationId);

    if (stampErr) {
      // The mail went. Say so, and say the bookkeeping did not — silently reporting
      // success would leave the row looking unsent and invite a duplicate.
      console.error('[ack] sent but could not stamp acknowledged_at:', stampErr);
      res.status(200).json({ ok: true, sentAt, stamped: false });
      return;
    }

    res.status(200).json({ ok: true, sentAt, stamped: true });
  } catch (err) {
    console.error('[ack] could not reach Resend:', err);
    res.status(502).json({ error: 'Could not reach the email service', stage: 'network' });
  }
}
