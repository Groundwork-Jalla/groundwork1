import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { en, type EnDict } from './en';
import { fr } from './fr';
import { LANG_META, LANGS, type DeepKeys, type Lang } from './types';

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

export { LANGS as SUPPORTED_LANGS };
