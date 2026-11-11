import { supabase } from '@/lib/supabase/client';
import type { Lang } from './types';

/** Save the language actually used by the account, including its initial UI language. */
export async function persistPreferredLang(lang: Lang): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    const id = data.user?.id;
    if (!id) return false;
    const { error } = await supabase.from('profiles').update({ preferred_lang: lang }).eq('id', id);
    return !error;
  } catch {
    // The next auth refresh reconciles again; invitations also carry the current UI.
    return false;
  }
}

/**
 * The choice stored on the account, or null if this user has never made one.
 *
 * Read once when a session appears, so a fresh browser inherits the preference —
 * the half that `persistPreferredLang` was missing. The column has been written on
 * every explicit toggle since 025, but until now nothing ever read it back into the
 * UI: a contractor who chose French on a laptop got English on their phone, and
 * clearing site data silently reverted them. Only `resolveRecipientLang` consulted
 * it, so their *email* was French while the screen in front of them was not.
 */
export async function fetchPreferredLang(userId: string): Promise<Lang | null | undefined> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('preferred_lang')
      .eq('id', userId)
      .maybeSingle();
    if (error) return undefined;
    const v = data?.preferred_lang;
    return v === 'en' || v === 'fr' ? v : null;
  } catch {
    return undefined;
  }
}

/**
 * Call back with the signed-in user's id, now and whenever it changes.
 *
 * LanguageProvider sits ABOVE AuthProvider in root.tsx — deliberately, so the error
 * boundary can still be translated — which means it cannot reach useAuth() the way
 * ThemeProvider does. Subscribing to Supabase directly keeps that ordering intact.
 */
export function onAuthUser(cb: (userId: string | null) => void): () => void {
  let active = true;
  void supabase.auth.getUser()
    .then(({ data }) => { if (active) cb(data.user?.id ?? null); })
    .catch(() => { /* signed out, offline: nothing to adopt */ });

  const { data } = supabase.auth.onAuthStateChange((_e, session) => {
    if (active) cb(session?.user?.id ?? null);
  });
  return () => { active = false; data.subscription.unsubscribe(); };
}

/**
 * What to do when a session appears and the device and the account disagree.
 *
 *   adopt — apply this language to the UI and remember it on this device
 *   push  — write this language up to the profile
 *
 * The rule is that an explicit choice on THIS device always wins, because signing in
 * must never undo a toggle somebody just pressed; an account preference is adopted
 * only by a browser that has never been told anything. Kept pure and separate from
 * the effect that calls it so the precedence is actually testable.
 */
export function reconcileLang(
  local: Lang | null, remote: Lang | null, detected: Lang = 'en',
): { adopt?: Lang; push?: Lang } {
  if (local === null) return remote ? { adopt: remote } : { push: detected };
  if (local !== remote) return { push: local };
  return {};
}
