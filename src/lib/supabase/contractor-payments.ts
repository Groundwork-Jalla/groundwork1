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
  is_partial?: boolean;
  stage_total_amount?: number | null;
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
  verifiedByStage: Map<string, { amount: number | null; currency: string | null; isPartial: boolean; stageTotal: number | null }>;
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
      .select('stage_id, amount, currency, is_partial, stage_total_amount')
      .eq('project_id', projectId),
    supabase
      .from('substage_payment_requests')
      .select('id, project_id, stage_id, substage_id, amount, currency, note, requested_by, requested_at, status')
      .eq('project_id', projectId)
      .eq('status', 'open')
      .order('requested_at', { ascending: false }),
  ]);

  const verRows = (verRes.data ?? []) as {
    stage_id: string;
    amount?: number | null;
    currency?: string | null;
    is_partial?: boolean | null;
    stage_total_amount?: number | null;
  }[];
  const verifiedByStage = new Map<string, { amount: number | null; currency: string | null; isPartial: boolean; stageTotal: number | null }>();
  for (const r of verRows) {
    verifiedByStage.set(r.stage_id, {
      amount: r.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      currency: typeof r.currency === 'string' ? r.currency : null,
      isPartial: r.is_partial === true,
      stageTotal: r.stage_total_amount != null && Number.isFinite(Number(r.stage_total_amount)) ? Number(r.stage_total_amount) : null,
    });
  }

  return {
    initialPayment: (initRes.data as ProjectInitialPayment | null) ?? null,
    verifiedStageIds: new Set(verRows.map(r => r.stage_id)),
    verifiedByStage,
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
    .select('id, project_id, stage_id, verified_by, verified_at, amount, currency, fx_rate, amount_usd, note, is_partial, stage_total_amount')
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
  isPartial?: boolean;
  stageTotal?: number | null;
}): Promise<{ ok: boolean; verification_id: string; stage_id: string; is_partial?: boolean; stage_total_amount?: number | null }> {
  const hasAmount = input.amount != null && Number.isFinite(input.amount) && input.amount > 0;
  const isPartial = input.isPartial === true;
  const hasStageTotal = isPartial && input.stageTotal != null && Number.isFinite(input.stageTotal) && input.stageTotal > 0;
  const { data, error } = await supabase.rpc('record_contractor_stage_verification', {
    p_stage: input.stageId,
    p_amount: hasAmount ? input.amount : null,
    p_currency: hasAmount ? input.currency ?? null : null,
    p_fx_rate: hasAmount ? input.fxRate ?? null : null,
    p_note: input.note?.trim() || null,
    p_is_partial: isPartial,
    p_stage_total: hasStageTotal ? input.stageTotal : null,
  });
  if (error) throw error;
  return data as { ok: boolean; verification_id: string; stage_id: string; is_partial?: boolean; stage_total_amount?: number | null };
}

export async function deleteOwnContractorProject(
  projectId: string,
): Promise<{ ok: boolean; project_id: string; name: string }> {
  const { data, error } = await supabase.rpc('delete_own_contractor_project', {
    p_project_id: projectId,
  });
  if (error) throw error;
  const result = (data ?? {}) as {
    ok?: boolean;
    project_id?: string;
    name?: string;
    files?: { bucket?: string; path?: string }[];
  };
  if (Array.isArray(result.files) && result.files.length > 0) {
    const byBucket = new Map<string, string[]>();
    for (const f of result.files) {
      if (f && typeof f.bucket === 'string' && typeof f.path === 'string' && f.path) {
        const list = byBucket.get(f.bucket) ?? [];
        list.push(f.path);
        byBucket.set(f.bucket, list);
      }
    }
    for (const [bucket, paths] of byBucket) {
      try {
        await supabase.storage.from(bucket).remove(paths);
      } catch {
        // Best-effort storage cleanup; project row is already deleted and tombstoned.
      }
    }
  }
  return {
    ok: result.ok !== false,
    project_id: result.project_id ?? projectId,
    name: result.name ?? '',
  };
}

export async function clearContractorStageVerification(
  stageId: string,
): Promise<{ ok: boolean; stage_id: string; cleared: boolean }> {
  const { data, error } = await supabase.rpc('clear_contractor_stage_verification', {
    p_stage: stageId,
  });
  if (error) throw error;
  return data as { ok: boolean; stage_id: string; cleared: boolean };
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
