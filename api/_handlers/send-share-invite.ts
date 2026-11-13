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
import { sendViaResend } from '../_lib/resend-send.js';
import { forwardToGhl } from '../ghl/_forward.js';
import { routingFields } from '../ghl/_routing-fields.js';
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
      .select('email, relationship, project_id, invited_by, accepted_at, revoked_at, is_client')
      .eq('token', shareToken)
      .maybeSingle();

    if (!viewer || !viewer.email || viewer.revoked_at !== null || viewer.accepted_at !== null) {
      res.status(404).json({ error: 'No open invitation for that token' });
      return;
    }

    const [{ data: project }, { data: inviter }, { data: existing }] = await Promise.all([
      admin.from('projects').select('name, country').eq('id', viewer.project_id).maybeSingle(),
      admin.from('profiles').select('full_name, preferred_lang').eq('id', viewer.invited_by).maybeSingle(),
      // Their own stored preference, if they already have an account. Matched
      // case-insensitively: an address typed `Ada@Example.com` must find the profile
      // stored as `ada@example.com`.
      admin.from('profiles').select('preferred_lang').ilike('email', viewer.email).limit(1),
    ]);

    // The recipient's own preference wins. Otherwise use the sender's actual screen,
    // then their stored preference; the country is only a fallback for unknown people.
    const uiLang = req.body?.lang;
    const lang = resolveRecipientLang(
      existing?.[0]?.preferred_lang ?? null,
      project?.country ?? null,
      inviter?.preferred_lang ?? null,
      uiLang === 'en' || uiLang === 'fr' ? uiLang : null,
    );

    // The inviter is a person here, not a company, so the fallback is deliberately not
    // "A Groundwork client" — this email is about somebody's own house.
    const inviterName = inviter?.full_name?.trim() || 'Someone on Groundwork';
    const projectName = project?.name?.trim() || 'a Groundwork project';

    const subject = shareSubject(lang, inviterName, projectName);
    const html = buildShareHtml(lang, inviterName, projectName, viewer.relationship, shareToken, viewer.is_client === true);

    const sent = await sendViaResend({ from: FROM, to: viewer.email, subject, html });

    if (!sent.ok) {
      // Stays short of `sent`, so it reads as still owed rather than quietly fine.
      await admin.from('project_viewers').update({
        email_status:   sent.retryable ? 'queued' : 'failed',
        email_error:    sent.error ?? 'unknown',
        email_attempts: sent.attempts,
      }).eq('token', shareToken);
      console.error('[share] Resend refused the message:', sent.error);
      res.status(502).json({ error: 'Could not send the email' });
      return;
    }

    /*
     * Record what the provider said, on the invitation itself.
     *
     * Until 178 the only trace of a send was `console.error` in the browser that
     * asked for it. `email_message_id` is the handle a delivery receipt arrives
     * quoting (see _handlers/email-receipt.ts) — without it, "did it arrive?" has no
     * answer for any invitation ever sent.
     *
     * Awaited, not floated: Vercel freezes the instance the moment the handler
     * responds, and a suspended promise never writes anything.
     */
    await admin.from('project_viewers').update({
      email_message_id: sent.messageId ?? null,
      email_status:     'sent',
      email_sent_at:    new Date().toISOString(),
      email_error:      null,
      email_attempts:   sent.attempts,
    }).eq('token', shareToken);

    // Awaited before responding: Vercel freezes the instance when the handler returns,
    // so a floating promise never reaches the note. It cannot throw and cannot fail the
    // send — see the header of ghl/_email-log.ts.
    const noted = await logEmailToCrm({ to: viewer.email, subject, html, kind: 'other' });

    /**
     * ── The client is now a contact, and the IV track can begin ──────────────────────
     *
     * Communication Flow v1.0 §8: `client_invited_by_contractor` opens IV01 to the
     * client and CS13 to the contractor, and the Day 1/3/7 reminders hang off it. Until
     * this call existed the CRM never heard that an invitation had been sent, so none
     * of those sequences had anything to start on.
     *
     * The contact is the INVITEE, who very likely has no account yet — GHL upserts on
     * email, which is exactly right here: they become a contact at the moment somebody
     * asks them to join, not at the moment they accept.
     *
     * Awaited before responding, like the note above: Vercel freezes the instance when
     * the handler returns and a floating promise never lands. It cannot fail the send;
     * the email has already gone out and the invitation stands whatever the CRM says.
     */
    let crmEvent = false;
    // Observers receive the email, without primary-client onboarding/reminders.
    if (viewer.is_client === true) {
      try {
        const fwd = await forwardToGhl('client_invited', {
          email: viewer.email,
          lang,
          country: project?.country ?? null,
        }, {
          ...routingFields({
            userRole:         'client',
            entrySource:      'client_invitation',
            projectId:        viewer.project_id,
            projectName:      project?.name ?? null,
            inviterUserId:    viewer.invited_by,
            inviterName,
            inviterRole:      'contractor',
            invitationStatus: 'sent',
            activationStage:  'awaiting_invitation_response',
            stageEnteredAt:   new Date(),
          }),
          invitation_email_sent: true,
          invitation_email_subject: subject,
          invite_path: `/share/${shareToken}`,
        }, { dedupeKey: `client_invited:${shareToken}` });
        crmEvent = fwd.ok;
      } catch (e) {
        console.error('[share] could not tell the CRM about the invitation:', e);
      }
    }

    res.status(200).json({ success: true, notedInCrm: noted.ok, crmSurface: noted.surface, crmEvent });
  } catch (err) {
    console.error('[share] send failed:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
