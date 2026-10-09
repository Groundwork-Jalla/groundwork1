// Decide where to send a user immediately after they authenticate.
// Admins go to the admin panel; brand-new users to onboarding; everyone else
// to the dashboard. An explicit, safe internal `redirect` target wins over all
// of these (used to return a user to a deep link they were bounced from).
//
// Admin status is resolved by the caller via the is_admin() RPC (user_roles), and the
// verifier role by reading user_roles directly (a user may read their own rows, 001) —
// not JWT metadata. Contractor standing is a canonical contractor role or an accepted
// assignment. Project access is still enforced separately by database policies.
//
// Precedence is deliberate, not incidental: admin → verifier → contractor → client. A
// surface only wins when the one above it cannot do its job — /admin can reach everything
// /verifiers and /work can, and a contractor who is also a client is here to work.

/**
 * Where sign-up parks the destination while the person goes to their email.
 *
 * Sign-up finishes on "check your email"; the session is then established in another tab by
 * /auth/callback, which never sees the original URL. Written only after isSafeInternalPath,
 * and read back through postAuthPath, which checks it again — a value that sat in storage is
 * not more trustworthy for having waited.
 */
export const PENDING_REDIRECT = 'pendingRedirect';

export function isSafeInternalPath(p: string | null | undefined): p is string {
  // Must be a same-origin absolute path, not a protocol-relative "//evil.com".
  return !!p && p.startsWith('/') && !p.startsWith('//');
}

export function postAuthPath(opts: {
  isAdmin?: boolean;
  /** Holds the `verifier` role (user_roles). Their surface is /verifiers, not /dashboard. */
  isVerifier?: boolean;
  /** Has the contractor role or an accepted assignment. Their surface is /work. */
  isContractor?: boolean;
  onboardingComplete?: boolean;
  redirect?: string | null;
}): string {
  if (isSafeInternalPath(opts.redirect)) return opts.redirect;
  if (opts.isAdmin) return '/admin';
  // A verifier is not a client: the client dashboard shows them nothing they can act on.
  // Admin wins when someone is both, because /admin can do everything /verifiers can.
  if (opts.isVerifier) return '/verifiers';
  // A contractor lands on their own work, not the client dashboard, which shows them
  // nothing they can act on. Onboarding is a CLIENT step — someone invited to build on
  // somebody else's project has no build of their own to set up — so it is checked after.
  if (opts.isContractor) return '/work';
  if (!opts.onboardingComplete) return '/onboarding';
  return '/dashboard';
}

/**
 * The sign-up link on the sign-in page, carrying whatever the person was trying to reach.
 *
 * Someone bounced from /work or /verifiers who has no account yet used to be dropped onto a
 * bare client sign-up with no memory of their destination — which is what made the sign-up
 * link look broken and the two surfaces look identical. An unsafe redirect is dropped here
 * rather than passed on, so nothing downstream has to decide whether to trust it; the
 * invite token travels for the same reason the redirect does.
 */
export function signupHref(opts: { redirect?: string | null; invite?: string | null }): string {
  const q = new URLSearchParams();
  if (isSafeInternalPath(opts.redirect)) q.set('redirect', opts.redirect);
  if (opts.invite) q.set('invite', opts.invite);
  const s = q.toString();
  return s ? `/auth/signup?${s}` : '/auth/signup';
}
