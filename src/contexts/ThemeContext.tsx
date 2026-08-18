import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  THEME_STORAGE_KEY, fetchPreferredTheme, persistPreferredTheme, storedTheme, systemTheme,
  type Theme,
} from '@/lib/theme/persist-theme';

export type { Theme } from '@/lib/theme/persist-theme';

// =========================================================
// One source of truth for light/dark.
//
// This replaces a `useTheme()` hook that kept its own useState inside every
// ThemeToggle. That worked by accident: the toggles never disagreed only because
// the DOM class and localStorage were doing the real work behind them. Two
// toggles are mounted at once in the app shell (the sidebar row and the compact
// top-bar button), so flipping one left the other's icon showing the wrong state.
//
// The choice is also an *account* preference, not a device one — see
// migration 043 and lib/theme/persist-theme.ts.
// =========================================================

interface ThemeContextValue {
  /** What is on screen right now — after any forced-light page is taken into account. */
  theme: Theme;
  /** The user's own choice, ignoring forced-light pages. */
  preference: Theme;
  /** True once the user has actually chosen, rather than following the OS. */
  isExplicit: boolean;
  /** True while a light-only page is overriding the preference. */
  forcedLight: boolean;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // Matches the pre-paint script in app/root.tsx, so the first render agrees with
  // the class that script already put on <html> and nothing flashes.
  const [preference, setPreference] = useState<Theme>(() => storedTheme() ?? systemTheme());
  const [isExplicit, setIsExplicit] = useState<boolean>(() => storedTheme() !== null);

  // Ref count rather than a boolean: route changes can briefly overlap, and a
  // boolean would let the outgoing page clear the incoming page's override.
  const [forceCount, setForceCount] = useState(0);
  const forcedLight = forceCount > 0;
  const theme: Theme = forcedLight ? 'light' : preference;

  // The class is applied here and nowhere else. Any other writer would be racing
  // this effect.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Follow the OS for as long as the user has not chosen for themselves.
  useEffect(() => {
    if (isExplicit) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPreference(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [isExplicit]);

  // Adopt the account's stored choice when a session appears — this is what makes
  // the preference follow the user to a new browser or a new device.
  //
  // Only when this browser has no explicit choice of its own. Otherwise signing in
  // would undo a toggle the user had just flipped here, which reads as the switch
  // being broken. A local choice instead gets pushed up to the profile below.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;

    let cancelled = false;
    void (async () => {
      const remote = await fetchPreferredTheme(uid);
      if (cancelled) return;

      if (storedTheme() === null) {
        if (remote) {
          try { localStorage.setItem(THEME_STORAGE_KEY, remote); } catch { /* private mode */ }
          setPreference(remote);
          setIsExplicit(true);
        }
        return;
      }
      // This browser has a choice the account does not know about yet.
      const local = storedTheme();
      if (local && local !== remote) void persistPreferredTheme(local);
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const setTheme = useCallback((next: Theme) => {
    setPreference(next);
    setIsExplicit(true);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private mode */ }
    void persistPreferredTheme(next);
  }, []);

  // Toggles off the *preference*, not off what is currently painted. On a
  // forced-light page that distinction never surfaces, because those pages do not
  // render a toggle — but flipping relative to a value the user did not choose is
  // the kind of thing that only shows up later.
  const toggle = useCallback(() => {
    setPreference(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      setIsExplicit(true);
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private mode */ }
      void persistPreferredTheme(next);
      return next;
    });
  }, []);

  const pushForceLight = useCallback(() => {
    setForceCount(n => n + 1);
    return () => setForceCount(n => Math.max(0, n - 1));
  }, []);

  const value = useMemo(
    () => ({ theme, preference, isExplicit, forcedLight, setTheme, toggle }),
    [theme, preference, isExplicit, forcedLight, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ForceLightContext.Provider value={pushForceLight}>
        {children}
      </ForceLightContext.Provider>
    </ThemeContext.Provider>
  );
}

/** Separate context so useForceLight() does not re-render on every theme change. */
const ForceLightContext = createContext<(() => () => void) | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export function usePushForceLight() {
  const push = useContext(ForceLightContext);
  if (!push) throw new Error('useForceLight must be used inside <ThemeProvider>');
  return push;
}
