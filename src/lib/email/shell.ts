import { LANG_META, type Lang } from '../i18n/types';
import { translator } from '../i18n/translate';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The chrome every Groundwork email shares: dark header, white card, footer rule.
 *
 * It was copy-pasted across the three templates, which is how `<html lang="en">` ended
 * up hardcoded in all of them. Now it is one place and takes the recipient's language,
 * so the document is correctly labelled for screen readers and for Gmail's
 * translate-this-message prompt.
 *
 * Table layout and inline styles are not stylistic here — Outlook and most webmail
 * clients strip <style> blocks and ignore flexbox.
 */
export function emailShell(lang: Lang, bodyHtml: string): string {
  const t = translator(lang);
  return `<!DOCTYPE html>
<html lang="${LANG_META[lang].htmlLang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">

        <tr>
          <td style="background:#1a1a1a;padding:24px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">${esc(t('email.brand'))}</p>
            <p style="margin:2px 0 0;font-size:10px;color:rgba(255,255,255,0.45);">${esc(t('email.byJalla'))}</p>
          </td>
        </tr>

        <tr><td style="padding:32px;">${bodyHtml}</td></tr>

        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:11px;color:#bbb;">
              ${esc(t('email.footer'))} &middot;
              <a href="https://tryjalla.com" style="color:#bbb;text-decoration:none;">tryjalla.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

/** Solid dark call-to-action button. */
export function primaryButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
  <tr><td style="background:#1a1a1a;border-radius:8px;">
    <a href="${href}" style="display:inline-block;padding:13px 28px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.1px;">
      ${esc(label)} &rarr;
    </a>
  </td></tr>
</table>`;
}

/** Outlined secondary button. */
export function secondaryButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0">
  <tr><td style="border-radius:8px;border:1px solid #e5e5e5;">
    <a href="${href}" style="display:inline-block;padding:11px 28px;color:#1a1a1a;font-size:13px;font-weight:500;text-decoration:none;">
      ${esc(label)} &rarr;
    </a>
  </td></tr>
</table>`;
}
