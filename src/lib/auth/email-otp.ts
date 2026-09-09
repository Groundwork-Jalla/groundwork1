import { supabase } from '@/lib/supabase/client';

/**
 * Email as a second factor.
 *
 * ── What this is not ─────────────────────────────────────────────────────────────────
 * Not a Supabase MFA factor. Supabase supports `totp`, `phone` and `webauthn` only, so
 * there is no `factorType: 'email'` to enrol and nothing here raises the session to
 * `aal2`. See `mfa.ts` for the TOTP path, which does, and migration 080 for why this one
 * cannot.
 *
 * ── Everything that matters happens on the server ────────────────────────────────────
 * Generation, hashing, expiry, the attempt counter and the send limit all live in
 * `api/_handlers/mfa-email.ts`. This module posts and reads the answer. A second factor
 * a browser could decide the outcome of would not be one, so there is deliberately no
 * logic here to get wrong.
 */

export interface EmailChallenge {
  challengeId: string;
  expiresInMinutes: number;
}

async function post(body: Record<string, unknown>): Promise<Response | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  return fetch('/api/events?action=mfa-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Whether this account has asked for codes by email. */
export async function emailMfaEnabled(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('email_mfa_enabled')
    .eq('id', userId)
    .maybeSingle();
  return data?.email_mfa_enabled === true;
}

/** Turn it on or off. The row is the user's own, so RLS already scopes this. */
export async function setEmailMfa(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ email_mfa_enabled: enabled })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Send a code. Throws with a readable message the caller can show.
 *
 * The rate-limit refusal is deliberately surfaced rather than swallowed: someone who
 * asked five times and sees nothing needs to know it is a limit and not a bug.
 */
export async function sendEmailCode(): Promise<EmailChallenge> {
  const r = await post({ op: 'send' });
  if (!r) throw new Error('Not signed in.');

  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? 'Could not send a code.');
  return { challengeId: body.challengeId, expiresInMinutes: body.expiresInMinutes ?? 10 };
}

/** Check a code. `false` for every kind of failure — the server does not distinguish them. */
export async function verifyEmailCode(challengeId: string, code: string): Promise<boolean> {
  const r = await post({ op: 'verify', challengeId, code });
  if (!r) return false;
  return r.ok;
}

// =========================================================
// "This session has cleared its email factor"
// =========================================================
//
// TOTP does not need any of this: Supabase raises the session to `aal2` and the JWT
// carries it. Supabase has never heard of the email factor, so nothing about the session
// changes when a code is accepted, and the fact has to be held somewhere.
//
// `sessionStorage`, keyed by user id: per-tab, gone when the tab closes, and it cannot be
// carried to another browser. It is a CLIENT-SIDE gate, at exactly the enforcement level
// the app already applies to TOTP — `mfa.ts` says plainly that an aal1 session still
// carries a valid JWT and RLS will still serve it. Closing that properly means the
// `auth.jwt()->>'aal'` work described there, and it would close both factors at once.
//
// What it deliberately is not: a secret. Someone who can set it can already read the page
// that reads it.

const PASSED_KEY = (userId: string) => `gw_email_mfa_ok:${userId}`;

export function markEmailFactorPassed(userId: string): void {
  try { sessionStorage.setItem(PASSED_KEY(userId), '1'); } catch { /* private mode */ }
}

export function emailFactorPassed(userId: string): boolean {
  // A storage failure reads as "not passed", so the challenge shows again. Erring the
  // other way would let a browser with storage disabled skip the factor entirely.
  try { return sessionStorage.getItem(PASSED_KEY(userId)) === '1'; } catch { return false; }
}

export function clearEmailFactor(userId: string): void {
  try { sessionStorage.removeItem(PASSED_KEY(userId)); } catch { /* private mode */ }
}
