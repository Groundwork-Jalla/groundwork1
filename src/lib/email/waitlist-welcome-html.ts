import { emailShell, esc } from './shell';
import { translator } from '../i18n/translate';
import type { Lang } from '../i18n/types';

// =========================================================
// Waitlist welcome.
//

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

  `);
}
