import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { Payment } from '@/lib/supabase/payments';

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
// Ships with 087 (status + verifications), 088 (site updates → `evidence_submitted`) and
// 090 (the ledger → eligibility, `release_authorised`, `disbursement_initiated`,
// `disbursed`, `payment_failed`, and the `awaiting_funding` blocker).
//
// ELIGIBILITY IS COMPUTED HERE AND NOWHERE STORED. It never reads
// `project_stages.payment_status` — that column is a projection of the same ledger, kept
// for older screens. The same rule runs again inside authorise_release() in SQL, under a
// lock, and that is the one that decides; this one only tells a screen what to show.
//
//   eligible ⇔ complete ∧ (¬verification_required ∨ latest decision = verified)
//            ∧ funded − disbursed − authorised ≥ milestone ∧ project not on_hold
//
// `payments === null` means "no ledger to read" (090 not applied): the ladder ends at
// `approved` and no funding blocker is reported, as before 090.
// =========================================================

export type StageLifecycleState =
  | 'locked'
  | 'in_progress'
  | 'evidence_submitted'
  | 'verification_pending'
  | 'verification_in_progress'
  | 'rejected'
  | 'verified'
  | 'approved'
  | 'payment_eligible'
  | 'release_authorised'
  | 'disbursement_initiated'
  | 'disbursed'
  | 'payment_failed'
  | 'completed';

export type StageBlocker =
  | 'verifier_not_selected'   // pending_review, verification required, nobody asked yet
  | 'awaiting_funding'        // approved, but funded − disbursed − authorised < milestone
  | 'on_hold';                // the project is on hold — reported on every state

export interface StageLifecycle {
  state: StageLifecycleState;
  blockers: StageBlocker[];
}

type StageInput   = Pick<ProjectStageRow, 'id' | 'status' | 'stage_number'> & { verification_required?: boolean | null; payment_milestone_usd?: number | null };
type LedgerRow    = Pick<Payment, 'stageId' | 'direction' | 'state' | 'amount' | 'createdAt'>;

/** Funds the project can still release: funded − every live out row (authorised, initiated, disbursed, reconciling). */
export function availableFunds(payments: LedgerRow[]): number {
  const funded = payments.filter(p => p.direction === 'in' && (p.state === 'funded' || p.state === 'reconciled')).reduce((a, p) => a + p.amount, 0);
  const out    = payments.filter(p => p.direction === 'out' && p.state !== 'failed').reduce((a, p) => a + p.amount, 0);
  return funded - out;
}

/** The newest out row for the stage, live or failed. */
function latestRelease(payments: LedgerRow[], stageId: string): LedgerRow | null {
  const mine = payments.filter(p => p.direction === 'out' && p.stageId === stageId);
  if (mine.length === 0) return null;
  return mine.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}
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
  /** When work was last reported on this stage (088). Null: no site update yet. */
  lastSiteUpdateAt: string | null = null,
  /** The project's ledger rows (090). Null: no ledger to read — eligibility is not evaluated. */
  payments: LedgerRow[] | null = null,
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

    case 'active': {
      const rejected = !!v && (v.decision === 'rejected' || v.decision === 'needs_more_evidence');
      // Work reported since the last decision (or at all) is what moves a stage on —
      // from in_progress, and from rejected once the contractor has responded.
      const freshEvidence = !!lastSiteUpdateAt && (!v?.decidedAt || lastSiteUpdateAt > v.decidedAt);
      state = freshEvidence ? 'evidence_submitted' : rejected ? 'rejected' : 'in_progress';
      break;
    }

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

    case 'complete': {
      const release = payments ? latestRelease(payments, stage.id) : null;
      if (release && release.state !== 'failed') {
        // Money is moving or moved: the ledger row is the state.
        state = release.state === 'release_authorised' ? 'release_authorised'
              : release.state === 'initiated'          ? 'disbursement_initiated'
              : release.state === 'disbursed'          ? (nextStageStarted ? 'completed' : 'disbursed')
              : 'payment_failed';                        // reconciling
        break;
      }
      if (release?.state === 'failed') { state = 'payment_failed'; break; }
      if (!payments) { state = nextStageStarted ? 'completed' : 'approved'; break; }
      // Approved and unpaid: eligible only when verified (if required), funded, and not on
      // hold. Otherwise approved with the first reason as a blocker — never a stored flag.
      const verifiedOk = !required || v?.decision === 'verified';
      const milestone  = stage.payment_milestone_usd ?? 0;
      if (availableFunds(payments) < milestone) blockers.push('awaiting_funding');
      state = verifiedOk && blockers.length === 0 ? 'payment_eligible' : 'approved';
      break;
    }

    default:
      state = 'locked';
  }

  return { state, blockers };
}

/** Sort key for "worst first" lists. */
export const STATE_SEVERITY: Record<StageLifecycleState, number> = {
  payment_failed: 0,
  rejected: 1,
  verification_pending: 2,
  verification_in_progress: 3,
  payment_eligible: 4,
  verified: 5,
  evidence_submitted: 6,
  in_progress: 7,
  approved: 8,
  release_authorised: 9,
  disbursement_initiated: 10,
  disbursed: 11,
  locked: 12,
  completed: 13,
};
