import { supabase } from './client';
import { normalisePhone, isE164 } from '@/lib/phone';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/countries';

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
  const applicationId = String(data);
  // Best effort, and deliberately not awaited into the failure path: the account IS claimed,
  // and a phone number that did not carry over is a prompt later, never a failed claim.
  void carryOverApplicationPhone(applicationId);
  return applicationId;
}

/**
 * Put the number from the application onto the new contractor's profile.
 *
 * The applicant already gave us this on a nine-section form (`contractor_applications.phone`
 * is NOT NULL since 026). Asking for it again because it never reached `profiles.phone` is
 * the kind of thing that makes a platform feel unfinished — and without it the admin's
 * WhatsApp shortcut refuses `no_phone` for a contractor we have been talking to for weeks.
 *
 * ── Why the browser and not the RPC ──────────────────────────────────────────────────
 * 102 copies it in SQL only when the value needs no country knowledge (already E.164, or a
 * `00` prefix). Most applicants write theirs the way they say it — `670 00 00 00` — and
 * placing that needs the dial code AND whether the country uses a trunk prefix, which lives
 * in `src/lib/phone.ts`. Reimplementing that in plpgsql would be a second rule that drifts.
 * So SQL takes the unambiguous case and this finishes the rest, where the real normaliser is.
 *
 * Never overwrites: a contractor who has already given a number keeps it.
 */
export async function carryOverApplicationPhone(applicationId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { data: profile } = await supabase
      .from('profiles').select('phone').eq('id', user.id).maybeSingle();
    if (profile?.phone) return;

    // RLS (100) lets an applicant read their own application and no other.
    const { data: app } = await supabase
      .from('contractor_applications')
      .select('phone, country')
      .eq('id', applicationId)
      .maybeSingle();
    if (!app?.phone) return;

    const canonical = normalisePhone(String(app.phone), countryCodeOf(app.country as string | null));
    if (!isE164(canonical)) return;

    await supabase.from('profiles').update({ phone: canonical }).eq('id', user.id);
  } catch {
    // Silent on purpose. This runs after a successful claim; nothing it does should be able
    // to surface as a claim failure.
  }
}

/**
 * The application stores a country NAME ('Cameroon'), which `normalisePhone` cannot use —
 * it wants an ISO code. Resolved through the country list, falling back to the launch
 * corridor rather than guessing.
 */
function countryCodeOf(name: string | null): string {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return DEFAULT_COUNTRY_CODE;
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase();
  return COUNTRIES.find(c => c.name.toLowerCase() === n)?.code ?? DEFAULT_COUNTRY_CODE;
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
