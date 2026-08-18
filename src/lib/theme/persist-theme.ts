import { supabase } from '@/lib/supabase/client';

export type Theme = 'light' | 'dark';

/** The key the pre-paint script in app/root.tsx reads. Must not drift from it. */
export const THEME_STORAGE_KEY = 'theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The explicit choice this browser remembers, or null if there has never been one. */
export function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;   // private mode / blocked storage
  }
}

/** What the operating system is asking for, for visitors who have never chosen. */
export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Write the choice to the user's profile so it follows the *account* rather than
 * the device — the whole point of the column. Fire-and-forget and best-effort,
 * for the same reasons as persistPreferredLang: nobody should wait on a network
 * call to flip a switch, localStorage already holds the choice for this browser,
 * and a signed-out visitor has no row to write to.
 */
export async function persistPreferredTheme(theme: Theme): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const id = data.user?.id;
    if (!id) return;
    await supabase.from('profiles').update({ preferred_theme: theme }).eq('id', id);
  } catch {
    /* offline, blocked, or the column is not migrated yet — never surface this */
  }
}

/**
 * The choice stored on the account, or null if this user has never made one.
 * Read once when a session appears, so a fresh browser inherits the preference.
 */
export async function fetchPreferredTheme(userId: string): Promise<Theme | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('preferred_theme')
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    return isTheme(data?.preferred_theme) ? data.preferred_theme : null;
  } catch {
    return null;
  }
}
