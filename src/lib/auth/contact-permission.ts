import { supabase } from '@/lib/supabase/client';

// =========================================================
// May the Groundwork team call or text this person? (migration 20261117000200)
//
// Rule 9 of the activation communication flow lets staff follow up by phone or text
// only "where contact permissions allow it". This is that permission. It is separate
// from email reminders (which have their own unsubscribe link) and from automated
// WhatsApp messages (which have their own opt-in on the profile page).
//
// Three states, and the difference matters: `true`, `false`, and `null` for "never
// asked". Staff treat `null` like `false`; the product treats it as a question still
// to put to the person.
// =========================================================

export type ContactPermissionSource = 'signup' | 'sign_in' | 'profile';

/** Narrow what came back from browser-written signup metadata. */
export function contactPermissionOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * What to do for a signed-in person, given what is recorded and what their signup form
 * carried. A recorded answer always wins; a signup answer is copied over silently; with
 * neither, the person is asked.
 */
export function contactPermissionNext(recorded: boolean | null, fromSignup: boolean | null): 'done' | 'record_signup' | 'ask' {
  if (recorded !== null) return 'done';
  return fromSignup !== null ? 'record_signup' : 'ask';
}

/**
 * The recorded answer, `null` when never given, or `undefined` when it cannot be known:
 * the read failed or the migration is not applied. Never ask on `undefined`: asking on
 * every page load because a column is missing is worse than not asking.
 */
export async function fetchContactPermission(userId: string): Promise<boolean | null | undefined> {
  const { data, error } = await supabase.from('profiles').select('contact_permission').eq('id', userId).maybeSingle();
  if (error || !data) return undefined;
  const value = (data as { contact_permission?: unknown }).contact_permission;
  return typeof value === 'boolean' ? value : value === null ? null : undefined;
}

export async function setContactPermission(allowed: boolean, source: ContactPermissionSource): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_contact_permission', { p_allowed: allowed, p_source: source });
  if (error) throw error;
  const value = (data as { contact_permission?: unknown } | null)?.contact_permission;
  if (typeof value !== 'boolean') throw new Error('contact_permission_unavailable');
  return value;
}

/** "Ask me later" lasts until the next sign-in in this browser, never longer. */
const LATER_KEY = (userId: string) => `gw:contactPermissionLater:${userId}`;
export function askedLaterThisSession(userId: string): boolean {
  try { return sessionStorage.getItem(LATER_KEY(userId)) === '1'; } catch { return false; }
}
export function askLaterThisSession(userId: string): void {
  try { sessionStorage.setItem(LATER_KEY(userId), '1'); } catch { /* the question simply returns next page load */ }
}
