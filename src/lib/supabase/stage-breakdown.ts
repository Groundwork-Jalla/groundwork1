import { supabase } from './client';

// =========================================================
// A stage's price split across its sub-stages (20261118000000).
//
// The contractor proposes, the client approves, and every proposal stays on record. The
// parts always add up to the stage price exactly; the database checks that again, so the
// arithmetic here only decides whether the Send button is ready.
// =========================================================

export interface BreakdownSubstage {
  id: string; number: number | null; name: string; key: string | null; status: string;
  amount: string | null; added: boolean;
}
export interface BreakdownLine { substage_id?: string; name: string; key?: string | null; before: string | null; amount: string }
export interface BreakdownProposal {
  id: string; status: 'pending' | 'approved' | 'declined' | 'withdrawn'; proposed_at: string; decided_at: string | null;
  note: string | null; currency: string; stage_amount: string; lines: BreakdownLine[]; stale: boolean; can_withdraw: boolean;
}
export interface StageBreakdownContext {
  stage_id: string; project_id: string; stage_number: number; currency: string; stage_amount: string; split: boolean;
  substages: BreakdownSubstage[]; base_hash: string; editable: boolean; history: BreakdownProposal[];
  can_propose: boolean; can_decide: boolean;
}

export async function fetchStageBreakdown(stageId: string): Promise<StageBreakdownContext> {
  const { data, error } = await supabase.rpc('stage_breakdown_context', { p_stage: stageId });
  if (error) throw error;
  if (data?.stage_id !== stageId || !Array.isArray(data.substages) || !Array.isArray(data.history) || typeof data.base_hash !== 'string') {
    throw new Error('stage_breakdown_unavailable');
  }
  return data as StageBreakdownContext;
}

/** One row of the contractor's draft: an existing sub-stage, or a new one with a name. */
export interface BreakdownDraftRow { substageId?: string; name: string; amount: string }

const AMOUNT = /^\d{1,13}(?:\.\d{1,6})?$/;
const units = (raw: string) => {
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};
const decimal = (value: bigint) => {
  const sign = value < 0n ? '-' : ''; const v = value < 0n ? -value : value;
  const tail = String(v % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `${sign}${v / 1_000_000n}${tail ? `.${tail}` : ''}`;
};

/**
 * How far the draft is from the stage price, exactly.
 *
 * `remaining` is what is still to allocate (negative when over). `lines` is what the RPC
 * takes, and is only returned when every row is valid and the parts add up exactly.
 */
export function breakdownDraft(stageAmount: string, rows: BreakdownDraftRow[]) {
  let total = 0n; let valid = rows.length > 0;
  for (const row of rows) {
    const amount = row.amount.trim();
    if (!AMOUNT.test(amount)) { valid = false; continue; }
    if (!row.substageId && !row.name.trim()) valid = false;
    total += units(amount);
  }
  const target = units(stageAmount);
  // Stages that start at 0 (Stage 1 Land, Stage 2 Design) let the contractor define
  // each substage's cost directly; their positive sum becomes the proposed stage total.
  const flexibleTotal = target === 0n;
  const remaining = flexibleTotal ? 0n : target - total;
  const ready = flexibleTotal ? (valid && total > 0n) : (valid && remaining === 0n);
  return {
    allocated: decimal(total), remaining: decimal(remaining), ready, flexibleTotal,
    lines: ready ? rows.map(row => row.substageId
      ? { substage_id: row.substageId, amount: row.amount.trim() }
      : { name: row.name.trim(), amount: row.amount.trim() }) : null,
  };
}

/**
 * Distribute a stage amount evenly across every draft row using exact integer
 * arithmetic, placing any rounding remainder on the final row so the sum
 * always equals `stageAmount` with zero remaining.
 */
export function splitBreakdownEvenly(stageAmount: string, rows: BreakdownDraftRow[]): BreakdownDraftRow[] {
  if (rows.length === 0 || !AMOUNT.test(stageAmount.trim())) return rows;
  const totalUnits = units(stageAmount.trim());
  const count = BigInt(rows.length);
  // Pick the cleanest currency quantum that divides stageAmount evenly:
  // whole units for XAF/NGN-style integers, cents (0.01) for 2-decimal totals, else micro-units.
  const quantum = totalUnits % 1_000_000n === 0n
    ? 1_000_000n
    : totalUnits % 10_000n === 0n
      ? 10_000n
      : 1n;
  const totalQuanta = totalUnits / quantum;
  const base = totalQuanta / count;
  const remainder = totalQuanta - base * count;
  return rows.map((row, idx) => {
    const share = (idx === rows.length - 1 ? base + remainder : base) * quantum;
    return { ...row, amount: decimal(share) };
  });
}

export async function proposeStageBreakdown(context: StageBreakdownContext, lines: NonNullable<ReturnType<typeof breakdownDraft>['lines']>, note: string) {
  const { data, error } = await supabase.rpc('propose_stage_breakdown', {
    p_stage: context.stage_id, p_lines: lines, p_base_hash: context.base_hash, p_note: note.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

export async function decideStageBreakdown(proposalId: string, decision: 'approved' | 'declined' | 'withdrawn') {
  const { error } = await supabase.rpc('decide_stage_breakdown', { p_proposal: proposalId, p_decision: decision });
  if (error) throw error;
}

/** Add a new unpriced substage directly to a non-split stage (23 Nov). */
export async function addProjectSubstage(stageId: string, name: string) {
  const { data, error } = await supabase.rpc('add_project_substage', {
    p_stage: stageId,
    p_name: name.trim(),
  });
  if (error) throw error;
  return data;
}
