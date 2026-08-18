// =========================================================
// "Has anyone signed in on this browser before?"
//
// The landing page's join button has to send two different people to two different
// places from the same click, and nothing on a signed-out page can tell them apart —
// the server has no idea who is looking, and asking for an email first would put a
// form in front of the one button whose job is to remove friction.
//
// So: a flag set the first time anyone authenticates here. It is a hint, not a fact.
// Someone on a new device is sent to sign-up and someone who shares a laptop is sent
// to log-in; both pages link to the other, so the wrong guess costs one click. That is
// the whole reason this is a local flag and not a lookup — a lookup that answers
// "does this email have an account?" is an account-enumeration endpoint.
//
// Deliberately no React in this file. AuthContext imports it, and a hook here would
// make that import cycle back on itself.
// =========================================================

const RETURNING_KEY = 'gw:hasAccount';

/** Called whenever a session appears, from AuthContext — so it covers email and Google alike. */
export function rememberAccount(): void {
  try { localStorage.setItem(RETURNING_KEY, '1'); } catch { /* private mode; guess sign-up */ }
}

export function hasAccountHere(): boolean {
  try { return localStorage.getItem(RETURNING_KEY) === '1'; } catch { return false; }
}

/**
 * Where the landing page's join button goes.
 *
 * Signed in already → straight past the auth pages; the landing route redirects there
 * anyway, so the button should not appear to lead somewhere else.
 */
export function joinDestination(signedIn: boolean): string {
  if (signedIn) return '/dashboard';
  return hasAccountHere() ? '/auth/login' : '/auth/signup';
}
