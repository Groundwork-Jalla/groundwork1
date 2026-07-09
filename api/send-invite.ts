// Vercel Serverless Function — sends contractor invite email via Resend.
// RESEND_API_KEY must be set in Vercel environment variables.

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { toEmail, projectName, inviterName } = req.body ?? {};

  if (!toEmail || !projectName || !inviterName) {
    res.status(400).json({ error: 'Missing required fields: toEmail, projectName, inviterName' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Email service not configured' });
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Groundwork</p>
            <p style="margin:2px 0 0;font-size:10px;color:rgba(255,255,255,0.45);">by Jalla</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.4px;">You've been invited</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              <strong style="color:#1a1a1a;">${inviterName}</strong> has invited you to collaborate on
              the <strong style="color:#1a1a1a;">${projectName}</strong> project on Groundwork.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.65;">
              Groundwork is a construction project management platform for diaspora property owners.
              As an invited contractor, you'll be able to upload progress evidence and communicate
              directly with the project owner.
            </p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#1a1a1a;border-radius:8px;">
                  <a href="https://groundwork1-phi.vercel.app/auth/signup"
                     style="display:inline-block;padding:13px 28px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.1px;">
                    Accept Invite &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:12px;color:#aaa;line-height:1.5;">
              If you weren't expecting this invite, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:11px;color:#bbb;">
              Groundwork by Jalla &middot;
              <a href="https://groundwork1-phi.vercel.app" style="color:#bbb;">groundwork1-phi.vercel.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();

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
