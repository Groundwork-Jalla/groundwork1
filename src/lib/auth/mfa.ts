import { supabase } from '@/lib/supabase/client';
import type { Factor } from '@supabase/supabase-js';

// =========================================================
// Two-factor authentication — TOTP, via Supabase MFA.
//
// TOTP only, deliberately. SMS is the other option Supabase offers and it is the weaker
// one everywhere, but especially here: the users are diaspora clients and Cameroonian
// contractors, so an SMS second factor means international delivery to MTN and Orange
// numbers, per-message cost, and a factor that stops working the moment somebody
// travels or swaps a SIM — which is the normal state of this audience, not the edge
// case. An authenticator app works offline, on any device, in any country, for free.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────
// Enforcing MFA at the DATABASE is a separate thing and is not done here. A session that
// has not passed its second factor still carries a valid JWT, so RLS will still serve it
// — the app declines to route, but the REST endpoint would answer. Closing that means
// adding `(SELECT auth.jwt()->>'aal') = 'aal2'` to the policies that matter, for the
// users who have a factor enrolled. Worth doing before this is called a control rather
// than a convenience; see docs.
//
// ── THE ENROLMENT GOTCHAS, so nobody rediscovers them ───────────────────────────────
//   · `enroll()` creates the factor immediately, in `unverified` state. Abandoning the
//     dialog leaves it behind, and the NEXT enrolment fails on the duplicate friendly
//     name — so a user who closes the modal once can never turn 2FA on again. `enrollTotp`
//     sweeps unverified factors first.
//   · `friendly_name` must be unique per user. One fixed name plus the sweep is simpler
//     than generating names nobody will ever read.
//   · `totp.qr_code` is already an SVG data URI. There is no QR library here and none is
//     needed — it goes straight into an <img src>.
//   · The secret is shown ONCE, at enrolment. It is never retrievable afterwards.
// =========================================================

/** One factor per account. Multiple would need a picker at login for no real gain here. */
const FRIENDLY_NAME = 'Groundwork';

export interface TotpEnrolment {
  factorId: string;
  /** SVG data URI — put it straight in an `<img src>`. */
  qrCode: string;
  /** For manual entry when a camera is not available. Shown once and never again. */
  secret: string;
}

export interface MfaStatus {
  /** A verified factor exists — 2FA is on. */
  enabled: boolean;
  /** The verified factor, when there is one. */
  factor: Factor | null;
  /** This session has cleared its second factor (or never needed one). */
  satisfied: boolean;
  /** This session must present a code before it is fully authenticated. */
  challengeRequired: boolean;
}

/**
 * Does this session still owe a second factor?
 *
 * `nextLevel` above `currentLevel` is Supabase's way of saying "this user has a verified
 * factor and this session has not used it". Both being `aal1` is an account with no 2FA;
 * both `aal2` is one that has already passed.
 *
 * Errors resolve to "no challenge required" rather than throwing. This is called on the
 * login path, and a failed AAL lookup must not be able to lock everybody out of the
 * product — the failure mode of a wrong answer here is the status quo before 2FA existed.
 */
export async function challengeRequired(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
  } catch {
    return false;
  }
}

/** Everything the profile screen needs in one call. */
export async function getMfaStatus(): Promise<MfaStatus> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;

  const factor = (data?.all ?? []).find(f => f.factor_type === 'totp' && f.status === 'verified') ?? null;

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsChallenge = aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2';

  return {
    enabled: !!factor,
    factor,
    satisfied: !needsChallenge,
    challengeRequired: !!needsChallenge,
  };
}

/**
 * Remove half-finished factors.
 *
 * An `unverified` factor is the residue of an abandoned enrolment. It grants nothing —
 * only a verified factor raises AAL — but it holds the friendly name, so leaving one
 * behind is what makes the second attempt fail.
 */
async function clearUnverified(): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors();
  const stale = (data?.all ?? []).filter(f => f.status === 'unverified');
  for (const f of stale) {
    try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch { /* best effort */ }
  }
}

/** Begin enrolment: returns the QR and the secret to show once. */
export async function enrollTotp(): Promise<TotpEnrolment> {
  await clearUnverified();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: FRIENDLY_NAME,
  });
  if (error) throw error;
  if (data.type !== 'totp') throw new Error('Expected a TOTP factor');

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Finish enrolment, or clear a challenge at login. Same call for both — a code is a code.
 *
 * `challengeAndVerify` is one round trip and cannot leave a dangling challenge behind,
 * which the separate `challenge()` + `verify()` pair can when the user closes the tab
 * between them.
 */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.replace(/\D/g, ''),
  });
  if (error) throw error;
}

/** The factor a login challenge should be answered against. */
export async function verifiedFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return null;
  return (data?.all ?? []).find(f => f.factor_type === 'totp' && f.status === 'verified')?.id ?? null;
}

/**
 * Turn 2FA off.
 *
 * Supabase requires the session to be at aal2 to unenroll, which is the right rule and
 * worth stating: someone who has stolen a session that never passed the second factor
 * must not be able to remove it. The UI surfaces the refusal rather than hiding it.
 */
export async function disableTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
