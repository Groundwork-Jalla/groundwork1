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
import { forwardToGhl } from './ghl/_forward.js';
import { routingFields } from './ghl/_routing-fields.js';
import { senderFor } from '../src/lib/email/senders.js';

const FROM = senderFor('contractor_invite');
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

    const [{ data: project }, { data: inviter }, { data: existing }] = await Promise.all([
      admin.from('projects').select('name, country').eq('id', invite.project_id).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', invite.invited_by).maybeSingle(),
      // The invitee's OWN stored preference, if they already have an account. Matched
      // case-insensitively, the same way the Stripe lookup does it — an invite typed as
      // `Ada@Example.com` must find the profile stored as `ada@example.com`.
      admin.from('profiles').select('preferred_lang').ilike('email', invite.email).limit(1),
    ]);

    // Resolve from the RECIPIENT, in this order: what they chose, then the project's
    // build country, then English.
    //
    // This used to pass `null` for the preference, on the reasoning that "the invitee has
    // no account yet". That is true of a first invitation and false of every one after it
    // — a contractor already working on one project, invited to a second, has an account
    // and a chosen language. That is precisely the case the beta tester reported: an
    // English account receiving a French invitation, because the Cameroonian project
    // country was the only signal being read.
    const lang = resolveRecipientLang(
      existing?.[0]?.preferred_lang ?? null,
      project?.country ?? null,
    );
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

    /**
     * ── The contractor invitation track can now start ────────────────────────────────
     *
     * Communication Flow v1.0 §6: `contractor_invited_by_client` opens CI01 and its
     * Day 1/3/7 reminders, and CI10/CI11 back to the client when it stays unaccepted.
     * The note above records what was said; this records that it HAPPENED, which is a
     * different thing and the only one a workflow can trigger on.
     *
     * Party comes from the event (`contractor_invited` is not a homeowner event), so
     * no override is needed — unlike acceptance, which occurs on both tracks.
     */
    let crmEvent = false;
    try {
      const fwd = await forwardToGhl('contractor_invited', {
        email: invite.email,
        lang,
        country: project?.country ?? null,
      }, {
        ...routingFields({
          userRole:         'contractor',
          entrySource:      'contractor_invitation',
          projectId:        invite.project_id,
          projectName:      project?.name ?? null,
          inviterUserId:    invite.invited_by,
          inviterName,
          inviterRole:      'client',
          invitationStatus: 'sent',
          activationStage:  'awaiting_invitation_response',
          stageEnteredAt:   new Date(),
        }),
        invite_path: `/invite/${inviteToken}`,
      }, {
        // Per invitation: the same contractor invited to a second build starts a second
        // reminder clock, and the token is unique per row.
        dedupeKey: `contractor_invited:${inviteToken}`,
      });
      crmEvent = fwd.ok;
    } catch (e) {
      console.error('[invite] could not tell the CRM about the invitation:', e);
    }

    res.status(200).json({ success: true, notedInCrm: noted.ok, crmSurface: noted.surface, crmEvent });
  } catch (err) {
    console.error('[invite] send failed:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
