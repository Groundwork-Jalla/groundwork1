// Decide where to send a user immediately after they authenticate.
// Admins go to the admin panel; brand-new users to onboarding; everyone else
// to the dashboard. An explicit, safe internal `redirect` target wins over all
// of these (used to return a user to a deep link they were bounced from).
//
// Admin status is resolved by the caller via the is_admin() RPC (user_roles), and the
// verifier role by reading user_roles directly (a user may read their own rows, 001) —
// not JWT metadata. Keep both this and AuthContext on that canonical source.

function isSafeInternalPath(p: string | null | undefined): p is string {
  // Must be a same-origin absolute path, not a protocol-relative "//evil.com".
  return !!p && p.startsWith('/') && !p.startsWith('//');
}

export function postAuthPath(opts: {
  isAdmin?: boolean;
  /** Holds the `verifier` role (user_roles). Their surface is /verifiers, not /dashboard. */
  isVerifier?: boolean;
  onboardingComplete?: boolean;
  redirect?: string | null;
}): string {
  if (isSafeInternalPath(opts.redirect)) return opts.redirect;
  if (opts.isAdmin) return '/admin';
  // A verifier is not a client: the client dashboard shows them nothing they can act on.
  // Admin wins when someone is both, because /admin can do everything /verifiers can.
  if (opts.isVerifier) return '/verifiers';
  if (!opts.onboardingComplete) return '/onboarding';
  return '/dashboard';
}
