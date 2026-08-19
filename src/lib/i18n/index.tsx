import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { en } from './en';
import { LANG_META, LANGS, type Lang } from './types';
import { FRENCH_DEFAULT_COUNTRIES, translate, translatePlural, type TKey } from './translate';
import { persistPreferredLang } from './persist-lang';
import {
  formatDate, formatDateTime, formatMoney, formatNumber, formatPercent,
  formatRelative, localeFor, setFormatLocale, type DateStyle,
} from '@/lib/format';

export type { Lang } from './types';
export { LANGS, LANG_META } from './types';
export { translate, translator, resolveRecipientLang, type TKey } from './translate';

export const STORAGE_KEY = 'lang';

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
export { FRENCH_DEFAULT_COUNTRIES };

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

  /**
   * Record an explicit choice everywhere it needs to be known:
   *   localStorage — so this browser remembers on the next visit
   *   <html lang>  — so screen readers and the browser pick the right pronunciation
   *   profiles     — so *email* to this person is written in their language
   *
   * The profile write is fire-and-forget and only fires when signed in. Nobody should
   * be blocked from flipping a toggle because a network call is in flight, and an
   * anonymous visitor has no row to write to. localStorage still carries the choice
   * into the session they eventually create.
   */
  const persistChoice = useCallback((next: Lang) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LANG_META[next].htmlLang;
    }
    void persistPreferredLang(next);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistChoice(next);
  }, [persistChoice]);

  const toggle = useCallback(() => {
    setLangState(prev => {
      const next: Lang = prev === 'en' ? 'fr' : 'en';
      persistChoice(next);
      return next;
    });
  }, [persistChoice]);

  // REMOVED Aug 2026: `suggestLangForCountry`, which flipped the UI to French when a
  // project's build country was francophone. Reported by Favour — "you create your
  // project and get into the project dashboard, it changes to French even if you haven't
  // changed the language."
  //
  // It did exactly that, to everyone. Cameroon is the DEFAULT build country, so every
  // project tripped it, and the "explicit choice wins" guard only protected people who
  // had already used the toggle — almost nobody. Two further reasons not to bring it
  // back in another form: Cameroon is officially bilingual and our beta is concentrated
  // in the anglophone South-West and North-West, and the build country says nothing
  // about the reader, who is typically diaspora.
  //
  // Choosing a language for outbound email is a different problem, because there is no
  // toggle in an inbox — that still uses resolveRecipientLang in translate.ts.

  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) => {
      const out = translate(lang, key, params);
      // translate() returns the key when it is missing. Warning here rather than in
      // translate.ts keeps `import.meta` out of the serverless email path.
      if (import.meta.env.DEV && out === key) console.warn(`[i18n] missing key: ${key}`);
      return out;
    },
    [lang],
  );

  const tPlural = useCallback(
    (key: TKey, count: number, params?: Record<string, string | number>) =>
      translatePlural(lang, key, count, params),
    [lang],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, toggle, t, tPlural }),
    [lang, setLang, toggle, t, tPlural],
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
