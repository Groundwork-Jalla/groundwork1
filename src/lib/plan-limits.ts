import type { ProjectRow } from '@/types/project';

// =========================================================
// Plan limits, counted the way the DATABASE counts them.
//
// `check_starter_project_limit()` (migration 053) is the only authority here:
//
//     SELECT COUNT(*) FROM public.projects
//     WHERE user_id = NEW.user_id
//       AND tier = 'self_verify'
//     >= 3  -> RAISE
//
// It used to carry `AND status != 'archived'`, and the UI used to count every project
// regardless of status. Disagreeing with the trigger in either direction is what this
// file exists to prevent — it produced two visible bugs while they were out of step:
//
//   · "5 / 3 Self Verify projects used — limit reached" while the database happily
//     allowed a fourth, because two of the five were archived.
//   · Archiving a project freed a real slot but did not re-enable the "New project"
//     button, because `!atStarterLimit` gated it on the wrong number. The one action
//     that fixes the problem appeared not to work.
//
// 053 settled it the other way, on Favour's call: archived projects DO count, and owners
// can no longer delete, so the count never falls. Whichever way the rule goes, the rule
// lives in one function on each side and the two are kept identical on purpose.
// =========================================================

export const SELF_VERIFY_PROJECT_LIMIT = 3;

/** Tier values that count against the free-plan cap. `starter` is the pre-008 name. */
function isFreeTier(project: Pick<ProjectRow, 'tier'>): boolean {
  return project.tier === 'self_verify' || (project.tier as string) === 'starter';
}

/**
 * Free-plan projects that count against the cap.
 *
 * EVERY free-tier project counts, archived included — matching migration 053's trigger.
 * Archiving hides a project; it does not give a slot back, and owners can no longer
 * delete at all, so this number only ever goes up.
 *
 * `status` stays in the signature. It is what makes the change from "excluding archived"
 * to "counting everything" a one-line edit here rather than a hunt through call sites,
 * and both callers already pass whole rows.
 */
export function countTowardLimit(projects: Pick<ProjectRow, 'tier' | 'status'>[]): number {
  return projects.filter(isFreeTier).length;
}

export function atProjectLimit(projects: Pick<ProjectRow, 'tier' | 'status'>[]): boolean {
  return countTowardLimit(projects) >= SELF_VERIFY_PROJECT_LIMIT;
}
