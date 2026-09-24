import { supabase } from './client';
import { ownerLookup } from './admin-users';
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
