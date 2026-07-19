export function buildStageApprovedHtml(
  ownerName: string,
  projectName: string,
  stageName: string,
  nextStageName: string,
  projectId: string,
  certificateId?: string,
): string {
  const link = `https://tryjalla.com/projects/${projectId}`;
  const certLink = certificateId ? `https://tryjalla.com/verify/${certificateId}` : null;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">
        <tr><td style="background:#1a1a1a;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;font-family:-apple-system,sans-serif;">Groundwork</p>
          <p style="margin:3px 0 0;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.05em;text-transform:uppercase;">by Jalla</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a1a;">Stage Approved ✓</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.65;">
            Hi ${ownerName},<br/><br/>
            <strong>${stageName}</strong> on your project <strong>${projectName}</strong>
            has been verified and approved by Jalla.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.65;">
            <strong>${nextStageName}</strong> is now active. Your contractor
            can begin uploading evidence for the next phase.
          </p>
          <table cellpadding="0" cellspacing="0" style="border-spacing:0 8px;">
            <tr><td style="background:#1a1a1a;border-radius:8px;">
              <a href="${link}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:-apple-system,sans-serif;">
                View Project →
              </a>
            </td></tr>
            ${certLink ? `<tr><td style="border-radius:8px;border:1px solid #e5e5e5;">
              <a href="${certLink}" style="display:inline-block;padding:11px 28px;color:#1a1a1a;font-size:13px;font-weight:500;text-decoration:none;font-family:-apple-system,sans-serif;">
                View Certificate →
              </a>
            </td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#bbb;">
            Groundwork by Jalla ·
            <a href="https://tryjalla.com" style="color:#bbb;text-decoration:none;">tryjalla.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
