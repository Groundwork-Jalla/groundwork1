import { emailShell, esc } from './shell';
import { translator } from '../i18n/translate';
import { SKOOL_URL } from '../community';
import type { Lang } from '../i18n/types';

// =========================================================
// Waitlist welcome.
//
// Exists because the community link only appeared on the success screen, which people
// close. Signing up and joining the community are two separate acts, and the second one
// was only ever offered in the half-second after the first. This puts it somewhere they
// can come back to.
//
// Written in the language of the signup form (waitlist_emails.lang, migration 034).
// =========================================================

export function waitlistWelcomeSubject(lang: Lang): string {
  return translator(lang)('email.waitlist.subject');
}

export function buildWaitlistWelcomeHtml(lang: Lang, fullName: string): string {
  const t = translator(lang);
  const first = fullName.trim().split(' ')[0] || fullName.trim();

  return emailShell(lang, `
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a87;">
      ${esc(t('email.waitlist.eyebrow'))}
    </p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:800;color:#0a0a0a;">
      ${esc(t('email.waitlist.heading'))}
    </h1>
    ${first ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.waitlist.greeting', { name: esc(first) }))}
    </p>` : ''}
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.waitlist.body1'))}
    </p>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.waitlist.body2'))}
    </p>

    <table cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
      <tr><td style="background:#0a0a0a;border-radius:10px;">
        <a href="${esc(SKOOL_URL)}"
           style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
          ${esc(t('email.waitlist.cta'))}
        </a>
      </td></tr>
    </table>

    <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#8a8a87;">
      ${esc(t('email.waitlist.ctaNote'))}
    </p>
  `);
}
