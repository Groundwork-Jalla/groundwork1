/**
 * Does an email actually reach the CRM timeline?
 *
 * ── Why a button and not a deploy log ────────────────────────────────────────────────
 * Every step of this path fails quietly by design. `logEmailToCrm` cannot throw, cannot
 * fail a send, and returns a boolean nobody used to look at; an unconfigured API, a
 * contact GHL declines to create and a rejected note all produce the same thing —
 * nothing on the timeline. That is correct behaviour for a password reset and useless
 * for answering "is this working?".
 *
 * The whole feature is only worth anything if it can be trusted without a developer, so
 * this runs the *real* function — same lookup, same upsert, same notes endpoint — and
 * reports which step stopped. A test that used a shortcut would prove nothing about the
 * path the acknowledgement emails take.
 *
 * ── It writes to the admin's own contact ─────────────────────────────────────────────
 * A note has to land on someone. It lands on the person pressing the button, from their
 * own session — never on a contractor, whose timeline is a record other people read and
 * act on. The note says plainly that it is a test.
 */
import { ghlConfig } from '../ghl/_client.js';
import { logEmailToCrm } from '../ghl/_email-log.js';

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  // The recipient is the caller's own address, read from their session rather than taken
  // from the request. Otherwise this endpoint would write arbitrary notes onto arbitrary
  // contacts in the CRM for anyone who found it.
  const { data: userData } = await (asCaller.auth as any).getUser();
  const email = String(userData?.user?.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Your account has no email address to test with' });
    return;
  }

  // Answered before the attempt, because "no API configured" is not a failure and should
  // not read as one — it is the Phase 1 webhook setup, which has no notes endpoint at all.
  const api = await ghlConfig();
  if (!api) {
    res.status(200).json({
      ok: false,
      reason: 'not_configured',
      email,
      detail: 'No API token and location id, so there is no contact timeline to write to. '
            + 'Events are going through the Phase 1 webhook, which cannot add notes.',
    });
    return;
  }

  const startedAt = Date.now();
  const r = await logEmailToCrm({
    to: email,
    kind: 'other',
    subject: 'Groundwork — CRM email log test',
    html: '<p>This entry was written by the "Test the email log" button on /admin/crm.</p>'
        + '<p>It confirms that emails sent through Resend are recorded on the recipient\'s '
        + 'GoHighLevel contact. No email was sent for this test.</p>',
  });

  // Three outcomes, not two. "It worked" and "it worked, but on the wrong surface" are
  // different answers: a note means the conversation write was impossible or refused,
  // and the whole point of the provider id is that you can reply from the thread.
  const detail =
    r.surface === 'conversation'
      ? `Written to the Conversations thread for ${email}. Open the contact in `
        + 'GoHighLevel — it should appear in Conversations, with a reply box under it.'
    : r.surface === 'note' && r.reason === 'no_provider_id'
      ? 'Written as a note, not to Conversations, because GHL_CONVERSATION_PROVIDER_ID '
        + 'is not set. Notes cannot be replied to. See docs/GHL-SETUP.md, step 8, for '
        + 'how to create the Email conversation provider and where to paste its id.'
    : r.surface === 'note'
      ? `Written as a note. GoHighLevel refused the conversation message (${r.reason}), `
        + 'so the record was kept where it could be. The provider id may be wrong, or the '
        + 'token may be missing the conversations/message.write scope.'
    : 'Nothing was recorded. The contact could not be created or both writes were '
      + `refused (${r.reason}) — check the function logs for [ghl-email-log].`;

  res.status(200).json({
    ok: r.ok,
    // The button is green only for the surface that was actually asked for.
    onThread: r.surface === 'conversation',
    surface: r.surface,
    reason: r.reason ?? null,
    email,
    ms: Date.now() - startedAt,
    detail,
  });
}
