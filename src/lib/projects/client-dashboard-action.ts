import type { ProjectRow, ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';
import { currentProjectStage, canActOnProjectStage, canSubmitStageReceipt, stageWorkReady } from './stage-progression';
import { stageReceiptBalance } from '@/lib/payments/stage-receipt-balance';
import { projectMoneyBasis } from '@/lib/budget/project-money';

export type ClientDashboardAction = { kind: 'review' | 'receipt' | 'pending' | 'waiting' | 'view'; stageNumber?: number };

/** A shortcut to an existing action, using the same permissions and funding gates as the project. */
export function clientDashboardAction(project: ProjectRow, stages: ProjectStageRow[], substages: ProjectSubstageRow[], payments: Map<string, StagePayment>, primaryClient: boolean): ClientDashboardAction {
  if (!primaryClient || project.status !== 'active' || !project.tracking_started_at) return { kind: 'view' };
  const stage = currentProjectStage(stages);
  if (!stage || !canActOnProjectStage(stage, stages)) return { kind: 'view' };
  const payment = payments.get(stage.id);
  const stageNumber = stage.stage_number;
  const ready = stageWorkReady(stage, stages, payment, project.workflow_origin);
  const updates = substages.filter(sub => sub.stage_id === stage.id);
  if (ready && !stage.review_payment_pending && stage.status !== 'locked' && updates.some(sub => sub.status !== 'complete' && sub.status !== 'locked' && sub.evidence_urls.length > 0)) {
    return { kind: 'review', stageNumber };
  }
  if (payment && canSubmitStageReceipt(stage, stages, project.workflow_origin)) {
    const live = payment.receipts?.filter(receipt => !receipt.replacedBy) ?? [];
    if (live.some(receipt => receipt.decision === 'pending') || (!live.length && payment.state === 'receipt_submitted')) return { kind: 'pending', stageNumber };
    const basis = projectMoneyBasis(project);
    const balance = stageReceiptBalance(payment, basis.code, basis.rate, stage.milestone_amount);
    if (balance.remaining != null && balance.remaining > 0) return { kind: 'receipt', stageNumber };
  }
  // An empty substage list is not permission to complete or approve a stage here.
  return { kind: 'waiting', stageNumber };
}
