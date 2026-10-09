import { supabase } from './client';

// =========================================================
// Claiming the verifier account an invitation earned (105).
//
// The mirror of contractor-claim.ts, and deliberately the same shape: Jalla interviews the
// engineer, an admin invites the address, and the token we mail is what proves the person
// opening it is the one we interviewed. Nothing here is guessable and nothing here
// enumerates — an unknown token returns null, exactly like a withdrawn one.
//
// Why a verifier is invited rather than left to sign up: a verifier's decision is what
// releases a stage payment (087, 090), and `approve_stage` never asks how the role was
// obtained. An open page granting it would mean anyone held it until we checked.
// =========================================================

/** Where the invitation token waits while the engineer creates an account. */
export const PENDING_VERIFIER_CLAIM_KEY = 'pendingVerifierClaim';

export interface VerifierInvitePreview {
  fullName: string;
  email: string;
  claimed: boolean;
}

/**
 * Who this link is for, readable before sign-in.
 *
 * `verifier_invite_preview` is granted to anon on purpose: the invitee has no account yet,
 * and a page that cannot name whose invitation it is reads as a phishing link.
 */
export async function getVerifierInvitePreview(token: string): Promise<VerifierInvitePreview | null> {
  const { data, error } = await supabase.rpc('verifier_invite_preview', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    fullName: String(row.full_name ?? ''),
    email:    String(row.email ?? ''),
    claimed:  row.claimed === true,
  };
}

/** Links the invitation to the signed-in account and grants the verifier role. */
export async function claimVerifierAccount(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('claim_verifier_account', { p_token: token });
  if (error) throw error;
  return String(data);
}

/**
 * Remember the token across sign-up.
 *
 * Sign-up ends on "check your email", so the session is established in a DIFFERENT tab by
 * /auth/callback — which never sees this page's URL. Park it, let them create the account,
 * and let the callback finish the job; the engineer never sees a second step.
 *
 * A separate key from the contractor claim, not a shared one: someone who is both an
 * approved contractor and an invited verifier would otherwise have one claim silently
 * overwrite the other, and the lost one would look like an invitation that never worked.
 */
export function rememberVerifierClaim(token: string): void {
  try { localStorage.setItem(PENDING_VERIFIER_CLAIM_KEY, token); } catch { /* private mode */ }
}

export function takeRememberedVerifierClaim(): string | null {
  try {
    const t = localStorage.getItem(PENDING_VERIFIER_CLAIM_KEY);
    if (t) localStorage.removeItem(PENDING_VERIFIER_CLAIM_KEY);
    return t;
  } catch { return null; }
}

/** Ask the server to invite an interviewed engineer. Returns nothing the browser may keep. */
export async function inviteVerifier(email: string, fullName: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');
  const r = await fetch('/api/events?action=invite-verifier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, fullName }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(json?.error ?? `http_${r.status}`));
}

// ── Signing up without an invitation (108) ────────────────────────────────────────────
//
// 105's invitation still exists and is still the right tool when Jalla reaches out first
// — the page can greet the engineer by name. This is the other door, the same one the
// contractor has: an engineer we already know opens /verifier-signup and signs up.
//
// Open by decision, and narrower than it sounds. The role shows an empty /verifiers and
// nothing else: reaching a project needs a `project_verifiers` row, that table has no
// write policy for anybody, and the only thing that writes one is `assign_verifier`
// (086), which refuses anyone who is not an admin. Putting a named verifier on a named
// project remains entirely a staff act.

/** Set when somebody signed up at /verifier-signup with no invitation to claim. */
export const PENDING_VERIFIER_REGISTER_KEY = 'pendingVerifierRegister';

export function rememberVerifierRegistration(): void {
  try { localStorage.setItem(PENDING_VERIFIER_REGISTER_KEY, '1'); } catch { /* private mode */ }
}

export function takeRememberedVerifierRegistration(): boolean {
  try {
    const v = localStorage.getItem(PENDING_VERIFIER_REGISTER_KEY);
    if (v) localStorage.removeItem(PENDING_VERIFIER_REGISTER_KEY);
    return v === '1';
  } catch { return false; }
}

/**
 * Grant the signed-in account the verifier role.
 *
 * Idempotent, and writes one audit row the first time only. The marker above decides
 * WHETHER this runs, not whether it is permitted: the RPC is open to any signed-in user,
 * which is what a bare URL means. A client signing up normally never reaches it because
 * nothing parks the marker.
 */
export async function registerVerifierAccount(): Promise<void> {
  const { error } = await supabase.rpc('register_verifier_account');
  if (error) throw error;
}
