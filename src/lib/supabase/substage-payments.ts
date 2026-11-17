import { useEffect, useRef, useState } from 'react';
import { supabase } from './client';

// =========================================================
// A stage paid part by part (20261118000100).
//
// Each part is paid before its work, and the next part's payment opens once the client
// approves the previous part's work. The database decides all of it; this only reads
// where each part stands so the screen can say so and offer the right part.
// =========================================================

export interface SubstagePaymentPart {
  id: string; number: number | null; name: string; key: string | null; status: string;
  price: string; covered: string; remaining: string; pending: string;
  paid: boolean; payable: boolean; work_ready: boolean;
}
export interface SubstagePaymentContext {
  stage_id: string; split: boolean; currency?: string; parts?: SubstagePaymentPart[]; next_payable?: string | null;
}

export async function fetchSubstagePayments(stageId: string): Promise<SubstagePaymentContext> {
  const { data, error } = await supabase.rpc('substage_payment_context', { p_stage: stageId });
  if (error) throw error;
  if (data?.stage_id !== stageId || typeof data.split !== 'boolean') throw new Error('substage_payments_unavailable');
  return data as SubstagePaymentContext;
}

/** Where each part of a split stage stands. Null until read, or when the stage is not split. */
export function useSubstagePayments(stageId: string | null | undefined, paidByPart: boolean, refreshKey?: unknown) {
  const [read, setRead] = useState<{ stage: string; context: SubstagePaymentContext } | null>(null);
  const turn = useRef(0);
  useEffect(() => {
    if (!stageId || !paidByPart) return;
    let alive = true;
    const load = async () => {
      const request = ++turn.current;
      try {
        const context = await fetchSubstagePayments(stageId);
        if (alive && request === turn.current) setRead({ stage: stageId, context });
      } catch { /* The database still enforces every rule; the screen just says less. */ }
    };
    void load();
    window.addEventListener('focus', load);
    return () => { alive = false; window.removeEventListener('focus', load); };
  }, [stageId, paidByPart, refreshKey]);
  return paidByPart && read && read.stage === stageId && read.context.split ? read.context : null;
}

/** May work be uploaded on this part? True for every part of a stage that is not split. */
export function partWorkReady(context: SubstagePaymentContext | null, paidByPart: boolean, substageId: string): boolean {
  if (!paidByPart) return true;
  return !!context?.parts?.find(part => part.id === substageId)?.work_ready;
}
