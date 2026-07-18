// Vercel Serverless Function — sends transactional email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html } = req.body ?? {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
      to: [to],
      subject,
      html,
    }),
  });

  const data = await r.json().catch(() => ({}));

  if (r.ok) {
    return res.status(200).json({ success: true });
  }
  return res.status(500).json({ error: 'Resend API error', details: data });
}
