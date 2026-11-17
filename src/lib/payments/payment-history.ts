import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';

// =========================================================
// Every payment the client has recorded on a project, as one trail.
//
// Asked for on 16 November: the contractor's Money tab showed the contract, the provider
// transfers and the stage schedule, and nowhere the receipts themselves. Payouts track
// money moved by a payment provider, which is not connected yet, so the money that has
// actually changed hands — proven by receipts — had no place to be read back.
//
// A trail, not a balance. It keeps flagged and replaced receipts, because "what was sent
// and what became of it" is the question. The stage card remains the place that says
// what is owed; nothing here is used to decide anything.
// =========================================================

export type PaymentHistoryStatus = 'received' | 'pending' | 'flagged' | 'replaced';

export interface PaymentHistoryRow {
  id: string;
  stageId: string;
  submittedAt: string | null;
  /** The receipt's own money, exactly as printed on it. */
  amount: number | null;
  currency: string | null;
  /** The same payment in the project currency, at the rate saved when it was uploaded. */
  projectAmount: number | null;
  projectCurrency: string | null;
  status: PaymentHistoryStatus;
  installment: 1 | 2 | null;
  note: string | null;
  path: string | null;
}

function statusOf(receipt: Pick<StagePaymentReceipt, 'decision' | 'replacedBy'>): PaymentHistoryStatus {
  if (receipt.replacedBy) return 'replaced';
  return receipt.decision === 'received' ? 'received' : receipt.decision === 'flagged' ? 'flagged' : 'pending';
}

/** Newest first. A row whose date is missing sorts last rather than pretending to be new. */
export function paymentHistoryRows(stagePayments: Map<string, StagePayment>): PaymentHistoryRow[] {
  const rows: PaymentHistoryRow[] = [];
  for (const payment of stagePayments.values()) {
    if (payment.receipts?.length) {
      for (const receipt of payment.receipts) {
        rows.push({ id: receipt.id, stageId: payment.stageId, submittedAt: receipt.submittedAt || null,
          amount: receipt.amount, currency: receipt.currency,
          projectAmount: receipt.projectAmount ?? null, projectCurrency: receipt.projectCurrency ?? null,
          status: statusOf(receipt), installment: receipt.paymentPlanId ? receipt.installmentNumber ?? null : null,
          note: receipt.decisionNote, path: receipt.path });
      }
    } else if (payment.receiptPath && payment.state !== 'expected') {
      // A receipt from before receipts were kept one by one: one proof on the tranche itself.
      rows.push({ id: payment.id, stageId: payment.stageId, submittedAt: payment.receiptUploadedAt,
        amount: payment.receiptAmount ?? null, currency: payment.receiptCurrency ?? null,
        projectAmount: payment.receiptProjectAmount ?? null, projectCurrency: payment.receiptProjectCurrency ?? null,
        status: payment.state === 'receipt_submitted' ? 'pending' : 'received', installment: null, note: null, path: payment.receiptPath });
    }
  }
  const time = (row: PaymentHistoryRow) => { const value = row.submittedAt ? Date.parse(row.submittedAt) : NaN; return Number.isFinite(value) ? value : -Infinity; };
  return rows.sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id));
}

/**
 * What the contractor has confirmed receiving, in the project currency.
 *
 * Null when any confirmed receipt cannot be expressed in that currency. A total that
 * leaves a payment out is a number that looks complete and is not, so it is withheld.
 */
export function confirmedInProjectCurrency(rows: PaymentHistoryRow[], projectCurrency: string): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.status !== 'received') continue;
    if (row.projectAmount != null && row.projectCurrency === projectCurrency) total += row.projectAmount;
    else if (row.amount != null && row.currency === projectCurrency) total += row.amount;
    else return null;
  }
  return total;
}
