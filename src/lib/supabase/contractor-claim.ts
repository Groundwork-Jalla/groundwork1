import { supabase } from './client';

// =========================================================
// Claiming the contractor account an approved application earned (100).
//
// The token is the capability: we mail it to the address on the application, and holding
// it is what proves you are that applicant. Nothing here is guessable and nothing here
// enumerates — an unknown token returns null, exactly like an unapproved one.
// =========================================================

/** Where the claim token waits while the applicant creates an account. */
export const PENDING_CLAIM_KEY = 'pendingContractorClaim';

export interface ClaimPreview {
  fullName: string;
  email: string;
  businessName: string | null;
  claimed: boolean;
}

/**
 * Who this link is for, readable before sign-in.
 *
 * `contractor_claim_preview` is granted to anon on purpose: a page that cannot say whose
 * invitation it is reads as a phishing link, and the applicant has no account yet.
 */
export async function getClaimPreview(token: string): Promise<ClaimPreview | null> {
  const { data, error } = await supabase
    .rpc('contractor_claim_preview', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    fullName:     String(row.full_name ?? ''),
    email:        String(row.email ?? ''),
    businessName: row.business_name ? String(row.business_name) : null,
    claimed:      row.claimed === true,
  };
}

/** Links the application and the directory listing to the signed-in account. */
export async function claimContractorAccount(token: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('claim_contractor_account', { p_token: token });
  if (error) throw error;
  return String(data);
}

/**
 * Remember the token across sign-up.
 *
 * The applicant lands here without an account, so the claim cannot run yet. Same handoff
 * the project invite uses: park it, let them create the account, and let `callback.tsx`
 * finish the job — the applicant never sees a second step.
 */
export function rememberClaim(token: string): void {
  try { localStorage.setItem(PENDING_CLAIM_KEY, token); } catch { /* private mode */ }
}

export function takeRememberedClaim(): string | null {
  try {
    const t = localStorage.getItem(PENDING_CLAIM_KEY);
    if (t) localStorage.removeItem(PENDING_CLAIM_KEY);
    return t;
  } catch { return null; }
}

/** Ask an admin to send an approved applicant their claim link. */
export async function inviteContractorToClaim(applicationId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');
  const r = await fetch('/api/send-application-decision', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId, decision: 'accepted' }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(json?.error ?? `http_${r.status}`));
}
