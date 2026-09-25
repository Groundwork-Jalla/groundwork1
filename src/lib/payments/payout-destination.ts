// =========================================================
// Where a contractor is paid (099) — pure.
//
// Two jobs, deliberately separate:
//
//   `isPayoutEligible`  the one rule for "may money be sent here", mirroring the SQL
//                       function of the same meaning so a screen and the database cannot
//                       disagree about it.
//   `maskDestination`   what a person may see on screen. NEVER what a provider is sent.
//
// A stored destination is not a usable one. `status` begins `unverified` and only a staff
// act moves it, so numbers sitting in a table never quietly become permission to send
// money to them — see the header of 099.
// =========================================================

export type PayoutMethod = 'mobile_money' | 'bank';
export type DestinationStatus = 'unverified' | 'verified' | 'retired';

export interface PayoutDestination {
  id: string;
  ownerId: string;
  countryCode: string;
  method: PayoutMethod;
  mobileNo: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  status: DestinationStatus;
  isDefault: boolean;
  createdAt: string;
  verifiedAt: string | null;
}

/**
 * May money actually be sent here?
 *
 * Verified, and dated — `verified` without `verified_at` is not a claim anybody made, and
 * 099's CHECK makes the pair inseparable. Retired is excluded by the same test, since a
 * retired row cannot be verified.
 *
 * This is the only place the question is answered on this side. A screen that decided for
 * itself would be a second rule, and the two would drift.
 */
export const isPayoutEligible = (d: Pick<PayoutDestination, 'status' | 'verifiedAt'>): boolean =>
  d.status === 'verified' && !!d.verifiedAt;

/** Why a destination cannot be used, in a form a screen can translate. */
export type Ineligibility = 'unverified' | 'retired' | null;

export function ineligibility(d: Pick<PayoutDestination, 'status' | 'verifiedAt'>): Ineligibility {
  if (isPayoutEligible(d)) return null;
  return d.status === 'retired' ? 'retired' : 'unverified';
}

/**
 * What a person may see.
 *
 * Enough to recognise their own account, not enough to be worth stealing from a
 * screenshot: the last three digits of a phone, the last four of an account. A value too
 * short to mask is masked entirely rather than shown — a two-digit "account" is either a
 * mistake or a test, and neither is worth revealing.
 *
 * Presentation only. The SwyChr layer reads the row, never this.
 */
export function maskDestination(d: Pick<PayoutDestination, 'method' | 'mobileNo' | 'accountNumber' | 'bankCode'>): string {
  if (d.method === 'mobile_money') {
    const n = (d.mobileNo ?? '').trim();
    if (n.length < 5) return '•••';
    // Keep the dialling code — it says which country, and it is not a secret.
    const cc = n.startsWith('+') ? n.slice(0, 4) : '';
    return `${cc} ${'•'.repeat(Math.max(3, n.length - cc.length - 3))}${n.slice(-3)}`.trim();
  }
  const a = (d.accountNumber ?? '').trim();
  const shown = a.length >= 6 ? a.slice(-4) : '';
  const bank = (d.bankCode ?? '').trim();
  return shown ? `${bank ? `${bank} · ` : ''}${'•'.repeat(Math.max(4, a.length - 4))}${shown}` : '•••';
}

/** The default, if there is a live one. Retired rows are never the default (099's CHECK). */
export const defaultDestination = (rows: PayoutDestination[]): PayoutDestination | null =>
  rows.find(d => d.isDefault && d.status !== 'retired') ?? null;

/** What a payout may choose from: verified, not retired, newest first. */
export const payableDestinations = (rows: PayoutDestination[]): PayoutDestination[] =>
  rows.filter(isPayoutEligible).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
