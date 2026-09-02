// Vercel Serverless Function — sends a contractor invite email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.
//
// Everything that ends up in the message is read from the contractor_invites row,
// not from the request body. The body used to supply toEmail, projectName and
// inviterName directly, with no auth of any kind — an anonymous POST could send
// arbitrary text to an arbitrary address from noreply@mail.tryjalla.com. Escaping
// (invite-html.ts) meant it was not an injection vector, but it was a relay on the
// brand's sending domain, and the domain's reputation is not something a caller
// should be able to spend.
//
// The token is the capability: it is a UUID with a UNIQUE constraint, it is already
// what the invite link itself is keyed on, and the client already sends it. So this
// needs no session — holding an unguessable token that matches a pending row is the
// proof. It follows the same shape as contractor-application-notify: caller names a
// row, server decides what goes in the message and where it goes.
import { buildInviteHtml, inviteSubject } from '../src/lib/email/invite-html.js';
import { resolveRecipientLang } from '../src/lib/i18n/translate.js';
import { logEmailToCrm } from './ghl/_email-log.js';

const FROM = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const inviteToken = req.body?.inviteToken;
  if (typeof inviteToken !== 'string' || !UUID_RE.test(inviteToken)) {
    res.status(400).json({ error: 'Missing or malformed inviteToken' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Email service not configured' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Service role, so RLS is bypassed — the token match is the authorisation.
    const { data: invite } = await admin
      .from('contractor_invites')
      .select('email, status, project_id, invited_by')
      .eq('token', inviteToken)
      .maybeSingle();

    // Same response for "no such token" and "already accepted", so this cannot be
    // used to probe which tokens exist.
    if (!invite || invite.status !== 'pending') {
      res.status(404).json({ error: 'No pending invite for that token' });
      return;
    }

    const [{ data: project }, { data: inviter }] = await Promise.all([
      admin.from('projects').select('name, country').eq('id', invite.project_id).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', invite.invited_by).maybeSingle(),
    ]);

    // The invitee has no account yet, so there is no stored preference. The project's
    // build country is the same signal the client used; resolving it here keeps the
    // decision with the data rather than trusting a body field.
    const lang = resolveRecipientLang(null, project?.country ?? null);
    const inviterName = inviter?.full_name?.trim() || 'A Groundwork client';
    const projectName = project?.name?.trim() || 'a Groundwork project';

    const subject = inviteSubject(lang, inviterName);
    const html = buildInviteHtml(lang, inviterName, projectName, inviteToken);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [invite.email], subject, html }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('[invite] Resend rejected the message:', response.status, body);
      res.status(502).json({ error: 'Could not send the email' });
      return;
    }

    // On the contact in GHL, so whoever follows up can see the invitation was sent
    // without asking anyone. Awaited before responding: Vercel freezes the instance when
    // the handler returns, so a floating promise never reaches the note. It cannot throw
    // and cannot fail the send — see the header of ghl/_email-log.ts.
    const noted = await logEmailToCrm({
      to: invite.email, subject, html, kind: 'contractor_invite',
    });

    res.status(200).json({ success: true, notedInCrm: noted.ok, crmSurface: noted.surface });
  } catch (err) {
    console.error('[invite] send failed:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
