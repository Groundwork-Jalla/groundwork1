// =========================================================
// i18n types
// =========================================================

export type Lang = 'en' | 'fr';

export const LANGS: Lang[] = ['en', 'fr'];

export const LANG_META: Record<Lang, { label: string; short: string; flag: string; htmlLang: string }> = {
  en: { label: 'English',  short: 'EN', flag: '🇬🇧', htmlLang: 'en' },
  fr: { label: 'Français', short: 'FR', flag: '🇫🇷', htmlLang: 'fr' },
};

/**
 * Recursively walks a nested dictionary and produces the union of every
 * dot-separated leaf path — e.g. "nav.dashboard" | "auth.login.title".
 * This gives autocomplete on t() and turns typos into compile errors.
 */
export type DeepKeys<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : `${K}.${DeepKeys<T[K]>}`;
    }[keyof T & string];

/** A dictionary is any nesting of strings. */
export interface Dict {
  [key: string]: string | Dict;
}
