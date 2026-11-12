import { supabase } from './client';

export class ReceiptReadError extends Error {
  constructor(public code: string, public amount?: string, public currency?: string, public reference?: string) { super(code); }
}
export async function readUploadedReceipt(stageId: string, path: string, amount: string, currency: string): Promise<{ readingId: string; path: string; fxRate: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ReceiptReadError('sign_in_required');
  let response: Response;
  try { response = await fetch('/api/events?action=read-payment-receipt', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ stageId, path, amount, currency }),
  }); } catch { throw new ReceiptReadError('receipt_network_error'); }
  const payload = await response.json().catch(() => null);
  const result = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const reference = typeof result.reference === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(result.reference) ? result.reference : undefined;
  if (!response.ok || result.status !== 'matched' || typeof result.readingId !== 'string' || typeof result.path !== 'string') {
    const fallback = response.status === 401 ? 'receipt_sign_in_required' : response.status === 403 ? 'receipt_access_denied'
      : response.status === 504 ? 'receipt_reader_timeout' : [404,405].includes(response.status) || result.error === 'Unknown action' ? 'receipt_reader_not_configured' : 'receipt_reader_unavailable';
    throw new ReceiptReadError(typeof result.error === 'string' && result.error.startsWith('receipt_') ? result.error : fallback, result.amount, result.currency, reference);
  }
  if (typeof result.fxRate !== 'string' || !Number.isFinite(Number(result.fxRate)) || !(Number(result.fxRate) > 0)) throw new ReceiptReadError('receipt_rate_unavailable');
  return { readingId: result.readingId, path: result.path, fxRate: result.fxRate };
}
