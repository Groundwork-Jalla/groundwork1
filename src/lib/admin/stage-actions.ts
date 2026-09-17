import type { TKey } from '@/lib/i18n';
import type { StageView } from './workspace';

// =========================================================
// Which existing operation the Stages tab offers on a stage, and why one is unavailable.
//
// THE MODEL SAYS WHAT IS TRUE; THE RPC DECIDES WHAT IS PERMITTED (Favour, 18 Sep 2026).
// This table reads the assembled StageView — the derived lifecycle, its blockers, the
// newest verification, the tranche, the release row — and says which of the six existing
// acts is worth showing and whether to enable it. Nothing here is a second eligibility
// rule: every `reasonKey` is a sentence the database itself can answer with
// (`admin.ledger.refusal.*` are its `not_eligible:<reason>` codes, verbatim) or an
// existing precondition string (no verifier assigned, 087 not applied). When the button
// is enabled and the database still refuses, the modal shows that refusal; this table
// never overrides it.
//
// Six acts, six existing boundaries (05 §7):
//   request_verification  requestVerification()      087
//   record_verification   recordVerification()       087, on behalf, reason mandatory
//   approve               approveStageRpc()          087 approve_stage()
//   rework                adminRequestRework()       089 request_rework()
//   confirm_funding       confirmFunding()           090
//   authorise_release     authoriseRelease()         090, recomputed under a lock
// =========================================================

export type StageActionKind =
  | 'request_verification' | 'record_verification' | 'approve' | 'rework' | 'confirm_funding' | 'authorise_release';

export const STAGE_ACTIONS: readonly StageActionKind[] =
  ['request_verification', 'record_verification', 'approve', 'rework', 'confirm_funding', 'authorise_release'];

export interface StageActionContext {
  /** Verifiers currently assigned to the project (086, status active). */
  activeVerifiers: number;
  /** Accepted contractors with an account — the only legal release beneficiaries. */
  contractors: number;
  /** 087 applied (the verification rows could be read). */
  verificationsAvailable: boolean;
  /** 090 applied (the ledger could be read). */
  ledgerAvailable: boolean;
}

export interface StageAction {
  kind: StageActionKind;
  /** The act makes sense for this stage's state — render its row. */
  offered: boolean;
  /** The known preconditions hold — the button is live; the database still has the last word. */
  enabled: boolean;
  /** Why it is not enabled, in the existing vocabulary. Null when enabled or not offered. */
  reasonKey: TKey | null;
}

const off = (kind: StageActionKind): StageAction => ({ kind, offered: false, enabled: false, reasonKey: null });
const on  = (kind: StageActionKind): StageAction => ({ kind, offered: true, enabled: true, reasonKey: null });
const held = (kind: StageActionKind, reasonKey: TKey): StageAction => ({ kind, offered: true, enabled: false, reasonKey });

export function stageActions(view: StageView, ctx: StageActionContext): StageAction[] {
  const { stage, lifecycle, latestVerification: v, tranche, release } = view;
  const state = lifecycle.state;
  const onHold = lifecycle.blockers.includes('on_hold');
  const required = stage.verification_required === true;
  const pendingReview = stage.status === 'pending_review';
  const milestone = stage.payment_milestone_usd ?? 0;
  const liveRelease = !!release && release.state !== 'failed';

  // ── Request verification: pending review, required, and no request is open. (The
  // lifecycle reads `verification_pending` both for "nobody asked" and "asked, not yet
  // visited"; the open row is what tells them apart.)
  const openRequest = v?.decision === 'pending';
  const request: StageAction =
    !(pendingReview && required && state === 'verification_pending' && !openRequest) ? off('request_verification')
    : !ctx.verificationsAvailable ? held('request_verification', 'admin.verification.unavailable')
    : ctx.activeVerifiers === 0   ? held('request_verification', 'admin.verification.noVerifiers')
    : on('request_verification');

  // ── Record on behalf: there is an open request. The modal makes the reason mandatory.
  const record: StageAction = v?.decision === 'pending' ? on('record_verification') : off('record_verification');

  // ── Approve: pending review; live once verified (or not required). 087's approve_stage() re-checks.
  const approve: StageAction =
    !pendingReview ? off('approve')
    : state === 'verified' ? on('approve')
    : held('approve', 'admin.verification.approveBlocked');

  // ── Rework: any stage under review can be sent back. 089's request_rework() re-checks.
  const rework: StageAction = pendingReview ? on('rework') : off('rework');

  // ── Confirm received: approved and waiting on money, with an expected tranche to confirm.
  const awaitingFunding = state === 'approved' && lifecycle.blockers.includes('awaiting_funding');
  const confirm: StageAction =
    !awaitingFunding ? off('confirm_funding')
    : !ctx.ledgerAvailable ? held('confirm_funding', 'admin.ledger.unavailable')
    : tranche?.state === 'expected' ? on('confirm_funding')
    : held('confirm_funding', 'admin.workspace.stages.noTranche');

  // ── Authorise release: a complete stage that owes something and has no live release.
  // Enabled only when the model already reads payment_eligible AND someone can receive
  // it; otherwise the reason is the database's own code for what it would refuse.
  // Held only for a reason the model can already see (its codes are stage_release_blocker()'s
  // own); for anything else — a failed release being retried, say — the button is live and
  // authorise_release() answers, because guessing a reason here would be a second rule.
  const authorise: StageAction =
    !(stage.status === 'complete' && milestone > 0 && !liveRelease) ? off('authorise_release')
    : !ctx.ledgerAvailable ? held('authorise_release', 'admin.ledger.unavailable')
    : ctx.contractors === 0 ? held('authorise_release', 'admin.ledger.noContractor')
    : onHold ? held('authorise_release', 'admin.ledger.refusal.on_hold')
    : state === 'payment_eligible' ? on('authorise_release')
    : lifecycle.blockers.includes('awaiting_funding') ? held('authorise_release', 'admin.ledger.refusal.insufficient_funds')
    : state === 'approved' && required && v?.decision !== 'verified' ? held('authorise_release', 'admin.ledger.refusal.not_verified')
    : on('authorise_release');

  return [request, record, approve, rework, confirm, authorise];
}
