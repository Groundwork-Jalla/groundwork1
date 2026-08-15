import { supabase } from './client';
import { trackEvent } from '@/lib/analytics';
import type { BudgetBreakdown } from '@/types/project';

// Both RPCs take the whole breakdown, not just the total.
//
// Stage milestones are shares of the CONSTRUCTION fee, and design, permit and
// professional are their own milestones — none of which the total alone determines. The
// alternative was to invert the composition again inside Postgres, which would put the
// same formula in two languages; that is exactly how the four disagreeing budget splits
// this refactor replaces came to exist.
function milestoneArgs(projectId: string, budget: BudgetBreakdown) {
  return {
    p_project_id:       projectId,
    p_final_budget:     budget.total,
    p_construction_fee: budget.construction,
    p_design_fee:       budget.design,
    p_permit_fee:       budget.permit,
    p_professional_fee: budget.professional,
  };
}

// =========================================================
// startProjectTracking
// Confirms the final budget and starts tracking in one atomic step:
// re-derives every stage's payment_milestone_usd, writes the fee milestones,
// activates stage 1, and stamps tracking_started_at.
// Owner-guarded + idempotent server-side.
// =========================================================
export async function startProjectTracking(
  projectId: string,
  budget: BudgetBreakdown,
): Promise<void> {
  const { error } = await supabase.rpc('start_project_tracking', milestoneArgs(projectId, budget));
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
  budget: BudgetBreakdown,
  ownerId: string,
  projectName: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_start_project_tracking', milestoneArgs(projectId, budget));
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
