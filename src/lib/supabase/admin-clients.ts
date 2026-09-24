import { supabase } from './client';
import { listAdminUsers, type AdminUser } from './admin-users';
import { listOpenSupportTickets } from './support';

/**
 * Clients — the admin's view of the people Groundwork builds for (01 §3 PEOPLE).
 *
 * ── A view, not a table ──────────────────────────────────────────────────────────────
 * There is no client record and there will not be one: a client is a `profiles` row that
 * owns at least one project, or that holds no staff role. Creating a second record for
 * the same person is how two systems start disagreeing about who somebody is.
 *
 * So this composes what already exists — the same `admin_list_users` RPC the Users page
 * reads, plus the projects each person owns, plus the conversations and tickets already
 * attached to them. Nothing is invented: no engagement score, no tier the profile does
 * not carry, no "status" that is not a real column.
 */

export interface ClientProject {
  id: string;
  name: string;
  status: string | null;
  tier: string | null;
  currentStage: number | null;
  stagesTotal: number;
  country: string | null;
  city: string | null;
  updatedAt: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  country: string | null;
  tier: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  projects: ClientProject[];
  /** Threads where this person is the counterpart (091). null when 091 is absent. */
  conversations: number | null;
  /** Open + in-progress tickets raised by this person. null when unreadable. */
  openTickets: number | null;
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);
const isStaff = (u: AdminUser) => u.roles.split(',').map(r => r.trim()).some(r => r === 'admin' || r === 'verifier');

export interface ClientDirectory {
  rows: ClientRow[];
  /** False when 091 is not applied — conversation counts are then unknown, not zero. */
  conversationsAvailable: boolean;
  ticketsAvailable: boolean;
}

/**
 * Every client, with the projects they own. Four reads for the whole page, never one per
 * row: people, projects, stage counts, and the two context counts.
 */
export async function listClients(): Promise<ClientDirectory> {
  const users = await listAdminUsers();

  const [projectsRes, stagesRes, convRes, ticketsRes] = await Promise.all([
    supabase.from('projects').select('id, name, user_id, status, tier, current_stage, country, city, updated_at').neq('status', 'archived'),
    supabase.from('project_stages').select('project_id'),
    supabase.from('conversations').select('person_id'),
    // Tickets go through their own module by rule: it throws rather than reporting a
    // failure as an empty queue, which is the difference between "no open tickets" and
    // "we could not tell".
    listOpenSupportTickets().then(rows => ({ data: rows, error: null as unknown }))
      .catch(err => ({ data: [] as { user_id: string | null }[], error: err })),
  ]);
  if (projectsRes.error) throw projectsRes.error;

  const stagesPer = new Map<string, number>();
  for (const r of (stagesRes.data ?? []) as Record<string, unknown>[]) {
    const id = s(r.project_id);
    stagesPer.set(id, (stagesPer.get(id) ?? 0) + 1);
  }

  const byOwner = new Map<string, ClientProject[]>();
  for (const r of (projectsRes.data ?? []) as unknown as Record<string, unknown>[]) {
    const owner = s(r.user_id);
    const list = byOwner.get(owner) ?? [];
    list.push({
      id: s(r.id), name: s(r.name), status: sn(r.status), tier: sn(r.tier),
      currentStage: typeof r.current_stage === 'number' ? r.current_stage : null,
      stagesTotal: stagesPer.get(s(r.id)) ?? 0,
      country: sn(r.country), city: sn(r.city), updatedAt: sn(r.updated_at),
    });
    byOwner.set(owner, list);
  }

  const conversationsAvailable = !convRes.error;
  const convPer = new Map<string, number>();
  if (conversationsAvailable) {
    for (const r of (convRes.data ?? []) as Record<string, unknown>[]) {
      const id = s(r.person_id);
      if (id) convPer.set(id, (convPer.get(id) ?? 0) + 1);
    }
  }

  const ticketsAvailable = !ticketsRes.error;
  const ticketPer = new Map<string, number>();
  if (ticketsAvailable) {
    for (const r of ticketsRes.data ?? []) {
      const id = r.user_id ?? '';
      if (id) ticketPer.set(id, (ticketPer.get(id) ?? 0) + 1);
    }
  }

  // A client is someone Groundwork builds for: not staff, and not a verifier. Someone
  // with no project yet is still a client — they signed up to build.
  const rows = users.filter(u => !isStaff(u)).map(u => ({
    id: u.id,
    name: u.fullName,
    email: u.email,
    country: u.country || null,
    tier: u.tier,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
    projects: byOwner.get(u.id) ?? [],
    conversations: conversationsAvailable ? (convPer.get(u.id) ?? 0) : null,
    openTickets: ticketsAvailable ? (ticketPer.get(u.id) ?? 0) : null,
  }));

  // Most projects first, then most recently created account.
  rows.sort((a, b) => b.projects.length - a.projects.length || b.createdAt.localeCompare(a.createdAt));
  return { rows, conversationsAvailable, ticketsAvailable };
}
