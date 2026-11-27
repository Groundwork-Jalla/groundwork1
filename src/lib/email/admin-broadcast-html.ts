import type { Lang } from '../i18n/types.js';
import { siteUrl } from '../site-url.js';
import { emailShell, esc, primaryButton } from './shell.js';

/**
 * Branded admin-authored broadcast email for `/admin/users`.
 *
 * Built so Ruth (or any admin) can write a custom follow-up or activation nudge from
 * the Admin Users screen without hardcoding email copy in the codebase. Every message
 * still renders inside Groundwork's verified green shell (`#122d2b` header, `#006b5e`
 * CTA button, `tryjalla.com` footer) and escapes all user-typed text.
 *
 * Reachable from `api/`: relative imports carry `.js`, no `@/*` aliases, no `import.meta`.
 */

export interface AdminBroadcastInput {
  recipientName: string;
  body: string;
  lang: Lang;
  actionLabel?: string | null;
  actionPath?: string | null;
}

const DEFAULT_CTA_LABEL: Record<Lang, string> = {
  en: 'Start or activate your project',
  fr: 'Créer ou activer mon projet',
};

const NAME_TOKEN_RE = /\{\{\s*name\s*\}\}/gi;

/** First name only for a warm, human greeting; falls back cleanly when blank. */
export function firstNameOf(fullName: string, lang: Lang): string {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return lang === 'fr' ? 'cher membre' : 'there';
  const first = cleaned.split(' ')[0] ?? '';
  return first || (lang === 'fr' ? 'cher membre' : 'there');
}

/**
 * Validate an optional CTA path or Groundwork URL.
 *
 * Only relative Groundwork routes (`/projects/new`, `/dashboard`, `/work/partner`) or
 * `https://` URLs are allowed — never `javascript:`, `data:`, or protocol-relative `//`.
 */
export function resolveBroadcastActionUrl(actionPath?: string | null): string | null {
  const raw = typeof actionPath === 'string' ? actionPath.trim() : '';
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return `${siteUrl()}${raw}`;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

function interpolateName(text: string, firstName: string): { text: string; usedToken: boolean } {
  let usedToken = false;
  const replaced = text.replace(NAME_TOKEN_RE, () => {
    usedToken = true;
    return firstName;
  });
  return { text: replaced, usedToken };
}

export function adminBroadcastHtml(input: AdminBroadcastInput): string {
  const lang: Lang = input.lang === 'fr' ? 'fr' : 'en';
  const firstName = firstNameOf(input.recipientName, lang);
  const { text: resolvedBody, usedToken } = interpolateName(input.body.trim(), firstName);

  const greeting = lang === 'fr'
    ? `Bonjour ${firstName},`
    : `Hi ${firstName},`;

  const paragraphs = resolvedBody
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const greetingHtml = usedToken
    ? ''
    : `<p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#122d2b;">${esc(greeting)}</p>`;

  const bodyParagraphsHtml = paragraphs
    .map((p, idx) => {
      const marginBottom = idx === paragraphs.length - 1 ? '22px' : '14px';
      const htmlLines = esc(p).replace(/\r?\n/g, '<br />');
      return `<p style="margin:0 0 ${marginBottom};font-size:14px;line-height:1.65;color:#2b3a38;">${htmlLines}</p>`;
    })
    .join('\n');

  const href = resolveBroadcastActionUrl(input.actionPath);
  const ctaLabel = (input.actionLabel?.trim() || DEFAULT_CTA_LABEL[lang]);
  const buttonHtml = href ? primaryButton(href, ctaLabel) : '';

  const signOff = lang === 'fr'
    ? 'L’équipe Groundwork by Jalla'
    : 'The Groundwork by Jalla team';

  const signOffHtml = `<p style="margin:${href ? '18px' : '8px'} 0 0;font-size:13px;line-height:1.5;color:#63686d;">${esc(signOff)}</p>`;

  return emailShell(lang, `${greetingHtml}\n${bodyParagraphsHtml}\n${buttonHtml}\n${signOffHtml}`);
}

export function adminBroadcastText(input: AdminBroadcastInput): string {
  const lang: Lang = input.lang === 'fr' ? 'fr' : 'en';
  const firstName = firstNameOf(input.recipientName, lang);
  const { text: resolvedBody, usedToken } = interpolateName(input.body.trim(), firstName);

  const greeting = lang === 'fr'
    ? `Bonjour ${firstName},`
    : `Hi ${firstName},`;

  const href = resolveBroadcastActionUrl(input.actionPath);
  const ctaLabel = (input.actionLabel?.trim() || DEFAULT_CTA_LABEL[lang]);
  const signOff = lang === 'fr'
    ? 'L’équipe Groundwork by Jalla'
    : 'The Groundwork by Jalla team';

  const parts: string[] = [];
  if (!usedToken) parts.push(greeting);
  parts.push(resolvedBody);
  if (href) parts.push(`${ctaLabel}: ${href}`);
  parts.push(signOff);
  return parts.join('\n\n');
}
