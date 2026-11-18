import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';
import type { ProjectStageRow } from '@/types/project';
import { stageReceiptBalance } from './stage-receipt-balance';

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
  /** The part of the stage this receipt pays for, on a stage paid by part. */
  substageId: string | null;
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
          status: statusOf(receipt), installment: receipt.paymentPlanId ? receipt.installmentNumber ?? null : null, substageId: receipt.substageId ?? null,
          note: receipt.decisionNote, path: receipt.path });
      }
    } else if (payment.receiptPath && payment.state !== 'expected') {
      // A receipt from before receipts were kept one by one: one proof on the tranche itself.
      rows.push({ id: payment.id, stageId: payment.stageId, submittedAt: payment.receiptUploadedAt,
        amount: payment.receiptAmount ?? null, currency: payment.receiptCurrency ?? null,
        projectAmount: payment.receiptProjectAmount ?? null, projectCurrency: payment.receiptProjectCurrency ?? null,
        status: payment.state === 'receipt_submitted' ? 'pending' : 'received', installment: null, substageId: null, note: null, path: payment.receiptPath });
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

// =========================================================
// Where each stage's money stands, for the payment history's summary and its
// "By stage" panel (18 Nov, built to the approved mock-up).
//
// Every figure comes from stageReceiptBalance, the rule the stage cards already use, so
// this screen cannot disagree with the stage it links to. Flagged and replaced receipts
// count for nothing; pending receipts are shown apart and never as paid.
// =========================================================

export type StagePaymentStanding = 'flagged' | 'pending' | 'paid' | 'partial' | 'unpaid';

export interface StagePaymentOverview {
  stageId: string;
  stageNumber: number;
  /** The stage price in the project currency. */
  due: number | null;
  received: number | null;
  pending: number | null;
  standing: StagePaymentStanding;
}

export interface PaymentOverview {
  stages: StagePaymentOverview[];
  /** Null when any stage cannot say; a total that leaves money out is withheld. */
  received: number | null;
  pending: number | null;
  due: number | null;
  remaining: number | null;
}

type OverviewStage = Pick<ProjectStageRow, 'id' | 'stage_number' | 'milestone_amount' | 'pre_existing'>;

const add = (values: (number | null)[]) => values.some(value => value == null) ? null
  : Math.round(values.reduce<number>((sum, value) => sum + (value as number), 0) * 1e6) / 1e6;

/**
 * Only stages with an incoming payment row are counted. A stage built before the project
 * joined Groundwork, or one that owes nothing, has no row and nothing to pay here.
 */
export function paymentOverview(stages: OverviewStage[], stagePayments: Map<string, StagePayment>, currency: string, rate: number): PaymentOverview {
  const rows: StagePaymentOverview[] = [];
  for (const stage of [...stages].sort((a, b) => a.stage_number - b.stage_number)) {
    const payment = stagePayments.get(stage.id);
    if (!payment || stage.pre_existing) continue;
    const scheduled = stage.milestone_amount != null && Number.isFinite(Number(stage.milestone_amount)) ? Number(stage.milestone_amount) : null;
    const balance = stageReceiptBalance(payment, currency, rate, scheduled);
    const due = scheduled ?? (Number.isFinite(payment.amount * rate) ? payment.amount * rate : null);
    const live = (payment.receipts ?? []).filter(receipt => !receipt.replacedBy);
    const standing: StagePaymentStanding = live.some(receipt => receipt.decision === 'flagged') ? 'flagged'
      : balance.pending == null || balance.pending > 0 ? 'pending'
      : balance.remaining === 0 && (due ?? 0) > 0 ? 'paid'
      : (balance.received ?? 0) > 0 ? 'partial' : 'unpaid';
    rows.push({ stageId: stage.id, stageNumber: stage.stage_number, due, received: balance.received, pending: balance.pending, standing });
  }
  const received = add(rows.map(row => row.received));
  const due = add(rows.map(row => row.due));
  return { stages: rows, received, pending: add(rows.map(row => row.pending)), due,
    remaining: add(rows.map(row => row.due == null || row.received == null ? null : Math.max(0, row.due - row.received))) };
}
