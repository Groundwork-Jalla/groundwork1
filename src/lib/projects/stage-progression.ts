import type { ProjectStageRow } from '@/types/project';
import type { ApproveStageResult, StagePayment } from '@/lib/supabase/verifications';

/** Construction order, independent of how the database returned the rows. */
export function orderedProjectStages(stages: ProjectStageRow[]): ProjectStageRow[] {
  return [...stages].sort((a, b) => a.stage_number - b.stage_number);
}

/** Historical work is reference material; the first unfinished stage is the action. */
export function currentProjectStage(stages: ProjectStageRow[]): ProjectStageRow | undefined {
  return orderedProjectStages(stages).find(stage => !stage.pre_existing && stage.status !== 'complete');
}

/** A future stage may be viewed, but cannot offer payment or work actions yet. */
export function canActOnProjectStage(stage: ProjectStageRow, stages: ProjectStageRow[]): boolean {
  return !stage.pre_existing && stage.status !== 'complete'
    && currentProjectStage(stages)?.id === stage.id
    && stages.every(previous => previous.stage_number >= stage.stage_number || previous.status === 'complete');
}

/** An uploaded receipt is still awaiting acknowledgment; a zero-cost stage has no row. */
export function stagePaymentAcknowledged(stage: ProjectStageRow, payment?: StagePayment): boolean {
  if (stage.pre_existing) return false;
  if (payment) return payment.state === 'funded' || payment.state === 'reconciled';
  if (stage.payment_milestone_usd == null) return false;
  const scheduled = Number(stage.payment_milestone_usd);
  // The ledger stores cents. Zero and sub-cent allocations never create a row;
  // a positive billed stage must have a real acknowledgment, not a legacy flag.
  return Number.isFinite(scheduled) && scheduled >= 0 && Math.round(scheduled * 100) === 0;
}

/** Reflect a committed server response while the full project refresh is arriving. */
export function projectStagesAfterApproval(stages: ProjectStageRow[], result: ApproveStageResult | null): ProjectStageRow[] {
  if (!result) return orderedProjectStages(stages);
  const nextNumber = result.nextStageNumber ?? stages.find(stage => stage.id === result.nextStageId)?.stage_number;
  return orderedProjectStages(stages).map<ProjectStageRow>(stage => {
    if (result.isFinal || stage.id === result.stageId || (nextNumber != null && stage.stage_number < nextNumber)) {
      return { ...stage, status: 'complete' };
    }
    if (stage.id === result.nextStageId) {
      return { ...stage, status: result.nextStageStatus ?? (result.alreadyApproved ? stage.status : result.awaitingPayment ? 'locked'
        : stage.status === 'pending_review' ? 'pending_review' : 'active') };
    }
    return stage;
  });
}

/** Stop overlaying the response once saved rows show that progress or something later. */
export function projectReflectsApproval(stages: ProjectStageRow[], result: ApproveStageResult): boolean {
  if (stages.length === 0) return false;
  if (result.isFinal) return stages.every(stage => stage.status === 'complete');
  const target = stages.find(stage => stage.id === result.nextStageId);
  if (!target || !stages.every(stage => stage.stage_number >= target.stage_number || stage.status === 'complete')) return false;
  if (result.nextStageStatus && target.status === result.nextStageStatus) return true;
  return target.status === 'complete' || target.status === 'active' || target.status === 'pending_review'
    || (result.awaitingPayment && target.status === 'locked');
}
