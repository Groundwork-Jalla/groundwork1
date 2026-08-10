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
  createdAt: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function listAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_list_users');
  if (error) throw error;

  return ((data ?? []) as Row[]).map(r => ({
    id:        s(r.id),
    email:     s(r.email),
    fullName:  s(r.full_name),
    country:   s(r.country),
    roles:     s(r.roles),
    tier:      typeof r.tier === 'string' && r.tier ? r.tier : null,
    createdAt: s(r.created_at),
  }));
}

/** id → { name, email }, for screens that show a project's owner. */
export async function ownerLookup(): Promise<Map<string, { name: string; email: string }>> {
  const users = await listAdminUsers();
  return new Map(users.map(u => [u.id, { name: u.fullName, email: u.email }]));
}
