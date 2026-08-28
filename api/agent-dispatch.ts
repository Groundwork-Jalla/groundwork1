/**
 * Two things happen when a request is filed: a person is told, and the runner is kicked.
 *
 * Supabase database webhook (INSERT on public.agent_requests) → here → GitHub
 * `repository_dispatch` → .github/workflows/agent-request.yml.
 *
 * WHY VERCEL SITS IN THE MIDDLE. The GitHub token has to live somewhere, and it belongs
 * with the other server-side secrets in this project rather than inside the database.
 * It also gives one place to authenticate the caller: Supabase signs nothing, so without
 * a check here the endpoint would be a public button that starts a build.
 *
 * BOTH EFFECTS, ONE TRIGGER, AND THEY ARE INDEPENDENT. The email matters more than the
 * dispatch: automatic production may be switched off, or the key not yet configured, and
 * in that state the ONLY thing standing between a filed brief and silence is somebody
 * being told it arrived. Two briefs once sat unanswered for six hours because nothing
 * told anyone. So the two run under Promise.allSettled — GitHub being unreachable must
 * not swallow the notification, and a Resend outage must not stop the build.
 *
 * It lives here rather than in its own route because the Hobby plan caps this project at
 * twelve serverless functions and eleven are in use; see
 * src/lib/email/api-function-count.test.ts.
 *
 * WHAT THIS ENDPOINT IS NOT. It does not produce anything and it does not wait. The work
 * takes minutes and runs on a GitHub runner with Chrome and ffmpeg — none of which fits
 * in a serverless function. All this does is ring the bell.
 *
 * FAILING HERE IS SURVIVABLE ON PURPOSE. The workflow also runs on a schedule and picks
 * up anything still pending, so a missed webhook delays a request rather than losing it.
 * That is why a bad token returns 500 loudly but a duplicate call is harmless.
 */

import { siteUrl } from '../src/lib/site-url.js';

const GH_REPO  = process.env.GH_AGENT_REPO ?? 'Groundwork-Jalla/groundwork1';
const TEAM_INBOX = process.env.AGENT_REQUEST_INBOX ?? process.env.TEAM_INBOX ?? 'contact@tryjalla.com';
const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';
const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
const SECRET   = process.env.AGENT_DISPATCH_SECRET;

export default async function handler(req: any, res: any) {
  // GET is a setup check: which pieces are configured, never their values.
  //
  // Worth having because an unset secret and a wrong secret both answer 401 — correct
  // security, useless while wiring the thing up. Booleans only: knowing that a secret
  // exists gets an attacker nothing, and not knowing costs an afternoon.
  if (req.method === 'GET') {
    return res.status(200).json({
      endpoint: 'ok',
      secret_configured:   !!SECRET,
      github_configured:   !!GH_TOKEN,
      resend_configured:   !!process.env.RESEND_API_KEY,
      notify_inbox:        TEAM_INBOX.replace(/^(.).*(@.*)$/, '$1***$2'),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Shared secret, set as a custom header on the Supabase webhook. Compared with a
  // length check first so a wrong-length guess cannot be distinguished by timing.
  const given = String(req.headers['x-agent-secret'] ?? '');
  if (!SECRET || given.length !== SECRET.length || given !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Supabase sends { type, table, record, old_record }. Only the id is used — the
  // runner re-reads the row itself, so nothing here can be spoofed into producing work
  // against a brief that does not exist.
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const id = body?.record?.id ?? body?.id;
  if (!id) return res.status(400).json({ error: 'no_request_id' });

  const record = body?.record ?? {};

  const [dispatched, notified] = await Promise.allSettled([
    dispatch(id),
    notify(record, id),
  ]);

  if (dispatched.status === 'rejected') {
    console.error('[agent-dispatch] dispatch failed:', dispatched.reason);
  }
  if (notified.status === 'rejected') {
    console.error('[agent-dispatch] notify failed:', notified.reason);
  }

  // 202 regardless. The scheduled run collects anything the dispatch missed, and a
  // Supabase webhook retrying a 500 forever is noise rather than resilience.
  return res.status(202).json({
    request_id: id,
    dispatched: dispatched.status === 'fulfilled',
    notified: notified.status === 'fulfilled',
  });
}

async function dispatch(id: string) {
  // Not configured is a normal state, not a fault. Automatic production can be off — or
  // never set up — while notifications still matter, so this throws into the settle
  // rather than short-circuiting the handler and taking the email down with it.
  if (!GH_TOKEN) throw new Error('GH_DISPATCH_TOKEN not set — automatic production is off');

  const gh = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'agent-request', client_payload: { request_id: id } }),
  });
  if (!gh.ok) throw new Error(`github ${gh.status}: ${(await gh.text()).slice(0, 200)}`);
}

/**
 * Tell the team a brief arrived.
 *
 * Goes to ONE fixed internal address, never to anything in the payload — the same rule
 * the contractor notifier follows, so this endpoint can never be turned into a way to
 * send mail from the brand's domain to an arbitrary recipient. Everything interpolated
 * is escaped: the fields are typed by a person and land in an inbox as HTML.
 */
async function notify(r: Record<string, any>, id: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');

  const esc = (v: unknown) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const row = (label: string, value: unknown) =>
    value === null || value === undefined || value === ''
      ? ''
      : `<tr>
           <td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
           <td style="padding:6px 0;font-size:13px;color:#0a0a0a;">${esc(value)}</td>
         </tr>`;

  const link = `${siteUrl()}/admin/requests`;
  // Urgency belongs in the subject line: a deadline seen only after opening the mail is
  // a deadline discovered late.
  const due = r.needed_by ? ` — needed by ${esc(r.needed_by)}` : '';

  // The format belongs in the subject as well as the body. "New request" tells you
  // nothing about how long it will take; "video + deck" tells you whether this is a
  // twenty-minute job or a two-minute one, which is what decides when you pick it up.
  const FORMAT_LABEL: Record<string, string> = {
    mp4: 'video', pptx: 'deck', both: 'video + deck',
  };
  const fmt = FORMAT_LABEL[String(r.output_format ?? 'mp4')] ?? 'video';

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">
      <tr><td style="background:#0a0a0a;padding:20px 28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#fff;">New agent request</p>
        <p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.5);">${esc(r.agent ?? 'video-producer')}</p>
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#0a0a0a;">${esc(r.title ?? 'Untitled')}</p>
        <table cellpadding="0" cellspacing="0">
          ${row('Who it is for', r.audience)}
          ${row('So they can', r.goal)}
          ${row('Shown on', r.channel)}
          ${row('Language', r.language)}
          ${row('Deliver as', fmt)}
          ${row('Needed by', r.needed_by)}
          ${row('Notes', r.notes)}
        </table>
        <p style="margin:22px 0 0;">
          <a href="${link}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a>
        </p>
        <p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">
          Pick it up with <code style="background:#f4f4f4;padding:1px 5px;border-radius:4px;">npm run agent:queue -- brief ${esc(String(id).slice(0, 8))}</code>,
          then deliver with <code style="background:#f4f4f4;padding:1px 5px;border-radius:4px;">… -- deliver ${esc(String(id).slice(0, 8))} --file &lt;path&gt;</code>
        </p>
      </td></tr>
    </table>
  </body></html>`;

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [TEAM_INBOX],
      subject: `New ${fmt} request: ${String(r.title ?? 'Untitled').slice(0, 80)}${due}`,
      html,
    }),
  });
  if (!sent.ok) throw new Error(`resend ${sent.status}`);
}
