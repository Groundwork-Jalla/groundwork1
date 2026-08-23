/**
 * Remembers the last auth email this browser asked for, so a failed link can offer to
 * send another one instead of a dead end.
 *
 * Two problems make this necessary, both visible from the /auth/callback error page:
 *
 *   1. **We cannot tell what the link was for.** A PKCE link arrives as `?code=…` with
 *      no `type`, so a spent password reset and a spent signup confirmation look
 *      identical. Offering "confirm your email" to someone resetting a password — which
 *      is what happened — sends them to the signup page for an account they already have.
 *   2. **We do not know the address.** Resending needs one, and Supabase's error redirect
 *      carries nothing but the reason.
 *
 * Both are answered by what this browser did a minute ago. When the request was started
 * somewhere else — the classic laptop-then-phone — there is nothing stored and the page
 * falls back to sending them to the right form, which is the honest outcome.
 *
 * Not a security boundary: it holds an address the person just typed, and every action it
 * enables is one anyone can take from the public forms anyway.
 */

export type AuthEmailFlow = 'signup' | 'recovery';

interface StoredRequest {
  flow: AuthEmailFlow;
  email: string;
  at: number;
}

const KEY = 'auth.lastEmailRequest';

/** Matches Supabase's default link lifetime; a staler record would only mislead. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function rememberEmailRequest(flow: AuthEmailFlow, email: string): void {
  try {
    const record: StoredRequest = { flow, email, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* private mode — the page falls back to a plain link */
  }
}

export function readEmailRequest(): { flow: AuthEmailFlow; email: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<StoredRequest>;
    if (record.flow !== 'signup' && record.flow !== 'recovery') return null;
    if (typeof record.email !== 'string' || !record.email) return null;
    if (typeof record.at !== 'number' || Date.now() - record.at > MAX_AGE_MS) return null;
    return { flow: record.flow, email: record.email };
  } catch {
    return null;
  }
}

export function forgetEmailRequest(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
}
