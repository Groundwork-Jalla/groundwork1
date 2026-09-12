import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StageVerification } from '@/lib/supabase/verifications';

// =========================================================
// The one derived stage lifecycle. Never stored (Phase 3 §2, §8).
//
// `project_stages.status` has four values and keeps them. Everything the UI, the Action
// Center and the Overview call a "state" beyond those four is computed here from the
// stored inputs — status, the latest verification row, the project — and thrown away.
// If a screen needs it, it calls this. If a query needs it, it joins the inputs. Nothing
// caches the answer, because the moment an input changes the cache is a lie.
//
// Blockers are how the lifecycle explains itself without a second state:
// `{ state: 'approved', blockers: ['awaiting_funding'] }` is an approved stage that
// cannot yet be paid — not a new state, not a flag.
//
// This ships with 087, so it knows stage status and verifications. The payment states
// (`release_authorised`, `disbursed`, `payment_failed`) and the `awaiting_funding`
// blocker arrive with 090, when there is a ledger to read; until then `approved` is the
// end of the ladder and eligibility is not evaluated. Site updates (088) will add
// `evidence_submitted`.
// =========================================================

export type StageLifecycleState =
  | 'locked'
  | 'in_progress'
  | 'verification_pending'
  | 'verification_in_progress'
  | 'rejected'
  | 'verified'
  | 'approved'
  | 'completed';

export type StageBlocker =
  | 'verifier_not_selected'   // pending_review, verification required, nobody asked yet
  | 'on_hold';                // the project is on hold — reported on every state

export interface StageLifecycle {
  state: StageLifecycleState;
  blockers: StageBlocker[];
}

type StageInput   = Pick<ProjectStageRow, 'id' | 'status' | 'stage_number'> & { verification_required?: boolean | null };
type ProjectInput = Pick<ProjectRow, 'status'>;

/** Newest verification for the stage, by created_at then requested_at. */
function latest(verifications: StageVerification[], stageId: string): StageVerification | null {
  const mine = verifications.filter(v => v.stageId === stageId);
  if (mine.length === 0) return null;
  return mine.reduce((a, b) => (b.requestedAt > a.requestedAt ? b : a));
}

export function stageLifecycle(
  stage: StageInput,
  verifications: StageVerification[],
  project: ProjectInput,
  /** True when the stage after this one is active (or this is the last stage). */
  nextStageStarted: boolean = false,
): StageLifecycle {
  const blockers: StageBlocker[] = [];
  if (project.status === 'on_hold') blockers.push('on_hold');

  const required = stage.verification_required === true;
  const v = latest(verifications, stage.id);

  let state: StageLifecycleState;

  switch (stage.status) {
    case 'locked':
      state = 'locked';
      break;

    case 'active':
      // A rejection sends the stage back to `active`; until new work is submitted the
      // honest reading is "rejected", not "in progress".
      state = v && (v.decision === 'rejected' || v.decision === 'needs_more_evidence')
        ? 'rejected'
        : 'in_progress';
      break;

    case 'pending_review':
      if (!required) {
        // Self-verify never reaches pending_review; a non-required stage that does is
        // simply waiting on an approval with nothing to verify.
        state = 'verified';
      } else if (!v || v.decision === 'rejected' || v.decision === 'needs_more_evidence') {
        // No open request — either never asked, or the last one was a rejection and the
        // stage was resubmitted. Either way an admin has to pick a verifier.
        state = 'verification_pending';
        blockers.push('verifier_not_selected');
      } else if (v.decision === 'pending') {
        state = v.visitedAt ? 'verification_in_progress' : 'verification_pending';
      } else {
        state = 'verified';
      }
      break;

    case 'complete':
      state = nextStageStarted ? 'completed' : 'approved';
      break;

    default:
      state = 'locked';
  }

  return { state, blockers };
}

/** Sort key for "worst first" lists. */
export const STATE_SEVERITY: Record<StageLifecycleState, number> = {
  rejected: 0,
  verification_pending: 1,
  verification_in_progress: 2,
  verified: 3,
  in_progress: 4,
  approved: 5,
  locked: 6,
  completed: 7,
};
