import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { en, type EnDict } from './en';
import { fr } from './fr';
import { LANG_META, LANGS, type DeepKeys, type Lang } from './types';
import {
  formatDate, formatDateTime, formatMoney, formatNumber, formatPercent,
  formatRelative, localeFor, setFormatLocale, type DateStyle,
} from '@/lib/format';

export type { Lang } from './types';
export { LANGS, LANG_META } from './types';

export const STORAGE_KEY = 'lang';

/** Every valid dot-path into the dictionary — "nav.dashboard", "auth.login.title", … */
export type TKey = DeepKeys<EnDict>;

const DICTS: Record<Lang, unknown> = { en, fr };

// =========================================================
// Detection
// =========================================================

/**
 * Resolve the language for this visitor, in priority order:
 *   1. An explicit prior choice in localStorage
 *   2. The browser's preferred languages (any fr-* match)
 *   3. English
 *
 * Most Cameroonian visitors arrive with a fr-* browser locale, so step 2 means
 * they land in French without ever touching the toggle.
 */
export function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch { /* private mode / blocked storage */ }

  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  for (const tag of candidates) {
    if (typeof tag === 'string' && tag.toLowerCase().startsWith('fr')) return 'fr';
  }
  return 'en';
}

// =========================================================
// Lookup + interpolation
// =========================================================

function lookup(dict: unknown, path: string): string | undefined {
  let node: unknown = dict;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * French treats 0 and 1 as singular; English treats only 1 as singular.
 * Callers opt in by providing a `{key}_plural` entry alongside `{key}`.
 */
function pluralKey(base: string, count: number, lang: Lang): string {
  const isSingular = lang === 'fr' ? Math.abs(count) < 2 : count === 1;
  return isSingular ? base : `${base}_plural`;
}

// =========================================================
// Context
// =========================================================

/**
 * Countries where we default new visitors to French unless they've chosen
 * otherwise. Cameroon is the target market — most users there are francophone.
 *
 * NOTE: Cameroon is officially *bilingual*; roughly a fifth of the population
 * (Northwest / Southwest regions) is anglophone. So this is a DEFAULT, never a
 * lock — the toggle stays available everywhere and an explicit choice always
 * wins, on this visit and every future one.
 */
export const FRENCH_DEFAULT_COUNTRIES = ['CM'];

/** True when the user has already made an explicit language choice. */
export function hasExplicitLangChoice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'fr';
  } catch {
    return false;
  }
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggle: () => void;
  /**
   * Suggest French for a francophone-market country — used when a project's
   * build country becomes known. No-op if the user has already chosen a
   * language, so it can never override an explicit preference.
   */
  suggestLangForCountry: (countryCode: string | null | undefined) => void;
  /** Translate a key, with optional {placeholder} interpolation. */
  t: (key: TKey, params?: Record<string, string | number>) => string;
  /** Translate with English/French plural rules driven by `count`. */
  tPlural: (key: TKey, count: number, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  // Keep the bare formatters in '@/lib/format' in step. Components should use
  // useFormat() so they re-render on a toggle; this covers the non-component callers
  // (PDF export, and anything computing a string outside the tree).
  useEffect(() => { setFormatLocale(lang); }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LANG_META[next].htmlLang;
    }
  }, []);

  const toggle = useCallback(() => {
    setLangState(prev => {
      const next: Lang = prev === 'en' ? 'fr' : 'en';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      if (typeof document !== 'undefined') {
        document.documentElement.lang = LANG_META[next].htmlLang;
      }
      return next;
    });
  }, []);

  const suggestLangForCountry = useCallback((countryCode: string | null | undefined) => {
    if (!countryCode) return;
    // An explicit choice always wins — never override the user.
    if (hasExplicitLangChoice()) return;
    if (!FRENCH_DEFAULT_COUNTRIES.includes(countryCode.toUpperCase())) return;

    setLangState(prev => {
      if (prev === 'fr') return prev;
      if (typeof document !== 'undefined') {
        document.documentElement.lang = LANG_META.fr.htmlLang;
      }
      return 'fr';
    });
    // Deliberately NOT persisted — this is a suggestion, not a choice. If the
    // user flips the toggle, that gets stored and wins from then on.
  }, []);

  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) => {
      // Fall back to English, then to the raw key, so a missing translation
      // degrades to readable text rather than a blank screen.
      const hit = lookup(DICTS[lang], key) ?? lookup(en, key);
      if (hit === undefined) {
        if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
        return key;
      }
      return interpolate(hit, params);
    },
    [lang],
  );

  const tPlural = useCallback(
    (key: TKey, count: number, params?: Record<string, string | number>) => {
      const resolved = pluralKey(key, count, lang);
      const hit = lookup(DICTS[lang], resolved)
        ?? lookup(DICTS[lang], key)
        ?? lookup(en, resolved)
        ?? lookup(en, key);
      if (hit === undefined) return key;
      return interpolate(hit, { count, ...params });
    },
    [lang],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, toggle, suggestLangForCountry, t, tPlural }),
    [lang, setLang, toggle, suggestLangForCountry, t, tPlural],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// =========================================================
// Hooks
// =========================================================

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

/** Shorthand for components that only need the translate function. */
export function useT() {
  return useLanguage().t;
}

/**
 * Locale-aware formatters bound to the current language.
 *
 * Prefer this over the bare functions in '@/lib/format' inside components: it is
 * derived from context, so toggling the language re-renders the figures. A component
 * that imports `formatUSD` directly will keep showing the old locale until something
 * else re-renders it.
 *
 *   const f = useFormat();
 *   f.money(42500)            // $42,500.00  ·  42 500,00 $US
 *   f.date(stage.completed_at) // 3 Aug 2026  ·  3 août 2026
 */
export function useFormat() {
  const { lang } = useLanguage();
  return useMemo(() => {
    const locale = localeFor(lang);
    return {
      locale,
      money:    (amount: number, currency = 'USD') => formatMoney(amount, currency, locale),
      number:   (value: number, options?: Intl.NumberFormatOptions) =>
                  formatNumber(value, locale, options),
      percent:  (value: number, fractionDigits = 0) => formatPercent(value, locale, fractionDigits),
      date:     (value: Parameters<typeof formatDate>[0], style: DateStyle = 'medium') =>
                  formatDate(value, style, locale),
      dateTime: (value: Parameters<typeof formatDateTime>[0]) => formatDateTime(value, locale),
      relative: (value: Parameters<typeof formatRelative>[0]) => formatRelative(value, locale),
    };
  }, [lang]);
}

export { LANGS as SUPPORTED_LANGS };
