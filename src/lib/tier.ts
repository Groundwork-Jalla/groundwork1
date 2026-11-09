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
 * Temporary free-mode rule: every project follows self-approval flow.
 *
 * Pricing and tier gates are switched off for now, so approval UX must not branch by
 * stored tier values until paid verification returns.
 */
export function isSelfVerify(tier: ProjectTier | string | null | undefined): boolean {
  void tier;
  return true;
}

/** Temporary free mode: no project waits for external verification. */
export function awaitsSomeoneElse(tier: ProjectTier | string | null | undefined): boolean {
  void tier;
  return false;
}
