import { useAuth } from '@/contexts/AuthContext';
import { joinDestination } from '@/lib/auth/returning-user';

/**
 * The href for the landing page's "Sign up to Groundwork" button.
 *
 * Reads the session rather than the storage flag alone, so a signed-in visitor is not
 * shown a route that would immediately bounce them. See lib/auth/returning-user.ts for
 * why the signed-out case is a local guess.
 */
export function useJoinDestination(): string {
  const { session } = useAuth();
  return joinDestination(!!session);
}
