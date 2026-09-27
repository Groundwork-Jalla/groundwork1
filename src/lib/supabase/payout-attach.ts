import { supabase } from './client';
import type { AttachRefusal } from '@/lib/payments/payout-reference';

/**
 * File the SwyChr transaction that paid an authorised release.
 *
 * No query here: `record_payment_event` is granted to the service role alone, so the
 * only door is `api/events?action=swychr-attach`, which checks `is_admin()` server-side
 * before it touches anything. See api/_handlers/swychr-attach.ts.
 */
export interface AttachResult {
  /** False when the same reference had already been filed — the ledger was unchanged. */
  recorded: boolean;
  reference: string;
}

/** Reason codes the server returns; everything else is an unexpected failure. */
export type AttachError = AttachRefusal | 'missing_payment' | 'not_found';

export async function attachPayoutReference(paymentId: string, reference: string): Promise<AttachResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');

  const r = await fetch('/api/events?action=swychr-attach', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, reference }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json?.ok !== true) throw new Error(String(json?.error ?? `http_${r.status}`));
  return { recorded: json.recorded === true, reference: String(json.reference ?? reference) };
}
