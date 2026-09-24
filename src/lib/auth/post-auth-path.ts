// Decide where to send a user immediately after they authenticate.
// Admins go to the admin panel; brand-new users to onboarding; everyone else
// to the dashboard. An explicit, safe internal `redirect` target wins over all
// of these (used to return a user to a deep link they were bounced from).
//
// Admin status is resolved by the caller via the is_admin() RPC (user_roles), and the
// verifier role by reading user_roles directly (a user may read their own rows, 001) —
// not JWT metadata. Contractor standing is an accepted `contractor_invites` row, which is
// the same question `is_contractor_on()` asks inside every RLS policy. Keep this and
// AuthContext on those canonical sources.
//
// Precedence is deliberate, not incidental: admin → verifier → contractor → client. A
// surface only wins when the one above it cannot do its job — /admin can reach everything
// /verifiers and /work can, and a contractor who is also a client is here to work.

function isSafeInternalPath(p: string | null | undefined): p is string {
  // Must be a same-origin absolute path, not a protocol-relative "//evil.com".
  return !!p && p.startsWith('/') && !p.startsWith('//');
}

export function postAuthPath(opts: {
  isAdmin?: boolean;
  /** Holds the `verifier` role (user_roles). Their surface is /verifiers, not /dashboard. */
  isVerifier?: boolean;
  /** Has an accepted contractor assignment. Their surface is /work. */
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
