import { supabase } from '@/lib/supabase/client';

/**
 * Does this account hold the `verifier` role?
 *
 * Read from `user_roles`, which a user may read for themselves (001) — the same
 * canonical table `is_admin()` uses, rather than JWT metadata, so granting the role is
 * one insert and takes effect on the next sign-in with no token surgery.
 *
 * False on any failure: a verifier who is briefly routed to the client dashboard can
 * navigate to /verifiers themselves; a client wrongly routed into a surface they cannot
 * read would see errors.
 */
export async function holdsVerifierRole(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from('user_roles').select('role').eq('user_id', userId).eq('role', 'verifier').limit(1);
  return !error && (data?.length ?? 0) > 0;
}
