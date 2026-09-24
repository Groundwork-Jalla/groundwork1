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

/**
 * Put a contractor on a project, as an admin (029/030).
 *
 * Through `admin_assign_contractor` rather than the table: `contractor_invites` is scoped
 * to the project OWNER by RLS and an admin is not the owner. The RPC re-checks
 * `is_admin()` server-side and writes the audit row, so this cannot be driven from a
 * client's console. Same call the projects list has always used — one assignment model,
 * two places to reach it, and the future /contractors surface reads the same rows.
 */
export async function assignContractor(projectId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_contractor', {
    p_project_id: projectId, p_email: email.trim(),
  });
  if (error) throw error;
}

/**
 * The admin's directory of verifiers (01 §3 PEOPLE, "Verifiers").
 *
 * ── A management surface, not /verifiers ─────────────────────────────────────────────
 * /verifiers is where a verifier does the work. This answers the operator's question:
 * who can verify, in what discipline, where, are they available, what are they carrying
 * right now, and what have they decided before. Same rows, different actor.
 *
 * Everything below is read from what exists — `user_roles` for the role,
 * `verifier_profiles` (086) for credentials, `project_verifiers` for assignments,
 * `stage_verifications` (087) for workload and history. No rating, no score, no
 * availability we compute ourselves: `available` is the column the verifier sets.
 */
export interface VerifierDirectoryRow {
  userId: string;
  name: string;
  email: string;
  /** From verifier_profiles (086). Null when they hold the role but have no profile. */
  disciplines: string[] | null;
  registrationBody: string | null;
  registrationNo: string | null;
  city: string | null;
  available: boolean | null;
  /** Active project assignments (project_verifiers.status = 'active'). */
  activeProjects: number;
  /** Verifications waiting on them (decision = 'pending'). */
  pending: number;
  /** Verifications they have decided, ever. */
  decided: number;
  /** The most recent decision they recorded, for "when did we last hear from them". */
  lastDecidedAt: string | null;
}

export interface VerifierDirectory {
  rows: VerifierDirectoryRow[];
  /** 086 applied — profiles and assignments could be read. */
  profilesAvailable: boolean;
  /** 087 applied — the workload figures are real rather than unknown. */
  verificationsAvailable: boolean;
}

export async function listVerifierDirectory(): Promise<VerifierDirectory> {
  const users = await listAdminUsers();
  const verifiers = users.filter(u => u.roles.split(',').map(r => r.trim()).includes('verifier'));

  const [profilesRes, assignmentsRes, verificationsRes] = await Promise.all([
    supabase.from('verifier_profiles').select('user_id, disciplines, registration_body, registration_no, city, available'),
    supabase.from('project_verifiers').select('user_id, project_id, status').eq('status', 'active'),
    supabase.from('stage_verifications').select('verifier_id, decision, decided_at'),
  ]);

  const profilesAvailable = !profilesRes.error;
  const verificationsAvailable = !verificationsRes.error;

  const profile = new Map<string, Record<string, unknown>>();
  for (const r of (profilesRes.data ?? []) as Record<string, unknown>[]) profile.set(String(r.user_id ?? ''), r);

  const active = new Map<string, Set<string>>();
  for (const r of (assignmentsRes.data ?? []) as Record<string, unknown>[]) {
    const u = String(r.user_id ?? '');
    if (!u) continue;
    const set = active.get(u) ?? new Set<string>();
    set.add(String(r.project_id ?? ''));
    active.set(u, set);
  }

  const pending = new Map<string, number>();
  const decided = new Map<string, number>();
  const lastDecided = new Map<string, string>();
  for (const r of (verificationsRes.data ?? []) as Record<string, unknown>[]) {
    const u = String(r.verifier_id ?? '');
    if (!u) continue;
    if (r.decision === 'pending') {
      pending.set(u, (pending.get(u) ?? 0) + 1);
    } else {
      decided.set(u, (decided.get(u) ?? 0) + 1);
      const at = typeof r.decided_at === 'string' ? r.decided_at : '';
      if (at && at > (lastDecided.get(u) ?? '')) lastDecided.set(u, at);
    }
  }

  const rows = verifiers.map(u => {
    const p = profile.get(u.id);
    return {
      userId: u.id,
      name: u.fullName,
      email: u.email,
      disciplines: p && Array.isArray(p.disciplines) ? (p.disciplines as unknown[]).map(String) : null,
      registrationBody: p && typeof p.registration_body === 'string' ? p.registration_body : null,
      registrationNo:   p && typeof p.registration_no === 'string' ? p.registration_no : null,
      city:             p && typeof p.city === 'string' ? p.city : null,
      available:        p && typeof p.available === 'boolean' ? p.available : null,
      activeProjects: active.get(u.id)?.size ?? 0,
      pending: pending.get(u.id) ?? 0,
      decided: decided.get(u.id) ?? 0,
      lastDecidedAt: lastDecided.get(u.id) ?? null,
    };
  });

  // Most pending work first: the directory's job is to find who is free.
  rows.sort((a, b) => b.pending - a.pending || (a.name || a.email).localeCompare(b.name || b.email));
  return { rows, profilesAvailable, verificationsAvailable };
}
