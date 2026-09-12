import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';

// =========================================================
// Stage verifications (migration 087).
//
// A verification is a row: who was asked, who visited, what they found, what they
// decided, and — when an admin recorded it for them — who actually made the call. The
// decision is an INPUT to approval (`approve_stage()` refuses without a `verified`
// decision where verification is required); it authorises nothing by itself.
//
// Every write is an RPC that re-checks the specific actor. The guards surface as
// prefixed messages (`not_admin:`, `not_verifier:`, `on_behalf_required:`,
// `already_pending:`, `not_verified:` …) that the UI maps to sentences.
// =========================================================

export type VerificationDecision = 'pending' | 'verified' | 'rejected' | 'needs_more_evidence';

export interface StageVerification {
  id: string;
  stageId: string;
  projectId: string;
  verifierId: string;
  requestedBy: string | null;
  requestedAt: string;
  visitedAt: string | null;
  decision: VerificationDecision;
  findings: string | null;
  checklist: Record<string, unknown> | null;
  decidedAt: string | null;
  recordedBy: string | null;
  /** Set only when an admin recorded the decision for the verifier. Never equals recordedBy. */
  recordedOnBehalfOf: string | null;
  reason: string | null;
  certificateId: string | null;
}

const row = (r: Record<string, unknown>): StageVerification => ({
  id:                 r.id as string,
  stageId:            r.stage_id as string,
  projectId:          r.project_id as string,
  verifierId:         r.verifier_id as string,
  requestedBy:        (r.requested_by as string | null) ?? null,
  requestedAt:        r.requested_at as string,
  visitedAt:          (r.visited_at as string | null) ?? null,
  decision:           r.decision as VerificationDecision,
  findings:           (r.findings as string | null) ?? null,
  checklist:          (r.checklist as Record<string, unknown> | null) ?? null,
  decidedAt:          (r.decided_at as string | null) ?? null,
  recordedBy:         (r.recorded_by as string | null) ?? null,
  recordedOnBehalfOf: (r.recorded_on_behalf_of as string | null) ?? null,
  reason:             (r.reason as string | null) ?? null,
  certificateId:      (r.certificate_id as string | null) ?? null,
});

/**
 * Every verification on a project, newest first. Empty + `available: false` when 087 is
 * not applied, so the reviews page renders as it did before rather than failing.
 */
export async function listProjectVerifications(projectId: string): Promise<{ rows: StageVerification[]; available: boolean }> {
  const { data, error } = await supabase
    .from('stage_verifications')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { available: true, rows: (data ?? []).map(row) };
}

/** The verification that decides a stage's fate today: the newest row, whatever its decision. */
export function latestForStage(rows: StageVerification[], stageId: string): StageVerification | null {
  return rows.find(v => v.stageId === stageId) ?? null;
}

/** Admin picks ONE verifier (Phase 3 §8.2). Refuses unless the stage is pending_review and requires it. */
export async function requestVerification(stageId: string, verifierUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_verification', { p_stage: stageId, p_verifier: verifierUserId });
  if (error) throw error;
  return data as string;
}

/**
 * Record a decision. Called by the verifier for their own row, or by an admin strictly on
 * their behalf — in which case `onBehalfOf` must be that verifier and `reason` is required,
 * and the database enforces both.
 */
export async function recordVerification(input: {
  verificationId: string;
  decision: Exclude<VerificationDecision, 'pending'>;
  findings?: string;
  checklist?: Record<string, unknown>;
  visitedAt?: string;
  onBehalfOf?: string;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('record_verification', {
    p_verification: input.verificationId,
    p_decision:     input.decision,
    p_findings:     input.findings ?? null,
    p_checklist:    input.checklist ?? null,
    p_visited_at:   input.visitedAt ?? null,
    p_on_behalf_of: input.onBehalfOf ?? null,
    p_reason:       input.reason ?? null,
  });
  if (error) throw error;
}

/** What `approve_stage()` hands back, so the caller can do its side effects. */
export interface ApproveStageResult {
  projectId: string;
  stageId: string;
  stageNumber: number;
  isFinal: boolean;
  nextStageId: string | null;
  nextStageNumber: number | null;
  verificationId: string | null;
}

/**
 * The one place a stage becomes complete. The database decides whether it is legal —
 * actor, state, the owner path's paid/substages preconditions, and the verification gate
 * — and refuses with a prefix otherwise. A trigger refuses the status write from
 * anywhere else, so this cannot be bypassed by a direct update.
 */
export async function approveStageRpc(stageId: string): Promise<ApproveStageResult> {
  const { data, error } = await supabase.rpc('approve_stage', { p_stage: stageId });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    projectId:       r.project_id as string,
    stageId:         r.stage_id as string,
    stageNumber:     Number(r.stage_number),
    isFinal:         r.is_final === true,
    nextStageId:     (r.next_stage_id as string | null) ?? null,
    nextStageNumber: r.next_stage_number == null ? null : Number(r.next_stage_number),
    verificationId:  (r.verification_id as string | null) ?? null,
  };
}
