import { ACCOUNT_ROLE_CHANGED, roleAssignmentMatches, type AccountRole } from '@/lib/auth/account-role';
import { supabase } from './client';

// =========================================================
// Admin user directory
//
// Email lives in auth.users, which the browser cannot read and should not be able
// to. `admin_list_users()` (migration 032) is the narrow exception: SECURITY DEFINER
// so it can reach auth.users, with is_admin() re-checked inside.
//
// The admin project/review/budget screens used to embed `profiles!inner(...)` off
// `projects` to get the owner. PostgREST cannot infer that relationship — the FK on
// projects.user_id points at auth.users, not profiles — so those requests 400'd and,
// because the pages ignored `error`, rendered as empty lists. They now resolve owners
// through this directory and merge client-side, which also means a project whose owner
// has no profile row still appears instead of being silently dropped by the `!inner`.
// =========================================================

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  country: string;
  /** Comma-joined roles from user_roles. Empty string for a plain client. */
  roles: string;
  /** Tier of their most recent project; null when they have none. */
  tier: string | null;
  /** How many projects they own — all of which die with the account. */
  projectCount: number;
  createdAt: string;
  /** The admin who created the account for them; null for a self sign-up. */
  provisionedBy: string | null;
  /** Still on the temporary password the admin handed over (migration 083). */
  mustChangePassword: boolean;
  lastSignInAt: string | null;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function setUserRole(userId: string, role: AccountRole, expectedRoles: string): Promise<string> {
  return (await setUserRoleDetailed(userId, role, expectedRoles)).roles;
}

export interface UserRoleChange {
  roles: string;
  correctedProjects: string[];
  reviewProjects: string[];
  notificationQueued: boolean;
}

export async function setUserRoleDetailed(userId: string, role: AccountRole, expectedRoles: string): Promise<UserRoleChange> {
  const { data, error } = await supabase.rpc('admin_set_user_role', { p_user: userId, p_role: role, p_expected_roles: expectedRoles });
  if (error) throw error;
  if (data?.user_id !== userId || data.role !== role || typeof data.roles !== 'string' || !roleAssignmentMatches(data.roles, role)) throw new Error('account_role_update_failed');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ACCOUNT_ROLE_CHANGED, { detail: { userId } }));
  const projects = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) : [];
  return { roles: data.roles, correctedProjects: projects(data.corrected_projects), reviewProjects: projects(data.review_projects), notificationQueued: typeof data.notification_id === 'string' };
}

export type AccountType = 'client' | 'contractor';
export function accountType(roles: string): AccountType {
  return roles.split(',').some(role => role.trim() === 'contractor') ? 'contractor' : 'client';
}
export async function setAccountType(userId: string, type: AccountType, expected: AccountType): Promise<string> {
  const { data, error } = await supabase.rpc('admin_set_account_type', {
    p_user: userId, p_type: type, p_expected_type: expected,
  });
  if (error) throw error;
  if (typeof data?.roles !== 'string' || data.account_type !== type) throw new Error('account_type_update_failed');
  return data.roles;
}

export function mergeUserProjectCounts(
  users: AdminUser[],
  memberships: {
    owned: { id: string; user_id: string | null }[];
    invites: { project_id: string | null; contractor_id: string | null }[];
    viewers: { project_id: string | null; user_id: string | null }[];
  },
): AdminUser[] {
  const byUser = new Map<string, Set<string>>();
  const add = (uid: string | null | undefined, pid: string | null | undefined) => {
    if (!uid || !pid) return;
    let set = byUser.get(uid);
    if (!set) {
      set = new Set<string>();
      byUser.set(uid, set);
    }
    set.add(pid);
  };

  for (const row of memberships.owned) add(row.user_id, row.id);
  for (const row of memberships.invites) add(row.contractor_id, row.project_id);
  for (const row of memberships.viewers) add(row.user_id, row.project_id);

  return users.map(u => {
    const merged = byUser.get(u.id)?.size ?? 0;
    return merged > u.projectCount ? { ...u, projectCount: merged } : u;
  });
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const [rpcRes, ownedRes, invitesRes, viewersRes] = await Promise.all([
    supabase.rpc('admin_list_users'),
    // Include owned projects plus accepted contractor invites & project viewers so
    // contractors or invited Homeowners on a live build are not misclassified as
    // "No projects". Best-effort: if any auxiliary read fails, RPC count still applies.
    supabase.from('projects').select('id, user_id'),
    supabase.from('contractor_invites').select('project_id, contractor_id').eq('status', 'accepted'),
    supabase.from('project_viewers').select('project_id, user_id').not('user_id', 'is', null),
  ]);
  if (rpcRes.error) throw rpcRes.error;

  const base = ((rpcRes.data ?? []) as Row[]).map(r => ({
    id:        s(r.id),
    email:     s(r.email),
    fullName:  s(r.full_name),
    country:   s(r.country),
    roles:     s(r.roles),
    tier:      typeof r.tier === 'string' && r.tier ? r.tier : null,
    projectCount: Number(r.project_count ?? 0) || 0,
    createdAt: s(r.created_at),
    provisionedBy: s(r.provisioned_by) || null,
    mustChangePassword: r.must_change_password === true,
    lastSignInAt: s(r.last_sign_in_at) || null,
  }));

  return mergeUserProjectCounts(base, {
    owned: ownedRes.error ? [] : ((ownedRes.data ?? []) as { id: string; user_id: string | null }[]),
    invites: invitesRes.error ? [] : ((invitesRes.data ?? []) as { project_id: string | null; contractor_id: string | null }[]),
    viewers: viewersRes.error ? [] : ((viewersRes.data ?? []) as { project_id: string | null; user_id: string | null }[]),
  });
}

/**
 * Delete an account and everything that cascades from it. The guards live in
 * `admin_delete_user()` (migration 035), not here: refusing self-deletion and the last
 * admin has to hold whoever calls it, not just this screen.
 *
 * Returns how many projects were destroyed, so the UI can report what actually happened
 * rather than what it predicted.
 */
export async function deleteUser(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Number((row as Record<string, unknown> | null)?.deleted_projects ?? 0);
}

/** id → { name, email }, for screens that show a project's owner. */
export async function ownerLookup(): Promise<Map<string, { name: string; email: string; roles: string }>> {
  const users = await listAdminUsers();
  // Roles come through now (2 Nov 2026). They were already loaded and then dropped
  // here, so a project's owner was a name with no indication of WHAT they are. Philip
  // hit that on the Projects list: an August client account that had since been given
  // the contractor role read as two different people.
  return new Map(users.map(u => [u.id, { name: u.fullName, email: u.email, roles: u.roles }]));
}
