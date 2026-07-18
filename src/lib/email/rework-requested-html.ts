export function buildReworkHtml(
  ownerName: string,
  projectName: string,
  stageName: string,
  reworkNote: string,
  flaggedCount: number,
  projectId: string,
): string {
  const link = `https://tryjalla.com/projects/${projectId}`;
  const substageWord = flaggedCount === 1 ? 'substage' : 'substages';
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
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a1a;">Rework Requested</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.65;">
            Hi ${ownerName},<br/><br/>
            <strong>${stageName}</strong> on <strong>${projectName}</strong>
            requires changes before it can be approved.
          </p>
          <div style="background:#f9f9f9;border-radius:8px;border:1px solid #ebebeb;padding:16px;margin:0 0 16px;">
            <p style="margin:0 0 6px;font-size:10px;color:#999;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Reviewer note</p>
            <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">${reworkNote}</p>
          </div>
          <p style="margin:0 0 24px;font-size:14px;color:#666;">
            ${flaggedCount} ${substageWord} flagged for rework.
          </p>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#1a1a1a;border-radius:8px;">
              <a href="${link}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:-apple-system,sans-serif;">
                View Details →
              </a>
            </td></tr>
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
