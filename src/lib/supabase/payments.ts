import { supabase } from './client';
import { isMissingTable } from '@/lib/errors';
import { isMissingRpc } from './activity';

// =========================================================
// The financial ledger (090). Groundwork's side of the money boundary.
//
// `payments` is the record of business state: what is expected from the client, what has
// been confirmed as received, and every release a person authorised — who, to whom, how
// much, when. What the provider does with a release (SwyChr, not yet integrated) arrives
// as provider events and moves the row on; nothing here fabricates that.
//
// Nothing in this module writes a row. The four writers are SECURITY DEFINER RPCs that
// re-check the actor and recompute eligibility inside the transaction; the browser can
// only read, and only what RLS lets it: an admin everything, an owner their project's
// rows, a contractor the releases addressed to them.
//
// `project_stages.payment_status` is a projection of this ledger with one writer (a
// trigger). It is kept only for the readers that predate 090; read `payments` and
// stageLifecycle() in new code.
// =========================================================

export type PaymentDirection = 'in' | 'out';
export type PaymentState =
  | 'expected' | 'funded' | 'reconciled'                                  // in
  | 'release_authorised' | 'initiated' | 'disbursed' | 'failed' | 'reconciling'; // out
export type FundingSource = 'provider' | 'staff_confirmed';

export interface Payment {
  id: string;
  projectId: string;
  stageId: string | null;
  direction: PaymentDirection;
  state: PaymentState;
  amount: number;
  currency: 'USD' | 'XAF';
  beneficiaryId: string | null;
  fundingSource: FundingSource | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  authorisedBy: string | null;
  authorisedAt: string | null;
  note: string | null;
  provider: string | null;
  providerRef: string | null;
  failureReason: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS =
  'id, project_id, stage_id, direction, state, amount, currency, beneficiary_id, funding_source, ' +
  'confirmed_by, confirmed_at, authorised_by, authorised_at, note, provider, provider_ref, ' +
  'failure_reason, settled_at, created_at, updated_at';

function rowToPayment(r: Record<string, unknown>): Payment {
  return {
    id:            r.id as string,
    projectId:     r.project_id as string,
    stageId:       (r.stage_id as string | null) ?? null,
    direction:     r.direction as PaymentDirection,
    state:         r.state as PaymentState,
    amount:        Number(r.amount),
    currency:      r.currency as 'USD' | 'XAF',
    beneficiaryId: (r.beneficiary_id as string | null) ?? null,
    fundingSource: (r.funding_source as FundingSource | null) ?? null,
    confirmedBy:   (r.confirmed_by as string | null) ?? null,
    confirmedAt:   (r.confirmed_at as string | null) ?? null,
    authorisedBy:  (r.authorised_by as string | null) ?? null,
    authorisedAt:  (r.authorised_at as string | null) ?? null,
    note:          (r.note as string | null) ?? null,
    provider:      (r.provider as string | null) ?? null,
    providerRef:   (r.provider_ref as string | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
    settledAt:     (r.settled_at as string | null) ?? null,
    createdAt:     r.created_at as string,
    updatedAt:     r.updated_at as string,
  };
}

/** The ledger for one project. `available: false` when 090 is not applied yet. */
export async function listProjectPayments(projectId: string): Promise<{ rows: Payment[]; available: boolean }> {
  const { data, error } = await supabase
    .from('payments')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToPayment), available: true };
}

/** Every row the caller may see (an admin: all of them). */
export async function listAllPayments(): Promise<{ rows: Payment[]; available: boolean }> {
  const { data, error } = await supabase
    .from('payments')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToPayment), available: true };
}

/**
 * Staff confirm that an expected tranche arrived — the interim path approved 12 Sep 2026,
 * distinct from provider confirmation. Admin only; refuses `not_admin:`, `wrong_state:`.
 */
export async function confirmFunding(paymentId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_funding', { p_payment: paymentId, p_note: note ?? null });
  if (error) throw error;
}

/**
 * A person releases money for a stage. The database recomputes eligibility under a lock
 * and refuses `not_eligible:<not_complete|not_verified|over_milestone|insufficient_funds|on_hold>`,
 * `bad_beneficiary:`, `already_authorised:`, `not_admin:`. Returns the payment id.
 */
export async function authoriseRelease(stageId: string, amount: number, beneficiaryId: string, note?: string): Promise<string> {
  const { data, error } = await supabase.rpc('authorise_release', {
    p_stage: stageId, p_amount: amount, p_beneficiary: beneficiaryId, p_note: note ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Staff open an investigation into a failed disbursement. The provider decides the outcome. */
export async function openReconciliation(paymentId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('open_reconciliation', { p_payment: paymentId, p_note: note ?? null });
  if (error) throw error;
}

/** Is this the "090 not applied yet" refusal, so a screen can fall back? */
export function isPaymentsUnavailable(err: unknown): boolean {
  return isMissingTable(err) || isMissingRpc(err);
}

/** The reason inside a `not_eligible:<reason>` refusal, or null for any other error. */
export function ineligibilityReason(err: unknown): string | null {
  const msg = (err as { message?: string } | null)?.message ?? '';
  const m = /not_eligible:(\w+)/.exec(msg);
  return m ? m[1] : null;
}
