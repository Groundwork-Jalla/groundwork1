import { supabase } from './client';
import { ownerLookup, listAdminUsers } from './admin-users';
import { isMissingTable } from '@/lib/errors';

/**
 * Projects to start a native Jalla conversation about.
 *
 * ── The client is never chosen ───────────────────────────────────────────────────────
 * Only the project is picked. `project_conversation()` (091) inserts the thread with
 * `SELECT user_id, id, 'jalla' FROM projects WHERE id = p_project` — the owner is read
 * inside the database, from the project itself — so pairing a project with somebody
 * else's client is not something this screen has to be careful about. It is impossible.
 *
 * The owner shown here is therefore a DISPLAY of that same relationship, never an input
 * to it. An owner whose account cannot be read still has a project that can be messaged;
 * the row says so rather than being hidden.
 */

/**
 * Staff, by the same test the Clients page uses. Kept here rather than imported so the
 * two cannot drift apart silently — if one changes, this one's test fails.
 */
export const isStaffAccount = (roles: string): boolean =>
  roles.split(',').map(r => r.trim()).some(r => r === 'admin' || r === 'verifier');

export interface JallaProject {
  id: string;
  name: string;
  status: string | null;
  city: string | null;
  country: string | null;
  currentStage: number | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

/** An account, and the projects it owns. The unit the picker's first step works in. */
export interface JallaAccount {
  id: string;
  name: string | null;
  email: string | null;
  projects: JallaProject[];
}

/**
 * Every CLIENT account, grouped with the projects it owns.
 *
 * ── Staff are not clients ────────────────────────────────────────────────────────────
 * Same rule as the Clients page: an account holding an `admin` or `verifier` role is
 * staff, and Groundwork does not build for its own team. Without this a staff member who
 * owns a test project appears in the picker as somebody to message, and choosing them
 * would open a thread whose `person_id` is the person writing it.
 *
 * A staff-owned project is still reachable from its own workspace, which is where
 * messaging about it would actually make sense.
 *
 * ── Accounts with no project are kept ────────────────────────────────────────────────
 * Returned with an empty list rather than filtered out: an admin looking for somebody
 * needs to find them and be told why they cannot be messaged, not wonder whether the
 * search is broken. A Jalla message is about a build, so an account with no build has
 * nothing to attach one to — and the picker says exactly that instead of hiding the row.
 */
export async function listAccountsForJalla(): Promise<{ rows: JallaAccount[]; available: boolean }> {
  const [{ rows: projects, available }, people] = await Promise.all([
    listProjectsForJalla(),
    listAdminUsers().catch(() => [] as Awaited<ReturnType<typeof listAdminUsers>>),
  ]);
  if (!available) return { rows: [], available: false };

  const byOwner = new Map<string, JallaProject[]>();
  for (const p of projects) {
    if (!p.ownerId) continue;
    byOwner.set(p.ownerId, [...(byOwner.get(p.ownerId) ?? []), p]);
  }

  const accounts = new Map<string, JallaAccount>();
  const staff = new Set<string>();
  for (const u of people) {
    if (isStaffAccount(u.roles)) { staff.add(u.id); continue; }
    accounts.set(u.id, { id: u.id, name: u.fullName || null, email: u.email || null, projects: byOwner.get(u.id) ?? [] });
  }
  // An owner the account list could not name still owns projects that can be messaged
  // about. Keep them, identified by whatever the project itself carries — unless they
  // were left out above for being staff.
  for (const [ownerId, owned] of byOwner) {
    if (accounts.has(ownerId) || staff.has(ownerId)) continue;
    accounts.set(ownerId, { id: ownerId, name: owned[0]?.ownerName ?? null, email: owned[0]?.ownerEmail ?? null, projects: owned });
  }

  // Accounts that can actually be messaged first; then by name, so the list is stable.
  const rows = [...accounts.values()].sort((a, b) =>
    Number(b.projects.length > 0) - Number(a.projects.length > 0)
    || (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));
  return { rows, available: true };
}

export async function listProjectsForJalla(): Promise<{ rows: JallaProject[]; available: boolean }> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status, city, country, current_stage, user_id')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }

  // PostgREST cannot join projects → profiles, so owners come from the admin user list —
  // the same lookup the projects page uses. A failure here costs names, never the list.
  const owners = await ownerLookup().catch(() => new Map<string, { name: string; email: string }>());

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(p => {
    const ownerId = typeof p.user_id === 'string' ? p.user_id : null;
    const owner = ownerId ? owners.get(ownerId) : undefined;
    return {
      id: String(p.id),
      name: String(p.name ?? ''),
      status: typeof p.status === 'string' ? p.status : null,
      city: typeof p.city === 'string' ? p.city : null,
      country: typeof p.country === 'string' ? p.country : null,
      currentStage: typeof p.current_stage === 'number' ? p.current_stage : null,
      ownerId,
      ownerName: owner?.name || null,
      ownerEmail: owner?.email || null,
    };
  });
  return { rows, available: true };
}
