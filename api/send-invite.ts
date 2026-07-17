// Vercel Serverless Function — sends contractor invite email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.
import { buildInviteHtml } from '../src/lib/email/invite-html';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { toEmail, projectName, inviterName, inviteToken } = req.body ?? {};

  if (!toEmail || !projectName || !inviterName) {
    res.status(400).json({ error: 'Missing required fields: toEmail, projectName, inviterName' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Email service not configured' });
    return;
  }

  const html = buildInviteHtml(inviterName, projectName, inviteToken ?? '');

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
        subject: `${inviterName} invited you to a Groundwork project`,
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
