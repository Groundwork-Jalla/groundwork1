import type { ProjectRow } from '@/types/project';

// =========================================================
// Plan limits, counted the way the DATABASE counts them.
//
// `check_starter_project_limit()` (migration 008) is the only authority here:
//
//     SELECT COUNT(*) FROM public.projects
//     WHERE user_id = NEW.user_id
//       AND tier = 'self_verify'
//       AND status != 'archived'          <-- this line
//     >= 3  -> RAISE
//
// The UI counted every Self Verify project regardless of status, which disagreed with
// the trigger in both directions and produced two visible bugs:
//
//   · "5 / 3 Self Verify projects used — limit reached" while the database happily
//     allowed a fourth, because two of the five were archived.
//   · Archiving a project freed a real slot but did not re-enable the "New project"
//     button, because `!atStarterLimit` gated it on the wrong number. The one action
//     that fixes the problem appeared not to work.
//
// One function, used by every screen that shows or gates on the limit, so the client can
// only ever be wrong in the same way the server is.
// =========================================================

export const SELF_VERIFY_PROJECT_LIMIT = 3;

/** Tier values that count against the free-plan cap. `starter` is the pre-008 name. */
function isFreeTier(project: Pick<ProjectRow, 'tier'>): boolean {
  return project.tier === 'self_verify' || (project.tier as string) === 'starter';
}

/**
 * Free-plan projects that count against the cap.
 *
 * Archived projects are excluded — that is the whole point of archiving, and it is what
 * the trigger checks.
 */
export function countTowardLimit(projects: Pick<ProjectRow, 'tier' | 'status'>[]): number {
  return projects.filter(p => isFreeTier(p) && p.status !== 'archived').length;
}

export function atProjectLimit(projects: Pick<ProjectRow, 'tier' | 'status'>[]): boolean {
  return countTowardLimit(projects) >= SELF_VERIFY_PROJECT_LIMIT;
}
