import type { Lang } from '../i18n/types.js';
import { translator } from '../i18n/translate.js';
import { emailShell, esc, primaryButton } from './shell.js';
import { siteLink } from '../site-url.js';

/**
 * "Somebody invited you to follow their build" (112).
 *
 * ── Why this is not `invite-html.ts` ────────────────────────────────────────────────
 * That template invites a CONTRACTOR: create an account, upload evidence, be paid on
 * milestones. This one goes to the client, their spouse, whoever is funding the house
 * — people who in most cases have never heard of Groundwork and are being asked to
 * open a link about a building. Reusing the contractor words would promise them work
 * and payment, which is the opposite of what they are being granted.
 *
 * ── Why the relationship is in the body ─────────────────────────────────────────────
 * "Who they are" is optional and free text, typed by the inviter so they can tell the
 * list apart later. It earns its place in the message too: "as **his wife**" is how
 * the recipient recognises, in one glance, that this really is about them and not a
 * circular. It is escaped like any other untrusted string.
 *
 * `lang` is the RECIPIENT's language, never the inviter's — a diaspora client reading
 * English in Paris may be inviting family in Douala.
 */
export function buildShareHtml(
  lang: Lang,
  inviterName: string,
  projectName: string,
  relationship: string | null,
  shareToken: string,
): string {
  const t = translator(lang);
  const n = esc(inviterName);
  const p = esc(projectName);
  const rel = relationship?.trim() ? esc(relationship.trim()) : null;
  const link = siteLink(`share/${encodeURIComponent(shareToken)}`);

  // The interpolated names carry <strong> from the dictionary, so each value is
  // escaped above and the template itself is our own trusted markup.
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.4px;">${esc(t('email.share.heading'))}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      ${rel
        ? t('email.share.bodyAs', { inviter: n, project: p, relation: rel })
        : t('email.share.body',   { inviter: n, project: p })}
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.65;">
      ${esc(t('email.share.explain'))}
    </p>
    ${primaryButton(link, t('email.share.cta'))}
    <p style="margin:20px 0 0;font-size:13px;color:#777;line-height:1.6;">
      ${esc(t('email.share.newAccount'))}
    </p>
    <p style="margin:14px 0 0;font-size:12px;color:#aaa;line-height:1.5;">
      ${esc(t('email.share.ignore'))}
    </p>`;

  return emailShell(lang, body);
}

/** Subject line for the same email, in the same language. */
export function shareSubject(lang: Lang, inviterName: string, projectName: string): string {
  return translator(lang)('email.share.subject', { inviter: inviterName, project: projectName });
}
