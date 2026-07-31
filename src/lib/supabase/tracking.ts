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

// =========================================================
// adminStartProjectTracking (Jalla Management)
// Admin confirms the final budget on the client's behalf, then notifies them.
// Guarded server-side by is_admin() (admin_start_project_tracking RPC).
// =========================================================
export async function adminStartProjectTracking(
  projectId: string,
  finalBudget: number,
  ownerId: string,
  projectName: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_start_project_tracking', {
    p_project_id:   projectId,
    p_final_budget: finalBudget,
  });
  if (error) throw error;

  // Notify the owner (direct insert — mirrors adminApproveStage in approvals.ts)
  await supabase.from('notifications').insert({
    user_id: ownerId,
    type:    'budget_confirmed',
    title:   'Your budget is confirmed',
    body:    `Jalla has confirmed the budget for "${projectName}" and tracking is now live. Stage 1 is ready.`,
    data:    { project_id: projectId },
  });

  trackEvent('project_tracking_started', { project_id: projectId, by: 'admin' });
}
