import { en, type EnDict } from './en';
import { fr } from './fr';
import type { DeepKeys, Lang } from './types';

/** Every valid dot-path into the dictionary — "nav.dashboard", "auth.login.title", … */
export type TKey = DeepKeys<EnDict>;

const DICTS: Record<Lang, unknown> = { en, fr };

export function lookup(dict: unknown, path: string): string | undefined {
  let node: unknown = dict;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * French treats 0 and 1 as singular; English treats only 1 as singular.
 * Callers opt in by providing a `{key}_plural` entry alongside `{key}`.
 */
export function pluralKey(base: string, count: number, lang: Lang): string {
  const isSingular = lang === 'fr' ? Math.abs(count) < 2 : count === 1;
  return isSingular ? base : `${base}_plural`;
}

/**
 * Translate outside React.
 *
 * `useT()` is the right tool inside components — it re-renders on a toggle. This is for
 * the places that have no component tree and no "current" language of their own:
 *
 *   - **Email bodies.** The language is the *recipient's*, not the sender's. An admin
 *     working in English approving a stage for a francophone owner must send French.
 *   - **PDF exports and certificates.** Generated once and stored or downloaded; there
 *     is no re-render later, so the language is baked in at generation time.
 *
 * Because of that, `lang` is an explicit argument here rather than module state. A
 * module-level "current language" would be read from whatever the last render happened
 * to set, which is exactly the wrong answer for an email.
 */
export function translate(
  lang: Lang,
  key: TKey,
  params?: Record<string, string | number>,
): string {
  // Fall back to English, then to the raw key, so a missing translation degrades to
  // readable text rather than a blank line in someone's inbox.
  // NOTE: no `import.meta` in this file. It is imported by the email builders, which
  // are in turn imported by api/send-invite.ts — a Vercel serverless function. If that
  // is emitted as CJS, `import.meta` is a *parse* error, not something a guard catches.
  // The dev-time missing-key warning lives in the React provider instead.
  const hit = lookup(DICTS[lang], key) ?? lookup(en, key);
  if (hit === undefined) return key;
  return interpolate(hit, params);
}

/** Plural-aware translate. See `pluralKey` for the English/French rule. */
export function translatePlural(
  lang: Lang,
  key: TKey,
  count: number,
  params?: Record<string, string | number>,
): string {
  const resolved = pluralKey(key, count, lang);
  const dict = DICTS[lang];
  const hit = lookup(dict, resolved)
    ?? lookup(dict, key)
    ?? lookup(en, resolved)
    ?? lookup(en, key);
  if (hit === undefined) return key;
  return interpolate(hit, { count, ...params });
}

/** Bind `translate` to one language — handy when a builder makes dozens of calls. */
export function translator(lang: Lang) {
  return (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params);
}

/**
 * The language to use for someone we are sending to, rather than the one the sender is
 * looking at.
 *
 * `preferred_lang` is only written when a user explicitly picks a language, so NULL is
 * genuinely "we don't know" — not "English". Falling back through the build country
 * mirrors the in-app default, which matters because Cameroon is the primary market and
 * most users there never touch the toggle.
 *
 * Cameroon is officially bilingual, so this stays a default: the moment someone uses
 * the toggle, their explicit choice is stored and wins from then on.
 */
export function resolveRecipientLang(
  preferredLang: string | null | undefined,
  countryCode?: string | null,
): Lang {
  if (preferredLang === 'en' || preferredLang === 'fr') return preferredLang;
  if (countryCode && FRENCH_DEFAULT_COUNTRIES.includes(countryCode.toUpperCase())) return 'fr';
  return 'en';
}

/**
 * Countries where we default to French absent an explicit choice. Kept here rather than
 * in index.tsx so the server-side email path can reach it without pulling in React.
 */
export const FRENCH_DEFAULT_COUNTRIES = ['CM'];
