import { supabase } from './client';

export class ReceiptReadError extends Error {
  constructor(public code: string, public amount?: string, public currency?: string) { super(code); }
}
export async function readUploadedReceipt(stageId: string, path: string, amount: string, currency: string): Promise<{ readingId: string; path: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ReceiptReadError('sign_in_required');
  const response = await fetch('/api/events?action=read-payment-receipt', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ stageId, path, amount, currency }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== 'matched' || typeof result.readingId !== 'string' || typeof result.path !== 'string') {
    throw new ReceiptReadError(typeof result.error === 'string' ? result.error : 'receipt_reader_unavailable', result.amount, result.currency);
  }
  return { readingId: result.readingId, path: result.path };
}
