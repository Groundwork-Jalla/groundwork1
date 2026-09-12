import { supabase } from './client';
import { listAdminUsers } from './admin-users';
import { isMissingTable } from '@/lib/errors';

// =========================================================
// Verifiers — the independent professionals who verify stage work (migration 086).
//
// The role value `verifier` has existed in `user_roles` since migration 001 and had never
// been used. 086 gives it a domain: a profile, an assignment to a project, and sight of
// that project through `project_member()`. What a verifier DOES there — the verification
// record — is 087 and is not touched here.
//
// Every write goes through a SECURITY DEFINER RPC that re-checks the actor. The browser
// cannot insert into `project_verifiers` at all (RLS with no INSERT policy), so the two
// rules that matter — verifier must hold the role, contractor cannot verify their own
// project — are enforced by the database whatever this file does.
//
// WHO CAN BE PICKED. Anyone holding the `verifier` role, whether or not they have a
// `verifier_profiles` row yet. Granting the role and filling the profile are staff tasks
// with no UI until People → Verifiers ships (Phase 7); until then they are SQL, like
// granting `admin` is today. The picker reads roles from `admin_list_users()` so an
// assignment can be made the moment the role exists.
// =========================================================

export interface VerifierOption {
  userId: string;
  name: string;
  email: string;
}

export interface ProjectVerifier {
  id: string;
  projectId: string;
  userId: string;
  discipline: string;
  status: 'active' | 'removed';
  assignedAt: string;
}

/** Staff holding the verifier role — the assignment picker. */
export async function listVerifierOptions(): Promise<VerifierOption[]> {
  const users = await listAdminUsers();
  return users
    .filter(u => u.roles.split(',').map(r => r.trim()).includes('verifier'))
    .map(u => ({ userId: u.id, name: u.fullName, email: u.email }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

/**
 * Active assignments on a project.
 *
 * Returns an empty list — not an error — when 086 has not been applied, so the admin
 * projects page renders as it did before rather than failing on a table that is not
 * there yet. `available` tells the caller which of the two happened.
 */
export async function listProjectVerifiers(projectId: string): Promise<{ rows: ProjectVerifier[]; available: boolean }> {
  const { data, error } = await supabase
    .from('project_verifiers')
    .select('id, project_id, user_id, discipline, status, assigned_at')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return {
    available: true,
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      id:         r.id as string,
      projectId:  r.project_id as string,
      userId:     r.user_id as string,
      discipline: r.discipline as string,
      status:     r.status as 'active' | 'removed',
      assignedAt: r.assigned_at as string,
    })),
  };
}

/**
 * Assign. The guards — admin only, verifier role held, not a contractor on this project,
 * discipline required — live in `assign_verifier()` and surface as prefixed messages
 * (`not_admin:`, `not_verifier:`, `contractor_cannot_verify:`, `discipline_required:`)
 * the caller can match on. Re-assigning a removed verifier reactivates the same row.
 */
export async function assignVerifier(projectId: string, userId: string, discipline: string): Promise<string> {
  const { data, error } = await supabase.rpc('assign_verifier', {
    p_project: projectId, p_user: userId, p_discipline: discipline,
  });
  if (error) throw error;
  return data as string;
}

export async function removeVerifier(assignmentId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_verifier', { p_assignment: assignmentId });
  if (error) throw error;
}
