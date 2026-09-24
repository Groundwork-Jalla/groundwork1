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

/**
 * Does this account have contractor standing on Groundwork?
 *
 * Assignment, not a role grant. A contractor IS someone with at least one accepted
 * `contractor_invites` row — that is what `is_contractor_on()` checks inside every RLS
 * policy (086), so gating the surface on anything else would let someone through a door
 * that every read behind it then refuses. `user_roles.role = 'contractor'` exists as a
 * value (001) but is not what the data layer enforces, and a contractor who was never
 * granted it would be locked out of their own work.
 *
 * Deliberately NOT `user_metadata.role === 'contractor'`, which `dashboard.tsx` still
 * reads: user metadata is client-writable and is not an authorisation boundary.
 *
 * `contractors_read_own_invites` (20260714000000) scopes this read to the caller's own
 * rows, so it cannot enumerate anyone else's assignments.
 */
export async function holdsContractorAssignment(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from('contractor_invites')
    .select('project_id')
    .eq('contractor_user_id', userId)
    .eq('status', 'accepted')
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}
