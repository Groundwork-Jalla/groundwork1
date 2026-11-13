import { readUploadedReceipt } from './receipt-reader';
import { canonicalReceiptAmount, MAX_RECEIPT_BYTES, RECEIPT_ACCEPT } from '@/lib/payments/receipt-reading';
import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';
import type { StageStatus } from '@/types/project';
import { confirmedBillAmount } from '@/lib/budget/bill-budget';

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
  /**
   * The next stage is waiting on money, so the client is asked for the receipt.
   *
   * Favour, 3 Nov 2026: "once they click approve stage, the next thing that should show
   * is upload payment receipt." The screen cannot work this out for itself without a
   * second round trip, and the database has just done it, so it says so (175).
   */
  awaitingPayment: boolean;
  /** The receipt belongs to the reviewed current stage; construction has not advanced. */
  awaitingReviewedStagePayment?: boolean;
  /** An acknowledged retry returns the same progression without approving twice. */
  alreadyApproved?: boolean;
  /** The saved successor state; a paid stage can still be locked on a paused project. */
  nextStageStatus?: StageStatus;
}

function stageApprovalResult(data: unknown): ApproveStageResult {
  const r = (data ?? {}) as Record<string, unknown>;
  if (typeof r.project_id !== 'string' || typeof r.stage_id !== 'string'
      || !Number.isInteger(Number(r.stage_number)) || Number(r.stage_number) < 1) {
    throw new Error('invalid_approval_response');
  }
  return {
    projectId: r.project_id,
    stageId: r.stage_id,
    stageNumber: Number(r.stage_number),
    isFinal: r.is_final === true,
    nextStageId: (r.next_stage_id as string | null) ?? null,
    nextStageNumber: r.next_stage_number == null ? null : Number(r.next_stage_number),
    verificationId: (r.verification_id as string | null) ?? null,
    awaitingPayment: r.awaiting_payment === true,
    ...(r.awaiting_reviewed_stage_payment === true ? { awaitingReviewedStagePayment: true } : {}),
    alreadyApproved: r.already_approved === true,
    nextStageStatus: ['locked', 'active', 'pending_review', 'complete'].includes(String(r.next_stage_status))
      ? r.next_stage_status as StageStatus : undefined,
  };
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
  return stageApprovalResult(data);
}

/** The last substage approval completes its stage in the same database transaction. */
export async function approveSubstageRpc(substageId: string): Promise<ApproveStageResult | undefined> {
  const { data, error } = await supabase.rpc('approve_substage', { p_substage: substageId });
  if (error) throw error;
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.substage_id !== substageId || !('stage_approval' in result)) {
    throw new Error('invalid_approval_response');
  }
  return result.stage_approval == null ? undefined : stageApprovalResult(result.stage_approval);
}

// =========================================================
// The receipt handshake (175)
//
// Groundwork processes no payment. The client pays the contractor directly and attaches
// the proof; the contractor says it arrived; the stage opens. Three acts, three people,
// and the middle one is why the last cannot be faked:
//
//   client   → submitStagePaymentReceipt   state becomes receipt_submitted
//   contractor → confirmStagePayment       state becomes funded, and the stage opens
//
// Neither can do the other's half. A contractor confirming with no receipt is refused
// with `no_receipt`, and a client confirming their own payment with `not_contractor`.
// =========================================================

/** The amount on the receipt, never inferred from the stage's scheduled amount. */
export interface ReceiptPaymentInput {
  amount: string;
  currency: string;
  fxRate?: number | string;
  replacesReceiptId?: string;
}

function validateReceiptInput(input: ReceiptPaymentInput, requireRate = true): void {
  if (confirmedBillAmount(input.amount) === null) throw new Error('invalid_receipt_amount');
  if (!/^[A-Z]{3}$/.test(input.currency) || ((requireRate || input.fxRate != null) && (!Number.isFinite(Number(input.fxRate))
      || Number(input.fxRate) <= 0 || Number(input.fxRate) > 1e12 || (input.currency === 'USD' && Number(input.fxRate) !== 1)))) {
    throw new Error('invalid_receipt_currency');
  }
}

/** The client attaches proof and its actual amount. Does NOT open the stage. */
export async function submitStagePaymentReceipt(stageId: string, path: string, input: ReceiptPaymentInput, readingId?: string): Promise<void> {
  validateReceiptInput(input);
  const { error } = await supabase.rpc(input.replacesReceiptId?'replace_stage_payment_receipt':'submit_stage_payment_receipt', {
    p_stage: stageId, p_path: path, p_amount: input.amount,
    p_currency: input.currency, p_fx_rate: input.fxRate, p_reading: readingId,
    ...(input.replacesReceiptId?{p_receipt:input.replacesReceiptId}:{}),
  });
  if (error) throw error;
}

/** The contractor confirms the money arrived. This is what opens the stage. */
export async function confirmStagePayment(
  stageId: string, note?: string, receipt?: { path: string; uploadedAt: string },
): Promise<{ opened: boolean; tranches: number }> {
  const { data, error } = await supabase.rpc('confirm_stage_payment', {
    p_stage: stageId, p_note: note ?? null,
    ...(receipt ? { p_receipt_path: receipt.path, p_receipt_uploaded_at: receipt.uploadedAt } : {}),
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return { opened: r.opened === true, tranches: Number(r.tranches_confirmed ?? 0) };
}

// =========================================================
// What each stage is waiting on, money-wise (175, readable since 176)
// =========================================================

export interface StagePaymentReceipt {
  id: string; stageId: string; path: string; submittedAt: string;
  amount: number | null; currency: string | null; fxRate: number | null; amountUsd: number | null;
  decision: 'pending' | 'received' | 'flagged'; allowsWork: boolean;
  requestedTopUp: number | null; decisionNote: string | null; decidedAt: string | null;
  projectCurrency?: string | null; projectFxRate?: number | null; projectAmount?: number | null; fxSource?: string | null; fxAsOf?: string | null;
  replacedBy?:string|null;replacedAt?:string|null;
}

export async function decideStagePaymentReceipt(receiptId: string, decision: 'accept' | 'needs_top_up' | 'flag', note?: string, topUp?: string) {
  const { data, error } = await supabase.rpc('decide_stage_payment_receipt', {
    p_receipt: receiptId, p_decision: decision, p_note: note?.trim() || null, p_top_up: topUp || null,
  });
  if (error) throw error;
  return data;
}

export type StagePaymentState = 'expected' | 'receipt_submitted' | 'funded' | 'reconciled';

export interface StagePayment {
  id: string;
  stageId: string;
  state: StagePaymentState;
  amount: number;
  /** The client's proof. A storage path in the `evidence` bucket, not a URL. */
  receiptPath: string | null;
  receiptUploadedAt: string | null;
  /** Nullable for older receipts whose actual amount was never recorded. */
  receiptAmount?: number | null;
  receiptCurrency?: string | null;
  receiptFxRate?: number | null;
  receiptAmountUsd?: number | null;
  receipts?: StagePaymentReceipt[];
  receiptProjectCurrency?: string | null; receiptProjectAmount?: number | null;
}

/**
 * The incoming tranches on a project, by stage.
 *
 * One query for the whole project rather than one per stage: the stage list renders ten
 * of them and a request each would make opening a build ten round trips slower for a
 * table that is never more than a handful of rows.
 *
 * Returns an empty map rather than throwing. A stage with no incoming row owes nothing
 * — `payments.amount` is CHECKed > 0, so a free stage has no row at all — and that is
 * indistinguishable here from a project whose ledger has not been written yet. Neither
 * is an error, and neither should stop a build rendering.
 */
export async function fetchStagePayments(projectId: string, options: { strict?: boolean } = {}): Promise<Map<string, StagePayment>> {
  const out = new Map<string, StagePayment>();
  const { data, error } = await supabase
    .from('payments')
    .select('id, stage_id, state, amount, receipt_path, receipt_uploaded_at, receipt_amount, receipt_currency, receipt_fx_rate, receipt_amount_usd')
    .eq('project_id', projectId)
    .eq('direction', 'in');

  if (error && options.strict) throw error;
  if (error || !data) return out;

  const { data: history, error: historyError } = await supabase.from('stage_payment_receipts')
    .select('id,stage_id,path,submitted_at,amount,currency,fx_rate,amount_usd,decision,allows_work,requested_top_up,decision_note,decided_at,project_currency,project_fx_rate,project_amount,fx_source,fx_as_of,replaced_by,replaced_at')
    .eq('project_id', projectId).order('submitted_at', { ascending: true });
  if (historyError && options.strict) throw historyError;
  if (historyError) throw historyError;
  const receipts = new Map<string, StagePaymentReceipt[]>();
  for (const row of history ?? []) {
    const items = receipts.get(row.stage_id) ?? [];
    items.push({ id: row.id, stageId: row.stage_id, path: row.path, submittedAt: row.submitted_at,
      amount: row.amount == null ? null : Number(row.amount), currency: row.currency, fxRate: row.fx_rate == null ? null : Number(row.fx_rate),
      amountUsd: row.amount_usd == null ? null : Number(row.amount_usd), decision: row.decision, allowsWork: row.allows_work === true,
      requestedTopUp: row.requested_top_up == null ? null : Number(row.requested_top_up), decisionNote: row.decision_note, decidedAt: row.decided_at,
      projectCurrency: row.project_currency, projectFxRate: row.project_fx_rate == null ? null : Number(row.project_fx_rate),
      projectAmount: row.project_amount == null ? null : Number(row.project_amount), fxSource: row.fx_source, fxAsOf: row.fx_as_of,replacedBy:row.replaced_by,replacedAt:row.replaced_at });
    receipts.set(row.stage_id, items);
  }

  for (const row of data as Record<string, unknown>[]) {
    const stageId = row.stage_id as string | null;
    if (!stageId) continue;
    out.set(stageId, {
      id:                String(row.id),
      stageId,
      state:             row.state as StagePaymentState,
      amount:            Number(row.amount ?? 0),
      receipts: receipts.get(stageId) ?? [],
      receiptPath:       (row.receipt_path as string | null) ?? null,
      receiptUploadedAt: (row.receipt_uploaded_at as string | null) ?? null,
      receiptAmount:    row.receipt_amount == null ? null : Number(row.receipt_amount),
      receiptCurrency:  (row.receipt_currency as string | null) ?? null,
      receiptFxRate:    row.receipt_fx_rate == null ? null : Number(row.receipt_fx_rate),
      receiptAmountUsd: row.receipt_amount_usd == null ? null : Number(row.receipt_amount_usd),
    });
  }
  return out;
}

/** Money summaries must distinguish an unreadable ledger from a genuine zero. */
export async function fetchStagePaymentsStrict(projectId: string): Promise<Map<string, StagePayment>> {
  return fetchStagePayments(projectId, { strict: true });
}

/** The client's receipt, as something a contractor can actually open. */
export async function signReceiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('evidence').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Put the receipt in the bucket, then record it.
 *
 * Evidence-bucket reads are shared with the project team. The primary client can
 * write this project's receipts path; construction evidence writes remain reserved
 * for accepted contractors (migration 008).
 */
const stagedReceipts = new WeakMap<File, Map<string, { path: string; reading?: { readingId: string; path: string; amount: string; currency: string; fxRate: string } }>>();

export async function uploadStagePaymentReceipt(
  projectId: string, stageId: string, file: File, input: ReceiptPaymentInput,
): Promise<void> {
  validateReceiptInput(input, false);
  if (!file.size || file.size > MAX_RECEIPT_BYTES) throw new Error('receipt_file_size');
  if (!RECEIPT_ACCEPT.split(',').includes(file.type)) throw new Error('receipt_file_type');
  const key = `${projectId}:${stageId}`;
  let slots = stagedReceipts.get(file);
  if (!slots) { slots = new Map(); stagedReceipts.set(file, slots); }
  let staged = slots.get(key);
  if (!staged) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
    const path = `${projectId}/receipts/${crypto.randomUUID()}_${safe}`;
    const { error } = await supabase.storage.from('evidence').upload(path, file, { upsert: false });
    if (error) throw error;
    staged = { path }; slots.set(key, staged);
  }
  const amount = canonicalReceiptAmount(input.amount)!;
  if (!staged.reading || staged.reading.amount !== amount || staged.reading.currency !== input.currency) {
    const reading = await readUploadedReceipt(stageId, staged.path, amount, input.currency);
    staged.reading = { ...reading, amount, currency: input.currency };
  }
  // Stable file/proof identity makes retries safe even after a lost commit response.
  try {
    await submitStagePaymentReceipt(stageId, staged.reading.path, { ...input, fxRate: staged.reading.fxRate }, staged.reading.readingId);
  } catch (error) {
    if (/receipt_reading_expired|receipt_file_changed|receipt_reading_required/.test((error as Error)?.message ?? '')) staged.reading = undefined;
    throw error;
  }
}
