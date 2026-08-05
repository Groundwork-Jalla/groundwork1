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
