// =========================================================
// "Has anyone signed in on this browser before?"
//
// A flag set the first time anyone authenticates here. It is a hint, not a fact, and
// deliberately not a lookup: an endpoint answering "does this email have an account?"
// is an account-enumeration endpoint.
//
// Someone on a new device is sent to sign-up and someone who shares a laptop is sent
// to log-in; both pages link to the other, so the wrong guess costs one click.
//
// ── It steers "Join for Free" ONLY ──────────────────────────────────────────────────
// Not the contractor CTA beside it. That one carries `?role=contractor`, and the
// log-in page has no role selector — it would drop the parameter and land the person
// on a log-in form with no sign of the thing they clicked. So the contractor CTA
// names the sign-up page outright rather than sharing this guess.
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
 *
 * Signed out → sign-up, unless this browser has authenticated before, in which case
 * log-in is the better guess. Both pages link to the other, so a wrong guess costs one
 * click. The contractor CTA does NOT use this — see the note at the top.
 */
export function joinDestination(signedIn: boolean): string {
  if (signedIn) return '/dashboard';
  return hasAccountHere() ? '/auth/login' : '/auth/signup';
}
