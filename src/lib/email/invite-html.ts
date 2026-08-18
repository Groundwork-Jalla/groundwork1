import type { Lang } from '../i18n/types.js';
import { translator } from '../i18n/translate.js';
import { emailShell, esc, primaryButton } from './shell.js';

/**
 * Contractor invite.
 *
 * `lang` is the *recipient's* language. The inviter may well be reading English in
 * London while the contractor they are inviting works in Douala, so this must never be
 * taken from whoever is looking at the app.
 */
export function buildInviteHtml(
  lang: Lang,
  inviterName: string,
  projectName: string,
  inviteToken: string,
): string {
  const t = translator(lang);
  const n = esc(inviterName);
  const p = esc(projectName);
  const link = `https://tryjalla.com/invite/${encodeURIComponent(inviteToken)}`;

  // The body copy carries <strong> around the interpolated names, so the names are
  // escaped above and the template itself is trusted markup from our own dictionary.
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.4px;">${esc(t('email.invite.heading'))}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      ${t('email.invite.body', { inviter: n, project: p })}
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.65;">
      ${esc(t('email.invite.explain'))}
    </p>
    ${primaryButton(link, t('email.invite.cta'))}
    <p style="margin:20px 0 0;font-size:12px;color:#aaa;line-height:1.5;">
      ${esc(t('email.invite.ignore'))}
    </p>`;

  return emailShell(lang, body);
}

/** Subject line for the same email, in the same language. */
export function inviteSubject(lang: Lang, inviterName: string): string {
  return translator(lang)('email.invite.subject', { inviter: inviterName });
}
