import { supabase } from './client';
import { canonicalReceiptAmount } from '@/lib/payments/receipt-reading';

export interface PriceStage {
  id: string; stage_number: number; stage_key: string | null; name: string; amount: string; editable: boolean;
}
export interface StagePriceChange {
  stage_id: string; stage_number: number; stage_key: string | null; name: string; before: string; after: string;
}
export interface StagePriceProposal {
  id: string; status: 'pending' | 'approved' | 'declined' | 'withdrawn'; proposed_at: string;
  note: string | null; currency: string; old_total: string; new_total: string; changes: StagePriceChange[];
  can_withdraw: boolean; stale: boolean;
}
export interface StagePriceContext {
  project_id: string; currency: string; fx_rate: string; total: string; base_hash: string;
  can_propose: boolean; can_approve: boolean; stages: PriceStage[]; history: StagePriceProposal[];
}
export async function fetchStagePriceContext(projectId: string): Promise<StagePriceContext> {
  const { data, error } = await supabase.rpc('stage_pricing_context', { p_project: projectId });
  if (error) throw error;
  if (data?.project_id !== projectId || !Array.isArray(data.stages) || !Array.isArray(data.history) || typeof data.base_hash !== 'string') throw new Error('stage_prices_unavailable');
  return data as StagePriceContext;
}

const units = (raw: string) => {
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};
const decimal = (value: bigint) => `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`;

/** Preview native changes exactly; the server independently computes the approved write. */
export function stagePricePreview(context: StagePriceContext, drafts: Record<string, string>) {
  let total = units(context.total);
  const rows: { stage_id: string; amount: string }[] = [];
  for (const stage of context.stages.filter(stage => stage.editable)) {
    const amount = canonicalReceiptAmount(drafts[stage.id] ?? stage.amount);
    if (!amount) return null;
    if (units(amount) === units(stage.amount)) continue;
    total += units(amount) - units(stage.amount); rows.push({ stage_id: stage.id, amount });
  }
  return total > 0n && total <= 1_000_000_000_000_000_000n ? { rows, total: decimal(total) } : null;
}
export async function proposeStagePrices(projectId: string, rows: { stage_id: string; amount: string }[], baseHash: string, note: string) {
  const { data, error } = await supabase.rpc('propose_stage_prices', { p_project: projectId, p_rows: rows, p_base_hash: baseHash, p_note: note.trim() || null });
  if (error) throw error;
  return data as string;
}
export async function decideStagePrices(proposalId: string, decision: 'approved' | 'declined' | 'withdrawn') {
  const { error } = await supabase.rpc('decide_stage_prices', { p_proposal: proposalId, p_decision: decision });
  if (error) throw error;
}
