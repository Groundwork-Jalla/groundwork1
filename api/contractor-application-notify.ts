/**
 * Fan out the two emails a submitted contractor application produces:
 *   1. the applicant's own copy
 *   2. an internal alert to the team inbox
 *
 * Callers are anonymous by necessity — applicants have no account — so this endpoint
 * cannot be locked behind a session. It is made safe a different way: the only thing a
 * caller supplies is an application id. Both recipients and both bodies are derived
 * server-side from the stored row, so nobody can use it to send arbitrary mail from
 * noreply@mail.tryjalla.com. The worst it can be made to do is re-send a real
 * notification for an application that genuinely exists.
 *
 * This replaces the applicant confirmation that used to go through /api/send-email,
 * which accepted `to`, `subject` and `html` from the browser with no authentication —
 * an open relay on the brand's sending domain.
 */

import { siteUrl } from '../src/lib/site-url.js';

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';
const TEAM_INBOX = process.env.TEAM_INBOX ?? 'contact@tryjalla.com';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Compact internal summary. English only — this one goes to the team, not the applicant. */
// Exported so src/lib/email/render-previews.test.ts can render it for the email audit.
// It is the one template that lives in a handler rather than src/lib/email — kept here
// because it is internal-only and deliberately not translated (see below).
export function internalHtml(a: Record<string, any>, appUrl: string): string {
  const row = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? '' :
    `<tr>
       <td style="padding:5px 12px 5px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
       <td style="padding:5px 0;font-size:13px;color:#0a0a0a;">${esc(value)}</td>
     </tr>`;

  const projects = Array.isArray(a.projects) ? a.projects.length : 0;
  const uploads  = Array.isArray(a.uploads)  ? a.uploads.length  : 0;
  const flagged  = a.status === 'disqualified';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
    <tr><td style="padding:22px 26px;border-bottom:1px solid #f0f0f0;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a8a87;">New contractor application</p>
      <p style="margin:4px 0 0;font-size:19px;font-weight:800;color:#0a0a0a;">${esc(a.full_name)}</p>
      ${flagged ? `<p style="margin:8px 0 0;font-size:12px;color:#c2596b;">Auto-disqualified — answered No to a professional standard.</p>` : ''}
    </td></tr>
    <tr><td style="padding:18px 26px;">
      <table cellpadding="0" cellspacing="0" width="100%">
        ${row('Business',  a.business_name)}
        ${row('Role',      a.role)}
        ${row('Email',     a.email)}
        ${row('Phone',     a.phone)}
        ${row('Location',  [a.city, a.country].filter(Boolean).join(', '))}
        ${row('Experience',a.years_experience)}
        ${row('Regions',   a.regions)}
        ${row('Projects',  `${projects} listed`)}
        ${row('Documents', `${uploads} attached`)}
        ${row('Language',  a.lang)}
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-top:20px;">
        <tr><td style="background:#0a0a0a;border-radius:9px;">
          <a href="${esc(appUrl)}/admin/applications/${esc(a.id)}"
             style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:600;color:#fff;text-decoration:none;">
            Review application
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

  const { applicationId } = req.body ?? {};
  if (typeof applicationId !== 'string' || !applicationId) {
    res.status(400).json({ error: 'applicationId is required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !key || !apiKey) {
    console.error('[notify] missing SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: app, error } = await svc
    .from('contractor_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

  if (error || !app) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  const appUrl = siteUrl();
  const lang: 'en' | 'fr' = app.lang === 'fr' ? 'fr' : 'en';

  async function send(to: string, subject: string, html: string) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!r.ok) throw new Error(`resend ${r.status}`);
  }

  // The applicant's copy is the only one that needs the shared template, so the import
  // lives in its own arm of the settle. It used to sit above this block, where a failed
  // resolution was an unhandled rejection that took the team alert down with it — which
  // is precisely the coupling the comment below says must not exist.
  async function sendApplicantCopy() {
    const { buildContractorApplicationHtml, contractorApplicationSubject } =
      await import('../src/lib/email/contractor-application-html.js');
    await send(app.email, contractorApplicationSubject(lang),
               buildContractorApplicationHtml(lang, app as any));
  }

  // Reported independently: the team alert is what stops an application sitting unseen,
  // so it must not be skipped because the applicant's own copy bounced.
  const results = await Promise.allSettled([
    sendApplicantCopy(),
    send(TEAM_INBOX, `New contractor application — ${app.full_name}`,
         internalHtml(app, appUrl)),
  ]);

  const applicant = results[0].status === 'fulfilled';
  const team      = results[1].status === 'fulfilled';
  if (!applicant) console.error('[notify] applicant copy failed:', (results[0] as any).reason);
  if (!team)      console.error('[notify] team alert failed:', (results[1] as any).reason);

  // Stamp only when Resend actually accepted the applicant's copy.
  //
  // This is what makes "Not acknowledged" in the admin list mean something. The whole
  // failure that went unnoticed for a month was invisible precisely because nothing
  // recorded whether the mail went: the row looked identical either way, and the browser
  // had already thrown the error away. With this, a failed send leaves acknowledged_at
  // NULL and the application shows up flagged next to the ones nobody has emailed yet —
  // so the recovery button doubles as the alarm.
  //
  // Never stamped on failure, and never stamped for the team alert: a false "sent" here
  // hides exactly the person who needs chasing.
  if (applicant) {
    const { error: stampErr } = await svc
      .from('contractor_applications')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', applicationId);
    if (stampErr) console.error('[notify] sent but could not stamp acknowledged_at:', stampErr);
  }

  res.status(applicant || team ? 200 : 502).json({ ok: applicant && team, applicant, team });
}
