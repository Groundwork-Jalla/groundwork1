import { supabase } from '@/lib/supabase/client';
import type { Lang } from './types';

/**
 * Store an explicit language choice on the user's profile.
 *
 * Only explicit choices reach here — `suggestLangForCountry` deliberately does not
 * call it. That distinction is the whole point of the column: NULL means "never told
 * us", and the email path falls back through the build country. If a suggestion were
 * persisted, an anglophone Cameroonian who simply opened a project would be recorded
 * as having chosen French, and there would be no way to tell that apart from a real
 * preference.
 *
 * Fire-and-forget and best-effort. A failed write costs the user nothing in this
 * session — localStorage already holds the choice — and it will be rewritten the next
 * time they touch the toggle.
 */
export async function persistPreferredLang(lang: Lang): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const id = data.user?.id;
    if (!id) return;   // signed out: nothing to write to
    await supabase.from('profiles').update({ preferred_lang: lang }).eq('id', id);
  } catch {
    /* offline, blocked, or the column is not migrated yet — never surface this */
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
export async function fetchPreferredLang(userId: string): Promise<Lang | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('preferred_lang')
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    const v = data?.preferred_lang;
    return v === 'en' || v === 'fr' ? v : null;
  } catch {
    return null;
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
  local: Lang | null, remote: Lang | null,
): { adopt?: Lang; push?: Lang } {
  if (local === null) return remote ? { adopt: remote } : {};
  if (local !== remote) return { push: local };
  return {};
}
