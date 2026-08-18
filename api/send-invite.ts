// Vercel Serverless Function — sends contractor invite email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.
import { buildInviteHtml, inviteSubject } from '../src/lib/email/invite-html.js';

/** Only 'en' and 'fr' exist; anything else from the client falls back rather than throws. */
function normalizeLang(value: unknown): 'en' | 'fr' {
  return value === 'fr' ? 'fr' : 'en';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { toEmail, projectName, inviterName, inviteToken, lang } = req.body ?? {};

  if (!toEmail || !projectName || !inviterName) {
    res.status(400).json({ error: 'Missing required fields: toEmail, projectName, inviterName' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Email service not configured' });
    return;
  }

  // The caller resolves this from the project's build country — the invitee has no
  // account yet, so there is no stored preference to look up server-side.
  const recipientLang = normalizeLang(lang);
  const html = buildInviteHtml(recipientLang, inviterName, projectName, inviteToken ?? '');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
        to: [toEmail],
        subject: inviteSubject(recipientLang, inviterName),
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      res.status(500).json({ error: 'Resend API error', details: body });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send email' });
  }
}
