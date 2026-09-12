import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';

// =========================================================
// Site updates (migration 088).
//
// A site update is the RECORD of work reported on a stage — who, when, which stage,
// what they said, which files this update added. It is not the evidence index: that is
// still `project_substages.evidence_urls`, which the client renders and the bucket RLS
// is keyed on. `submit_site_update()` writes both in one transaction; if it fails,
// neither changes. Two views of one event, never two sources of truth.
//
// The browser uploads to storage first, then calls the RPC with the paths. If the
// answer is lost, the same `clientRef` makes the retry return the existing row rather
// than filing the event twice, and the index never carries a path twice regardless.
// =========================================================

export interface SiteUpdate {
  id: string;
  projectId: string;
  stageId: string;
  substageId: string | null;
  submittedBy: string;
  submittedAt: string;
  description: string | null;
  evidencePaths: string[];
  location: Record<string, unknown> | null;
}

const row = (r: Record<string, unknown>): SiteUpdate => ({
  id:            r.id as string,
  projectId:     r.project_id as string,
  stageId:       r.stage_id as string,
  substageId:    (r.substage_id as string | null) ?? null,
  submittedBy:   r.submitted_by as string,
  submittedAt:   r.submitted_at as string,
  description:   (r.description as string | null) ?? null,
  evidencePaths: Array.isArray(r.evidence_paths) ? (r.evidence_paths as string[]) : [],
  location:      (r.location as Record<string, unknown> | null) ?? null,
});

/** Newest first. `available: false` when 088 is not applied — callers render as before. */
export async function listSiteUpdates(projectId: string): Promise<{ rows: SiteUpdate[]; available: boolean }> {
  const { data, error } = await supabase
    .from('site_updates')
    .select('*')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { available: true, rows: (data ?? []).map(row) };
}

/**
 * Submit. The database decides who may (owner, accepted contractor, admin — never a
 * verifier), that the stage is open, that the substage belongs to it, and that every path
 * is under this project. Refusals arrive prefixed: `not_member:`, `not_submitter:`,
 * `wrong_state:`, `substage_mismatch:`, `path_mismatch:`, `empty_update:`.
 *
 * Returns the site update id. Appends `paths` to the substage's `evidence_urls` in the
 * same transaction, deduplicated.
 */
export async function submitSiteUpdate(input: {
  stageId: string;
  substageId?: string | null;
  description?: string | null;
  paths?: string[];
  location?: Record<string, unknown> | null;
  /** One per submission attempt; reuse it on retry. */
  clientRef?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('submit_site_update', {
    p_stage:       input.stageId,
    p_substage:    input.substageId ?? null,
    p_description: input.description ?? null,
    p_paths:       input.paths ?? [],
    p_location:    input.location ?? null,
    p_client_ref:  input.clientRef ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Is this the "088 not applied yet" refusal, so the caller can fall back? */
export function isSiteUpdatesUnavailable(err: unknown): boolean {
  if (isMissingTable(err)) return true;
  const code = (err as { code?: string } | null)?.code;
  return code === 'PGRST202'; // function not found
}
