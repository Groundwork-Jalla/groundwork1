import { supabase } from './client';

// =========================================================
// Closing a project (migration 20261117000000).
//
// Approving the last stage used to mark the project completed whatever was still owed.
// Now a project with a recorded balance, or a receipt the contractor has not decided,
// stays open after its last stage, and is closed by a person once both are clear.
//
// Nothing here computes money. The amounts come from the same database function each
// stage's own balance comes from, so the panel and the stage can never disagree.
// =========================================================

export interface ProjectCloseout {
  project_id: string;
  status: string;
  closed: boolean;
  all_stages_complete: boolean;
  currency: string | null;
  /** What is still owed across the project, in the project's own currency. */
  outstanding: string;
  /** Receipts uploaded but not yet confirmed or flagged by the contractor. */
  pending_receipts: number;
  stages: { stage_id: string; stage_number: number; remaining: string }[];
  /** Everything is settled and this person is allowed to close it. */
  can_close: boolean;
}

async function invoke(name: string, project: string): Promise<ProjectCloseout> {
  const { data, error } = await supabase.rpc(name, { p_project: project });
  if (error) throw error;
  if (!data || data.project_id !== project || typeof data.outstanding !== 'string' || !Array.isArray(data.stages)
    || !Number.isFinite(Number(data.outstanding)) || typeof data.pending_receipts !== 'number') throw new Error('closeout_unavailable');
  return data as ProjectCloseout;
}

export const fetchProjectCloseout = (project: string) => invoke('project_closeout_context', project);
export const closeProject = (project: string) => invoke('close_project', project);

/** The function is absent until the migration is applied; the panel then simply stays away. */
export function closeoutNotInstalled(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return ['PGRST202', '42883'].includes(code);
}
