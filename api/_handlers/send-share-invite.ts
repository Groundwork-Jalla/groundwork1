// `/api/events?action=send-share-invite` — sends a "follow this build" invitation (112).
//
// A handler under `_handlers/`, not a file of its own under `api/`: Vercel counts every
// top-level file as a serverless function and the Hobby plan allows 12. We were at 11,
// so a twelfth would have spent the last slot on one email. See api/events.ts.
//
// The gap this closes: `invite_project_viewer` recorded the row and handed the browser
// a token, and nothing ever sent it anywhere. The panel still said "Invitation sent to
// …", so every person invited since 112 shipped was told their email had gone out and
// it never had. Reported 30 Oct 2026.
//
// Shaped exactly like send-invite.ts, and for the same reasons:
//
//   * Everything in the message is read from the `project_viewers` row, never from the
//     request body. A body that supplied the address and the text would be an open
//     relay on the brand's sending domain, and that domain's reputation is not
//     something an anonymous caller should be able to spend.
//   * The token IS the capability. It is a UUID with a UNIQUE index, it is already what
//     the link is keyed on, and the browser already holds it. Holding an unguessable
//     token that matches an open row is the proof, so this needs no session.
//   * One response for "no such token" and "already accepted", so it cannot be used to
//     probe which tokens exist.
import { buildShareHtml, shareSubject } from '../../src/lib/email/share-html.js';
import { resolveRecipientLang } from '../../src/lib/i18n/translate.js';
import { logEmailToCrm } from '../ghl/_email-log.js';
import { senderFor } from '../../src/lib/email/senders.js';

// `other` rather than a new EmailKind: this is not a contractor invitation, and
// labelling it one would put it under the wrong heading in the CRM note. A kind of its
// own can follow when somebody wants to count these separately.
const FROM = senderFor('other');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const shareToken = req.body?.shareToken;
  if (typeof shareToken !== 'string' || !UUID_RE.test(shareToken)) {
    res.status(400).json({ error: 'Missing or malformed shareToken' });
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
    const { data: viewer } = await admin
      .from('project_viewers')
      .select('email, relationship, project_id, invited_by, accepted_at, revoked_at')
      .eq('token', shareToken)
      .maybeSingle();

    if (!viewer || viewer.revoked_at !== null || viewer.accepted_at !== null) {
      res.status(404).json({ error: 'No open invitation for that token' });
      return;
    }

    const [{ data: project }, { data: inviter }, { data: existing }] = await Promise.all([
      admin.from('projects').select('name, country').eq('id', viewer.project_id).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', viewer.invited_by).maybeSingle(),
      // Their own stored preference, if they already have an account. Matched
      // case-insensitively: an address typed `Ada@Example.com` must find the profile
      // stored as `ada@example.com`.
      admin.from('profiles').select('preferred_lang').ilike('email', viewer.email).limit(1),
    ]);

    // Read from the RECIPIENT: what they chose, then the project's build country, then
    // English. Never the inviter's language — see share-html.ts.
    const lang = resolveRecipientLang(
      existing?.[0]?.preferred_lang ?? null,
      project?.country ?? null,
    );

    // The inviter is a person here, not a company, so the fallback is deliberately not
    // "A Groundwork client" — this email is about somebody's own house.
    const inviterName = inviter?.full_name?.trim() || 'Someone on Groundwork';
    const projectName = project?.name?.trim() || 'a Groundwork project';

    const subject = shareSubject(lang, inviterName, projectName);
    const html = buildShareHtml(lang, inviterName, projectName, viewer.relationship, shareToken);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [viewer.email], subject, html }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('[share] Resend rejected the message:', response.status, body);
      res.status(502).json({ error: 'Could not send the email' });
      return;
    }

    // Awaited before responding: Vercel freezes the instance when the handler returns,
    // so a floating promise never reaches the note. It cannot throw and cannot fail the
    // send — see the header of ghl/_email-log.ts.
    const noted = await logEmailToCrm({ to: viewer.email, subject, html, kind: 'other' });

    res.status(200).json({ success: true, notedInCrm: noted.ok, crmSurface: noted.surface });
  } catch (err) {
    console.error('[share] send failed:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
