import type { ProjectTier } from '@/types/project';

// =========================================================
// Who approves work on a project.
//
// The pair `tier === 'self_verify' || tier === 'starter'` was written out by hand in
// fourteen places. `starter` is the pre-rename name of the same plan (migration 008)
// and still sits in old rows, so every check has to carry both — which is exactly the
// kind of detail one call site eventually forgets.
// =========================================================

/**
 * True when the project owner is their own approver.
 *
 * On Self Verify nobody at Jalla reviews a stage: the owner uploads evidence and
 * approves it themselves — that is what the plan is. On Jalla Verify and Jalla
 * Management an independent verifier or Jalla staff decides, so the same screens have
 * to say something different.
 */
export function isSelfVerify(tier: ProjectTier | string | null | undefined): boolean {
  return tier === 'self_verify' || tier === 'starter';
}

/**
 * True when a stage on this plan waits on somebody other than the owner.
 *
 * Read this before showing any "in review" or "awaiting approval" wording: on Self
 * Verify there is nobody to wait for, and language that implies otherwise describes a
 * plan the owner did not buy.
 */
export function awaitsSomeoneElse(tier: ProjectTier | string | null | undefined): boolean {
  return !isSelfVerify(tier);
}
