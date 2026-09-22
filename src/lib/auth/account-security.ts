import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { emailMfaEnabled } from './email-otp';

// =========================================================
// What an account has, and what it is still missing.
//
// Two questions the dashboard warning, the Account tab and the Google sign-in prompt
// all ask, answered in one place so they cannot disagree:
//
//   · Does this person have a password? Someone who signed up with Google has none, so
//     if Google is ever unavailable to them — a lost phone, a suspended Google account —
//     they have no way in, and "Forgot password?" is the only path to making one. The
//     app asks them to set one instead of waiting for that day.
//   · Is a second factor on? Either kind counts: the authenticator app (Supabase MFA)
//     or the code by email (ours, migration 080).
// =========================================================

/** After updateUser({ password }) succeeds; see new-password.tsx. */
export const PASSWORD_SET_MARKER = 'password_set_at';

/**
 * Supabase records an `email` identity for anyone who signed up with a password. Whether
 * it adds one when an OAuth-only account later SETS a password has varied between GoTrue
 * versions, so the page that sets one also stamps user_metadata, and either signal counts.
 */
export function hasPassword(user: Pick<User, 'identities' | 'user_metadata'> | null | undefined): boolean {
  if (!user) return false;
  if (user.identities?.some(i => i.provider === 'email')) return true;
  return typeof user.user_metadata?.[PASSWORD_SET_MARKER] === 'string';
}

/** Signed in through Google and never made a password. */
export function googleWithoutPassword(user: Pick<User, 'identities' | 'user_metadata'> | null | undefined): boolean {
  if (!user) return false;
  const viaGoogle = user.identities?.some(i => i.provider === 'google') ?? false;
  return viaGoogle && !hasPassword(user);
}

/** True when either second factor is on for this account. */
export async function secondFactorEnabled(userId: string): Promise<boolean> {
  const [{ data }, email] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    emailMfaEnabled(userId).catch(() => false),
  ]);
  const totp = (data?.all ?? []).some(f => f.factor_type === 'totp' && f.status === 'verified');
  return totp || email;
}

// ── "Not now" on the Google password prompt ──────────────────────────────────────
//
// Per browser session: they are asked again next time they sign in, not on every page.

const dismissKey = (userId: string) => `gw_pw_prompt_dismissed:${userId}`;

export function dismissPasswordPrompt(userId: string): void {
  try { sessionStorage.setItem(dismissKey(userId), '1'); } catch { /* private mode */ }
}

export function passwordPromptDismissed(userId: string): boolean {
  try { return sessionStorage.getItem(dismissKey(userId)) === '1'; } catch { return false; }
}

// ── Changing the sign-in email ───────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ask Supabase to move the account to a new address.
 *
 * Nothing changes here and now: Supabase emails a confirmation link to the NEW address
 * (and, with "secure email change" on — the default — one to the current address too,
 * both of which must be clicked). Until then `user.email` is unchanged and `user.new_email`
 * holds the pending one. The link lands on /auth/callback as `type=email_change`, which
 * it already handles, and the profiles.email mirror follows by trigger (migration 025).
 */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('invalid_email');
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${window.location.origin}/auth/callback?flow=email_change` },
  );
  if (error) throw error;
}

/**
 * Push a confirmed email change to the CRM now, rather than waiting for the backlog.
 *
 * The database has already queued it (migration 095) — this is the prompt attempt, and
 * it never blocks the sign-in: a CRM outage is the admin backlog's problem, not the
 * user's. Safe to call when nothing is pending; the server answers `sent: 0`.
 */
export async function syncEmailChangeToCrm(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/events?action=crm-email-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
  } catch {
    /* Best effort. The outbox row is what guarantees delivery, not this call. */
  }
}
