import { supabase } from './client';

// =========================================================
// The activity model (089): project_audit_log is the one record of what happened.
//
// Nothing here writes an audit row. The browser lost that ability in 089 — an audit row
// exists only because a definer function wrote it, in the same transaction as the change
// it describes. What lives here are the two stage transitions that were still done from
// the browser with a hand-written audit row beside them, now one RPC each, plus the
// "089 not applied yet" test their callers use to fall back to the old path.
// =========================================================

/** Is this "the function does not exist yet" — a migration that has not been run? */
export function isMissingRpc(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>).code;
  return code === 'PGRST202' || code === '42883';
}

/**
 * Owner submits a stage for review (Jalla Verify / Jalla Management). The database
 * re-checks ownership, tier, `active`, paid, and that every substage is pending review or
 * complete; refuses with `not_owner:`, `self_verify:`, `wrong_state:`, `not_paid:` or
 * `substages_not_ready:`. Writes `stage_submitted_for_review` itself.
 */
export async function submitStageForReview(stageId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_stage_for_review', { p_stage: stageId });
  if (error) throw error;
}

/**
 * Admin sends a pending-review stage back to active and its reviewed substages back to
 * in_progress. Refuses `not_admin:` and `wrong_state:`. Writes `rework_requested` itself.
 * The bell and the email are the caller's, after this returns.
 */
export async function requestRework(stageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('request_rework', { p_stage: stageId, p_reason: reason });
  if (error) throw error;
}
