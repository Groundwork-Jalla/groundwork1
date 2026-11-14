import { supabase } from './client';

export interface StagePaymentPlanContext {
  stage_id: string; project_id: string; currency: string; fx_rate: string;
  stage_amount: string; received: string | null; pending: string | null; remaining: string | null; hash: string;
  work_authorized: boolean; progression_authorized: boolean; can_edit: boolean; can_decide: boolean; can_authorize_progression: boolean;
  plan: { id: string; mode: 'full' | 'two_installments'; currency: string; stage_amount: string; first_amount: string;
    status: 'proposed' | 'accepted' | 'declined'; proposed_at: string; decided_at: string | null } | null;
  receipts: { id: string; amount: string | null; decision: string; allows_work: boolean; installment: number | null; plan_id: string | null }[];
}
async function invoke(name: string, input: Record<string, unknown>): Promise<StagePaymentPlanContext> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  if (!data || data.stage_id !== input.p_stage || !/^[A-Z]{3}$/.test(data.currency) || typeof data.hash !== 'string'
    || !Array.isArray(data.receipts)) throw new Error('payment_plan_unavailable');
  return data as StagePaymentPlanContext;
}
export const fetchStagePaymentPlan = (stage: string) => invoke('stage_payment_plan_context', { p_stage: stage });
export const saveStagePaymentPlan = (context: StagePaymentPlanContext, mode: 'full' | 'two_installments', first: string | null) => invoke('save_stage_payment_plan', {
  p_stage: context.stage_id, p_mode: mode, p_first_amount: mode === 'full' ? null : first, p_expected_hash: context.hash,
});
export const decideStagePaymentPlan = (context: StagePaymentPlanContext, accept: boolean) => invoke('decide_stage_payment_plan', {
  p_stage: context.stage_id, p_plan: context.plan?.id, p_accept: accept, p_expected_hash: context.hash,
});
export const authorizeStageProgression = (context: StagePaymentPlanContext) => invoke('authorize_stage_progression', {
  p_stage: context.stage_id, p_expected_hash: context.hash, p_note: null,
});
