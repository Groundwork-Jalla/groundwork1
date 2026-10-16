import { supabase } from './client';

/**
 * The builds this person can talk about.
 *
 * RLS decides: `projects` is readable by its owner, and 112's viewer and the contractor
 * and verifier policies extend that to everyone else with standing. So this asks for
 * every project the caller can see and lets the database answer — the alternative is a
 * second definition of "my projects" that drifts from the one messaging already enforces.
 *
 * Archived and completed builds are kept: a conversation about a finished job is still
 * worth reading, and hiding it would lose the record people go back for.
 */
export interface ProjectThread {
  projectId: string;
  projectName: string;
  updatedAt: string | null;
}

export async function listMyProjectsWithThreads(): Promise<ProjectThread[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false, nullsFirst: false });
  // Never fatal: an empty Messages page is a correct page, a crashed one is not.
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    projectId:   String(r.id),
    projectName: typeof r.name === 'string' && r.name ? r.name : 'Project',
    updatedAt:   typeof r.updated_at === 'string' ? r.updated_at : null,
  }));
}
