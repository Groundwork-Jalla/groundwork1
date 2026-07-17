function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildInviteHtml(inviterName: string, projectName: string, inviteToken: string): string {
  const n = esc(inviterName);
  const p = esc(projectName);
  const link = `https://tryjalla.com/invite/${encodeURIComponent(inviteToken)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">

        <tr>
          <td style="background:#1a1a1a;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Groundwork</p>
            <p style="margin:2px 0 0;font-size:10px;color:rgba(255,255,255,0.45);">by Jalla</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.4px;">You've been invited</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              <strong style="color:#1a1a1a;">${n}</strong> has invited you to collaborate on
              the <strong style="color:#1a1a1a;">${p}</strong> project on Groundwork.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.65;">
              Groundwork is a construction project management platform for diaspora property owners.
              As an invited contractor, you'll be able to upload progress evidence and communicate
              directly with the project owner.
            </p>

            <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#1a1a1a;border-radius:8px;">
                  <a href="${link}"
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

        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:11px;color:#bbb;">
              Groundwork by Jalla &middot;
              <a href="https://tryjalla.com" style="color:#bbb;">tryjalla.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
