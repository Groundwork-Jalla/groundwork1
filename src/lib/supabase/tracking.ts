import { supabase } from './client';
import { trackEvent } from '@/lib/analytics';
import type { BudgetBreakdown } from '@/types/project';
import type { JoinedBudget } from '@/lib/budget/joined-project';

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
    // Added by migration 072. Verification came out of the professional fee — it was
    // always a per-visit charge and never a professional's retainer — and contingency is
    // new. Both are their own `project_fees` rows, so the schedule still adds up to the
    // total; omit either and it quietly falls short by that amount.
    p_verification_fee: budget.verification,
    p_contingency_fee:  budget.contingency,
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

// =========================================================
// adminStartProjectAtStage (a build Groundwork joined halfway through)
//
// A partner contractor brings a client whose house is already at the roof. The stages below
// the one they have reached are marked complete and `pre_existing` — no milestone, no
// verification, no certificate — and the project opens active on the stage they are actually
// on. Guarded server-side by is_admin() (103).
//
// Every figure still comes from TypeScript. `joinedBudget()` re-prices the breakdown for the
// remaining work; the construction fee it returns is deliberately the FULL one, so each
// stage still to be built keeps its true milestone and only the skipped ones are zeroed.
// =========================================================
export async function adminStartProjectAtStage(
  projectId: string,
  joined: JoinedBudget,
  ownerId: string,
  projectName: string,
  /** What the contractor said, kept on the record with the project. */
  describedAs?: string | null,
): Promise<{ startStage: number; preExistingStages: number }> {
  const { data, error } = await supabase.rpc('admin_start_project_at_stage', {
    p_project_id:       projectId,
    p_final_budget:     joined.total,
    p_construction_fee: joined.construction,
    p_design_fee:       joined.design,
    p_permit_fee:       joined.permit,
    p_professional_fee: joined.professional,
    p_verification_fee: joined.verification,
    p_contingency_fee:  joined.contingency,
    p_start_stage:      joined.startStage,
    p_note:             describedAs?.trim() || null,
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;

  // The client is told where their tracking begins and why, so the completed stages on their
  // dashboard are never a surprise they have to ask about.
  await supabase.from('notifications').insert({
    user_id: ownerId,
    type:    'budget_confirmed',
    title:   'Your project is now being tracked',
    body:    `Jalla has set up "${projectName}" from stage ${joined.startStage}. `
           + `The ${joined.skipped.length} earlier stage(s) are recorded as already built, `
           + `so no payment is due for them.`,
    data:    { project_id: projectId, start_stage: joined.startStage },
  });

  trackEvent('project_tracking_started', {
    project_id: projectId, by: 'admin', joined_at_stage: joined.startStage,
  });

  return {
    startStage: Number(result.start_stage ?? joined.startStage),
    preExistingStages: Number(result.pre_existing_stages ?? joined.skipped.length),
  };
}
