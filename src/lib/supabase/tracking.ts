import { supabase } from './client';
import { trackEvent } from '@/lib/analytics';

// =========================================================
// startProjectTracking
// Confirms the final budget and starts tracking in one atomic step:
// re-derives every stage's payment_milestone_usd, activates stage 1,
// and stamps tracking_started_at. Owner-guarded + idempotent server-side.
// =========================================================
export async function startProjectTracking(
  projectId: string,
  finalBudget: number,
): Promise<void> {
  const { error } = await supabase.rpc('start_project_tracking', {
    p_project_id:   projectId,
    p_final_budget: finalBudget,
  });
  if (error) throw error;

  trackEvent('project_tracking_started', { project_id: projectId });
}
