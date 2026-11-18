import type { ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';

// =========================================================
// The one thing a contractor should do next on a project (18 Nov redesign).
//
// The homeowner's project view opens on a single "Your next step" card; the contractor's
// now does too. Money first: a receipt waiting for the contractor holds the homeowner's
// work up, so it outranks everything. Then getting the homeowner onto the project, then
// the work itself. When the next move is the homeowner's, the card says so instead of
// inventing a task.
// =========================================================

type Stage = Pick<ProjectStageRow, 'id' | 'stage_number' | 'status' | 'review_payment_pending' | 'pre_existing'>;
type Item = Pick<ProjectSubstageRow, 'id' | 'status' | 'evidence_urls'>;

export type ContractorNextStep =
  | { kind: 'receipt'; stageId: string; receipt: StagePaymentReceipt }
  | { kind: 'invite' }
  | { kind: 'upload'; stageId: string; itemId: string }
  | { kind: 'awaitReview'; stageId: string; stageNumber: number }
  | { kind: 'awaitPayment'; stageId: string; stageNumber: number };

export interface NextStepInput<S extends Stage = Stage> {
  stages: S[];
  /** The stage being worked: active or under review. */
  current: S | undefined;
  stagePayments: Map<string, StagePayment>;
  /** May this person decide on a receipt for this stage? (primary contractor, stage reachable, project open) */
  canDecide: (stage: S) => boolean;
  /** The homeowner has not been invited and this person may invite them. */
  inviteHomeowner: boolean;
  /** The current stage's checklist. */
  items: Item[];
  /** May an update be uploaded on this item now? (stage funded, part paid, project active) */
  canUploadItem: (itemId: string) => boolean;
  /** Why uploads are closed on the current stage, when they are. */
  uploadBlocked: 'paused' | 'previous' | 'payment' | null;
}

/** Waiting receipts, oldest stage first, oldest receipt first: the order money arrived. */
export function receiptsToConfirm<S extends Stage>(stages: S[], stagePayments: Map<string, StagePayment>, canDecide: (stage: S) => boolean) {
  const out: { stageId: string; receipt: StagePaymentReceipt }[] = [];
  for (const stage of [...stages].sort((a, b) => a.stage_number - b.stage_number)) {
    if (stage.pre_existing || !canDecide(stage)) continue;
    const receipts = stagePayments.get(stage.id)?.receipts ?? [];
    for (const receipt of receipts) if (receipt.decision === 'pending' && !receipt.replacedBy) out.push({ stageId: stage.id, receipt });
  }
  return out;
}

export function contractorNextStep<S extends Stage>(input: NextStepInput<S>): ContractorNextStep | null {
  const waiting = receiptsToConfirm(input.stages, input.stagePayments, input.canDecide)[0];
  if (waiting) return { kind: 'receipt', ...waiting };
  if (input.inviteHomeowner) return { kind: 'invite' };
  const stage = input.current;
  if (!stage) return null;
  const open = input.items.filter(item => item.status !== 'complete');
  const uploadable = open.find(item => !(item.evidence_urls?.length) && input.canUploadItem(item.id));
  if (uploadable) return { kind: 'upload', stageId: stage.id, itemId: uploadable.id };
  if (input.uploadBlocked === 'paused') return null;
  if (stage.review_payment_pending || input.uploadBlocked === 'payment' || open.some(item => !(item.evidence_urls?.length) && !input.canUploadItem(item.id)))
    return { kind: 'awaitPayment', stageId: stage.id, stageNumber: stage.stage_number };
  if (stage.status === 'pending_review' || open.length > 0) return { kind: 'awaitReview', stageId: stage.id, stageNumber: stage.stage_number };
  return null;
}
