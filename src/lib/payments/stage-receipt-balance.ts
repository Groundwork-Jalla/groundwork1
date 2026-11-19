import type { StagePayment, StagePaymentReceipt } from '../supabase/verifications';

function units(value: number | null | undefined): bigint | null {
  return value != null && Number.isFinite(value) && value >= 0 && value < 1e18
    ? BigInt(value.toFixed(6).replace('.', '')) : null;
}
/** Confirmed partial payments reduce the stage budget; pending receipts stay separate. */
export function stageReceiptBalance(payment: StagePayment, currency: string, projectRate: number, scheduledAmount?: number | null) {
  const due = units(scheduledAmount ?? payment.amount * projectRate);
  const receipts: Pick<StagePaymentReceipt, 'id' | 'decision' | 'amount' | 'currency' | 'amountUsd' | 'projectAmount' | 'projectCurrency' | 'replacedBy'>[] = payment.receipts?.length
    ? payment.receipts : payment.state === 'funded' || payment.state === 'reconciled' || payment.state === 'receipt_submitted'
      ? [{ id: payment.id, decision: payment.state === 'receipt_submitted' ? 'pending' : 'received',
        amount: payment.receiptAmount ?? null, currency: payment.receiptCurrency ?? null, amountUsd: payment.receiptAmountUsd ?? null }] : [];
  let received = 0n, pending = 0n, receivedKnown = true, pendingKnown = true;
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (seen.has(receipt.id) || receipt.decision === 'flagged' || receipt.replacedBy) continue;
    seen.add(receipt.id);
    const amount = receipt.projectCurrency === currency && receipt.projectAmount != null ? units(receipt.projectAmount)
      : receipt.currency === currency ? units(receipt.amount)
      : receipt.amountUsd != null ? units(receipt.amountUsd * projectRate) : null;
    if (receipt.decision === 'received') { if (amount == null) receivedKnown = false; else received += amount; }
    else { if (amount == null) pendingKnown = false; else pending += amount; }
  }
  return { received: receivedKnown ? Number(received) / 1e6 : null,
    pending: pendingKnown ? Number(pending) / 1e6 : null,
    remaining: receivedKnown && due != null ? Number(due > received ? due - received : 0n) / 1e6 : null };
}

/**
 * How far confirmed money (plus, optionally, an amount about to be sent) goes past the
 * stage price, in the project currency. `remaining` above stops at zero, so it cannot
 * say this. Display only: the carry-forward itself is project_payment_allocation's job.
 * Null when the figures are not all known, 0 when nothing is over.
 */
export function stageReceiptExcess(balance: { received: number | null; remaining: number | null },
  scheduled: number | null | undefined, adding = 0): number | null {
  const due = units(scheduled ?? null); const received = units(balance.received); const extra = units(adding);
  if (due == null || received == null || extra == null) return null;
  const total = received + extra;
  return total > due ? Number(total - due) / 1e6 : 0;
}

/**
 * Same as `stageReceiptExcess`, but includes pending (unconfirmed) receipts already
 * uploaded on the stage. Catches overpayments split across multiple pending receipts
 * (including foreign-currency receipts whose project equivalents are already stored).
 */
export function stageReceiptTotalExcess(
  balance: { received: number | null; pending: number | null; remaining: number | null },
  scheduled: number | null | undefined,
  adding = 0,
): number | null {
  const due = units(scheduled ?? null);
  const received = units(balance.received ?? 0);
  const pending = units(balance.pending ?? 0);
  const extra = units(adding);
  if (due == null || received == null || pending == null || extra == null) return null;
  if (balance.received == null && balance.pending == null) return null;
  const total = received + pending + extra;
  return total > due ? Number(total - due) / 1e6 : 0;
}
