import { supabase } from './client';

// =========================================================
// Contractor-recorded offline payments (20261119000000).
//
// Groundwork records and verifies milestones; it never holds custody of funds.
// These helpers back:
//   1. Per-stage contractor verification ("Has the Homeowner paid for this stage?")
//   2. Homeowner dispute ("Not right? Tell us") — flags for Admin without stalling work
//   3. Initial payments captured when a contractor creates a project
// =========================================================

export interface ContractorStageVerification {
  id: string;
  project_id: string;
  stage_id: string;
  verified_by: string | null;
  verified_at: string;
  amount: number | null;
  currency: string | null;
  fx_rate: number | null;
  amount_usd: number | null;
  note: string | null;
}

export interface ContractorPaymentDispute {
  id: string;
  verification_id: string;
  project_id: string;
  stage_id: string;
  disputed_by: string | null;
  disputed_at: string;
  reason: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface ProjectInitialPayment {
  id: string;
  project_id: string;
  total_amount: number;
  currency: string;
  fx_rate: number;
  amount_usd: number;
  covered_stages: number[];
  recorded_by: string | null;
  recorded_at: string;
  note: string | null;
}

export interface SubstagePaymentRequest {
  id: string;
  project_id: string;
  stage_id: string;
  substage_id: string | null;
  amount: number | null;
  currency: string | null;
  note: string | null;
  requested_by: string | null;
  requested_at: string;
  status: 'open' | 'fulfilled' | 'cancelled';
}

export interface ProjectContractorPaymentState {
  initialPayment: ProjectInitialPayment | null;
  verifiedStageIds: Set<string>;
  requests: SubstagePaymentRequest[];
}

export async function fetchProjectContractorPaymentState(
  projectId: string,
): Promise<ProjectContractorPaymentState> {
  const [initRes, verRes, reqRes] = await Promise.all([
    supabase
      .from('project_initial_payments')
      .select('id, project_id, total_amount, currency, fx_rate, amount_usd, covered_stages, recorded_by, recorded_at, note')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('contractor_stage_verifications')
      .select('stage_id')
      .eq('project_id', projectId),
    supabase
      .from('substage_payment_requests')
      .select('id, project_id, stage_id, substage_id, amount, currency, note, requested_by, requested_at, status')
      .eq('project_id', projectId)
      .eq('status', 'open')
      .order('requested_at', { ascending: false }),
  ]);

  return {
    initialPayment: (initRes.data as ProjectInitialPayment | null) ?? null,
    verifiedStageIds: new Set(((verRes.data ?? []) as { stage_id: string }[]).map(r => r.stage_id)),
    requests: (reqRes.data ?? []) as SubstagePaymentRequest[],
  };
}

export async function requestStagePayment(input: {
  stageId: string;
  substageId?: string | null;
  amount?: number | null;
  currency?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; request_id: string; stage_id: string; substage_id: string | null }> {
  const hasAmount = input.amount != null && Number.isFinite(input.amount) && input.amount > 0;
  const { data, error } = await supabase.rpc('request_stage_payment', {
    p_stage: input.stageId,
    p_substage: input.substageId ?? null,
    p_amount: hasAmount ? input.amount : null,
    p_currency: hasAmount ? input.currency ?? null : null,
    p_note: input.note?.trim() || null,
  });
  if (error) throw error;

  // Best-effort email + WhatsApp notification to the Homeowner. Never blocks or fails
  // the persisted payment request + in-app notification if delivery is unavailable.
  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return;
    return fetch('/api/events?action=payment-request-notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        stageId: input.stageId,
        substageId: input.substageId ?? null,
        amount: hasAmount ? input.amount : null,
        currency: hasAmount ? input.currency ?? null : null,
        note: input.note?.trim() || null,
      }),
    });
  }).catch(() => {});

  return data as { ok: boolean; request_id: string; stage_id: string; substage_id: string | null };
}

export async function fetchStageContractorVerification(stageId: string): Promise<{
  verification: ContractorStageVerification | null;
  dispute: ContractorPaymentDispute | null;
}> {
  const { data: ver, error: verErr } = await supabase
    .from('contractor_stage_verifications')
    .select('id, project_id, stage_id, verified_by, verified_at, amount, currency, fx_rate, amount_usd, note')
    .eq('stage_id', stageId)
    .maybeSingle();

  if (verErr) throw verErr;
  if (!ver) return { verification: null, dispute: null };

  const { data: disputes, error: dispErr } = await supabase
    .from('contractor_payment_disputes')
    .select('id, verification_id, project_id, stage_id, disputed_by, disputed_at, reason, resolved_at, resolved_by, resolution_note')
    .eq('verification_id', ver.id)
    .order('disputed_at', { ascending: false })
    .limit(1);

  if (dispErr) throw dispErr;
  return {
    verification: ver as ContractorStageVerification,
    dispute: (disputes?.[0] as ContractorPaymentDispute | undefined) ?? null,
  };
}

export async function recordContractorStageVerification(input: {
  stageId: string;
  amount?: number | null;
  currency?: string | null;
  fxRate?: number | null;
  note?: string | null;
}): Promise<{ ok: boolean; verification_id: string; stage_id: string }> {
  const hasAmount = input.amount != null && Number.isFinite(input.amount) && input.amount > 0;
  const { data, error } = await supabase.rpc('record_contractor_stage_verification', {
    p_stage: input.stageId,
    p_amount: hasAmount ? input.amount : null,
    p_currency: hasAmount ? input.currency ?? null : null,
    p_fx_rate: hasAmount ? input.fxRate ?? null : null,
    p_note: input.note?.trim() || null,
  });
  if (error) throw error;
  return data as { ok: boolean; verification_id: string; stage_id: string };
}

export async function disputeContractorVerification(
  verificationId: string,
  reason?: string | null,
): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('dispute_contractor_verification', {
    p_verification_id: verificationId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
  return data as { ok: boolean };
}

export async function recordProjectInitialPayments(input: {
  projectId: string;
  totalAmount: number;
  currency: string;
  fxRate: number;
  coveredStages: number[];
  note?: string | null;
}): Promise<{ ok: boolean; initial_payment_id: string }> {
  const { data, error } = await supabase.rpc('record_project_initial_payments', {
    p_project: input.projectId,
    p_total_amount: input.totalAmount,
    p_currency: input.currency,
    p_fx_rate: input.fxRate,
    p_covered_stages: input.coveredStages,
    p_note: input.note?.trim() || null,
  });
  if (error) throw error;
  return data as { ok: boolean; initial_payment_id: string };
}
