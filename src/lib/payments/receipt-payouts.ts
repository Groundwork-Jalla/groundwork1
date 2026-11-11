import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';
import { projectBudget } from '@/lib/budget';
import { projectMoneyBasis } from '@/lib/budget/project-money';
import { stageBasisFor, stageScheduleUsd } from '@/lib/budget/stage-amounts';

export interface ReceiptAmount {
  amount: number;
  usd: number;
}

export interface ReceiptPayoutSummary {
  currency: string;
  payouts: ReceiptAmount;
  pending: ReceiptAmount;
  remaining: ReceiptAmount | null;
  overBudget: ReceiptAmount | null;
  currentStage: ReceiptAmount | null;
  missingConfirmedCount: number;
  missingPendingCount: number;
  confirmedCount: number;
  pendingCount: number;
}

const NATIVE_PRECISION = 6;
const USD_PRECISION = 9;

/** Add source units rather than allowing 0.1 + 0.2 to become a new amount. */
function units(value: number | null | undefined, precision: number): bigint | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value >= 1e21) return null;
  const fixed = value.toFixed(precision);
  if (!/^\d+(?:\.\d+)?$/.test(fixed)) return null;
  return BigInt(fixed.replace('.', ''));
}

function amount(native: bigint, usd: bigint): ReceiptAmount {
  return {
    amount: Number(native) / 10 ** NATIVE_PRECISION,
    usd: Number(usd) / 10 ** USD_PRECISION,
  };
}

const zero = () => amount(0n, 0n);
const stateOrder: Record<StagePayment['state'], number> = {
  expected: 0, receipt_submitted: 1, funded: 2, reconciled: 3,
};

/**
 * Direct client-to-contractor payments, shared by both project views.
 *
 * A stage allocation is a plan. Only the actual amount attached to a confirmed
 * receipt is a payout. Older confirmations with no amount stay unknown; neither
 * their scheduled ledger amount nor a completed-stage status supplies that fact.
 * All conversions use saved values and the project's canonical currency basis,
 * never a rate independently fetched by either participant's browser.
 */
export function receiptPayoutSummary(
  project: ProjectRow,
  stages: ProjectStageRow[],
  payments: Iterable<StagePayment>,
): ReceiptPayoutSummary {
  const { code: currency, rate, locked } = projectMoneyBasis(project);
  const validRate = Number.isFinite(rate) && rate > 0;
  const result: ReceiptPayoutSummary = {
    currency, payouts: zero(), pending: zero(), remaining: null,
    overBudget: null, currentStage: null,
    missingConfirmedCount: 0, missingPendingCount: 0,
    confirmedCount: 0, pendingCount: 0,
  };
  const byStage = new Map(stages.map(stage => [stage.id, stage]));

  // A refresh can carry the old and new snapshot of the same row. The most
  // advanced state wins, and a payment is still counted exactly once.
  const unique = new Map<string, StagePayment>();
  for (const payment of payments) {
    const stage = byStage.get(payment.stageId);
    if (!payment.id || !stage || stage.pre_existing || !(payment.state in stateOrder)) continue;
    const previous = unique.get(payment.id);
    if (!previous || stateOrder[payment.state] > stateOrder[previous.state]) {
      unique.set(payment.id, payment);
    }
  }

  let paidNative = 0n, paidUsd = 0n, pendingNative = 0n, pendingUsd = 0n;
  for (const payment of unique.values()) {
    const confirmed = payment.state === 'funded' || payment.state === 'reconciled';
    const pending = payment.state === 'receipt_submitted';
    if (!confirmed && !pending) continue;
    if (confirmed) result.confirmedCount++;
    else result.pendingCount++;

    const native = payment.receiptCurrency === currency
      ? units(payment.receiptAmount, NATIVE_PRECISION)
      : validRate && payment.receiptAmountUsd != null
        ? units(payment.receiptAmountUsd * rate, NATIVE_PRECISION) : null;
    const usd = units(payment.receiptAmountUsd, USD_PRECISION);
    const validReceipt = payment.receiptAmount != null && payment.receiptAmount > 0 && payment.receiptAmount <= 1e12
      && Number.isFinite(payment.receiptAmount)
      && typeof payment.receiptCurrency === 'string' && /^[A-Z]{3}$/.test(payment.receiptCurrency)
      && payment.receiptFxRate != null && Number.isFinite(payment.receiptFxRate)
      && payment.receiptFxRate > 0 && payment.receiptFxRate <= 1e12
      && payment.receiptAmountUsd != null && payment.receiptAmountUsd > 0 && payment.receiptAmountUsd <= 1e12
      && native != null && usd != null;
    if (!validReceipt) {
      if (confirmed) result.missingConfirmedCount++;
      else result.missingPendingCount++;
      continue;
    }
    if (confirmed) { paidNative += native; paidUsd += usd; }
    else { pendingNative += native; pendingUsd += usd; }
  }
  result.payouts = amount(paidNative, paidUsd);
  result.pending = amount(pendingNative, pendingUsd);

  const budget = projectBudget(project);
  let budgetUsd = units(budget.total, USD_PRECISION);
  let budgetNative = locked
    ? units(project.budget_amount, NATIVE_PRECISION)
    : validRate ? units(budget.total * rate, NATIVE_PRECISION) : null;

  // A mid-build BOQ includes the work that already stood on arrival. Its value
  // stays in the contract, but it is not available to spend again through this flow.
  for (const stage of stages.filter(stage => stage.pre_existing)) {
    const historicalUsd = units(stage.payment_milestone_usd ?? 0, USD_PRECISION);
    const historicalNative = locked && stage.milestone_amount != null
      ? units(stage.milestone_amount, NATIVE_PRECISION)
      : validRate ? units((stage.payment_milestone_usd ?? 0) * rate, NATIVE_PRECISION) : null;
    budgetUsd = budgetUsd != null && historicalUsd != null ? budgetUsd - historicalUsd : null;
    budgetNative = budgetNative != null && historicalNative != null ? budgetNative - historicalNative : null;
  }

  if (result.missingConfirmedCount === 0 && budgetNative != null && budgetUsd != null) {
    const nativeBalance = budgetNative - paidNative;
    const usdBalance = budgetUsd - paidUsd;
    result.remaining = amount(nativeBalance > 0n ? nativeBalance : 0n, usdBalance > 0n ? usdBalance : 0n);
    result.overBudget = amount(nativeBalance < 0n ? -nativeBalance : 0n, usdBalance < 0n ? -usdBalance : 0n);
  }

  const current = [...stages].sort((a, b) => a.stage_number - b.stage_number)
    .find(stage => !stage.pre_existing && stage.status !== 'complete');
  if (current) {
    const scheduled = stageScheduleUsd(current, stageBasisFor(project, stages, project.budget_source === 'boq'));
    const usd = units(scheduled, USD_PRECISION);
    const native = locked && current.milestone_amount != null
      ? units(current.milestone_amount, NATIVE_PRECISION)
      : validRate ? units(scheduled * rate, NATIVE_PRECISION) : null;
    if (native != null && usd != null) result.currentStage = amount(native, usd);
  }
  return result;
}
