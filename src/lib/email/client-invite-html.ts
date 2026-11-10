import type { Lang } from '../i18n/types.js';
import { translator } from '../i18n/translate.js';
import { emailShell, esc, primaryButton } from './shell.js';

/**
 * A contractor has set up a client's account; this tells the client, in their language.
 *
 * ── Why this email exists at all ────────────────────────────────────────────────────
 * Until 11 Nov 2026 this step was `auth.admin.inviteUserByEmail`, which sends Supabase's
 * own "You have been invited" template from the dashboard — one template, one language,
 * not in the repository. A contractor reading the product in English set up a client
 * and the client received French, and there was no line of code in this codebase that
 * could have changed that. Favour: "when a contractor invited a client, it sent out the
 * email in French even though that contractor was using English. Fix it."
 *
 * So the account is still reserved by Supabase and the single-use link is still
 * Supabase's (`generateLink`, type `invite` — the same `/auth/v1/verify?type=invite`
 * link the template would have carried, so the callback flow is untouched). Only the
 * envelope changed: it goes through Resend, like every other invitation, in the
 * language `resolveRecipientLang` settles on.
 *
 * `actionLink` is the absolute URL Supabase returned. It is not a site path, which is
 * why this does not go through `siteLink` the way the contractor invite does — and it
 * carries `&`, which the contractor invite's link never does, so it is escaped here as
 * the attribute value it becomes (`primaryButton` inserts its href verbatim).
 */
export function buildClientInviteHtml(
  lang: Lang,
  contractorName: string,
  actionLink: string,
): string {
  const t = translator(lang);
  const n = esc(contractorName);

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.4px;">${esc(t('email.clientInvite.heading'))}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      ${t('email.clientInvite.body', { contractor: n })}
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.65;">
      ${esc(t('email.clientInvite.explain'))}
    </p>
    ${primaryButton(esc(actionLink), t('email.clientInvite.cta'))}
    <p style="margin:20px 0 0;font-size:12px;color:#aaa;line-height:1.5;">
      ${esc(t('email.clientInvite.ignore'))}
    </p>`;

  return emailShell(lang, body);
}

/** Subject line for the same email, in the same language. */
export function clientInviteSubject(lang: Lang, contractorName: string): string {
  return translator(lang)('email.clientInvite.subject', { contractor: contractorName });
}
