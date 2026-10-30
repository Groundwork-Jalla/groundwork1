import { useAuth } from '@/contexts/AuthContext';

// =========================================================
// Where "home" is for the person who is signed in.
//
// Philip, 29 October: clicking the logo while signed in "redirected users to the
// client dashboard incorrectly". Every surface had its own idea of home — the
// portal shells knew theirs, but the marketing nav, the footer and the landing
// route all sent everybody to `/dashboard`, which is the CLIENT app. A contractor
// who clicked the logo on a public page was moved into somebody else's product.
//
// One answer, in one place, so the next surface to need it cannot invent a
// different one.
// =========================================================

/** The surfaces, most specific first: somebody can hold more than one role. */
export function homePathFor(roles: {
  isAdmin: boolean; isVerifier: boolean; isContractor: boolean;
}): string {
  if (roles.isAdmin) return '/admin';
  if (roles.isContractor) return '/work';
  if (roles.isVerifier) return '/verifiers';
  return '/dashboard';
}

/**
 * Home for the signed-in user, or null while we do not yet know.
 *
 * Null matters: redirecting on a half-read role is how somebody ends up on the
 * wrong surface and has to navigate back. Callers wait rather than guess.
 */
export function useHomePath(): string | null {
  const { session, isAdmin, isVerifier, isContractor, rolesChecked, loading } = useAuth();
  if (loading) return null;
  if (!session) return '/';
  if (!rolesChecked) return null;
  return homePathFor({ isAdmin, isVerifier, isContractor });
}
