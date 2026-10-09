import { emailShell, esc } from './shell.js';
import { translator } from '../i18n/translate.js';
import type { Lang } from '../i18n/types.js';

// =========================================================
// A verifier's invitation (105).
//
// The counterpart of the accepted application decision: Jalla has interviewed the
// engineer, and this is the link that turns that into an account. The token in the URL is
// the capability — holding it is what proves the person opening it is the one we
// interviewed — so this email is the ONE place it is ever written down.
//
// There is no tokenless fallback here, unlike the application decision. That email can
// fall back to a plain signup link because a contractor's standing comes from the
// application either way. A verifier has no application: without the token the page
// cannot grant the role, so a button that went there would be a dead end dressed as a
// welcome. The handler refuses to send rather than mail one.
// =========================================================

export function verifierInviteSubject(lang: Lang): string {
  return translator(lang)('email.verifierInvite.subject');
}

export function buildVerifierInviteHtml(
  lang: Lang,
  fullName: string,
  siteUrl: string,
  token: string,
): string {
  const t = translator(lang);
  const name = esc(fullName.trim().split(' ')[0] || fullName.trim());
  const href = `${siteUrl}/verifier-signup?t=${encodeURIComponent(token)}`;

  return emailShell(lang, `
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a87;">
      ${esc(t('email.verifierInvite.eyebrow'))}
    </p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:800;color:#0a0a0a;">
      ${esc(t('email.verifierInvite.heading'))}
    </h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.verifierInvite.greeting', { name }))}
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.verifierInvite.body1'))}
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.verifierInvite.body2'))}
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
      <tr><td style="background:#0a0a0a;border-radius:10px;">
        <a href="${esc(href)}"
           style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;">
          ${esc(t('email.verifierInvite.cta'))}
        </a>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#8a8a87;">
      ${esc(t('email.verifierInvite.personal'))}
    </p>
  `);
}
