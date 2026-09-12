import type { ProjectRow, ProjectStageRow } from '@/types/project';

// =========================================================
// Project health — the one number the operations desk opens the panel for.
//
// Not a score out of 100. A score invites arguing about whether 71 is worse than 74; a
// band with reasons invites acting. Every band below comes with the reasons that put the
// project there, and every reason names the page where an admin does something about it.
//
// PURE, on purpose. It takes rows and timestamps and returns a verdict — no Supabase, no
// clock it did not receive. That is what makes the thresholds testable, and the tests are
// where the thresholds are pinned: change 14 days to 10 and a test says so.
//
// Computed in the browser rather than in an RPC because the fleet is tens of projects,
// the rules live better in TypeScript than in plpgsql, and moving them server-side would
// move them somewhere they cannot be unit-tested. Revisit above a few hundred projects.
// =========================================================

/** Days without any activity before a project is flagged, then escalated. */
export const STALL_ATTENTION_DAYS = 14;
export const STALL_AT_RISK_DAYS   = 30;

/** Days a stage may sit in pending_review before the review itself is the problem. */
export const REVIEW_AT_RISK_DAYS  = 5;

/** Days past planned_end before an overdue stage escalates. */
export const OVERDUE_AT_RISK_DAYS = 14;

export type HealthBand =
  | 'planning'   // tracking not started — not scored
  | 'on_track'
  | 'attention'
  | 'at_risk'
  | 'done'       // completed — not scored
  | 'archived';  // hidden — not scored

export type ReasonKind =
  | 'budget_unconfirmed'   // jalla_management, still planning
  | 'review_pending'
  | 'stage_overdue'
  | 'stalled'
  | 'payment_pending'
  | 'on_hold';

export type Severity = 'attention' | 'at_risk';

export interface HealthReason {
  kind: ReasonKind;
  severity: Severity;
  /** Days, where the reason is about elapsed time. */
  days?: number;
  /** The stage involved, where there is one. Key + name so the UI can translate. */
  stageNumber?: number;
  stageName?: string;
  stageKey?: string | null;
}

export interface ProjectHealth {
  band: HealthBand;
  reasons: HealthReason[];
}

/**
 * The latest moment anything happened on the project, from every source we have.
 * Any may be null; the caller decides what it could afford to fetch.
 */
export interface ActivityStamps {
  lastEvidenceAt?: string | null;
  lastReviewAt?:   string | null;
  lastMessageAt?:  string | null;
  lastAuditAt?:    string | null;
}

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY_MS);
}

/** Latest of several optional timestamps, or null when there are none. */
export function latestOf(...stamps: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const s of stamps) {
    if (!s) continue;
    if (!best || new Date(s) > new Date(best)) best = s;
  }
  return best;
}

/**
 * Score one project.
 *
 * `now` is a parameter, not `new Date()`, so a test can put the clock wherever it likes
 * and the same fixture reads on-track on Monday and stalled a month later.
 */
export function projectHealth(
  project: Pick<ProjectRow, 'status' | 'tier' | 'tracking_started_at' | 'updated_at'>,
  stages: Pick<ProjectStageRow, 'stage_number' | 'name' | 'stage_key' | 'status' | 'payment_status' | 'planned_end' | 'completed_at'>[],
  activity: ActivityStamps,
  now: Date = new Date(),
): ProjectHealth {
  if (project.status === 'archived')  return { band: 'archived', reasons: [] };
  if (project.status === 'completed') return { band: 'done',     reasons: [] };

  // ── Not started ──────────────────────────────────────────────────────────────────
  // A planning project has no stages in motion, so none of the rules below apply. The one
  // thing worth saying is that a Management build is waiting on US to confirm a budget.
  if (!project.tracking_started_at) {
    const reasons: HealthReason[] = [];
    if (project.tier === 'jalla_management' || (project.tier as string) === 'enterprise') {
      reasons.push({ kind: 'budget_unconfirmed', severity: 'attention' });
    }
    return { band: 'planning', reasons };
  }

  const reasons: HealthReason[] = [];

  if (project.status === 'on_hold') {
    reasons.push({ kind: 'on_hold', severity: 'attention' });
  }

  for (const s of stages) {
    // Waiting on Jalla. The age is the review's, from the last review-related activity;
    // without that stamp it is flagged but not escalated, because guessing "5 days" from
    // nothing would put every project in the red the moment the RPC is missing.
    if (s.status === 'pending_review') {
      const age = activity.lastReviewAt ? daysBetween(activity.lastReviewAt, now) : undefined;
      reasons.push({
        kind: 'review_pending',
        severity: age !== undefined && age >= REVIEW_AT_RISK_DAYS ? 'at_risk' : 'attention',
        days: age,
        stageNumber: s.stage_number,
        stageName: s.name,
        stageKey: s.stage_key,
      });
    }

    // Behind its own plan. Only an active stage can be overdue: a locked one has not
    // started, a complete one already finished, and pending_review is the rule above.
    if (s.status === 'active' && s.planned_end) {
      const over = daysBetween(s.planned_end, now);
      if (over > 0) {
        reasons.push({
          kind: 'stage_overdue',
          severity: over >= OVERDUE_AT_RISK_DAYS ? 'at_risk' : 'attention',
          days: over,
          stageNumber: s.stage_number,
          stageName: s.name,
          stageKey: s.stage_key,
        });
      }
    }

    // Work signed off, money not moved. This is the promise of the product — a stage is
    // approved and its milestone follows — so a gap here is the desk's to close.
    if (s.status === 'complete' && s.payment_status !== 'paid') {
      reasons.push({
        kind: 'payment_pending',
        severity: 'attention',
        stageNumber: s.stage_number,
        stageName: s.name,
        stageKey: s.stage_key,
      });
    }
  }

  // Nothing has happened. `updated_at` is always present, so a project is never
  // "stalled since forever" — at worst it is stalled since its last row write.
  const lastActivity = latestOf(
    activity.lastEvidenceAt, activity.lastReviewAt, activity.lastMessageAt,
    activity.lastAuditAt, project.updated_at, project.tracking_started_at,
  );
  if (lastActivity) {
    const idle = daysBetween(lastActivity, now);
    if (idle >= STALL_AT_RISK_DAYS) {
      reasons.push({ kind: 'stalled', severity: 'at_risk', days: idle });
    } else if (idle >= STALL_ATTENTION_DAYS) {
      reasons.push({ kind: 'stalled', severity: 'attention', days: idle });
    }
  }

  const band: HealthBand =
    reasons.some(r => r.severity === 'at_risk') ? 'at_risk'
    : reasons.length > 0 ? 'attention'
    : 'on_track';

  // Worst first, so the first reason shown is the one that set the band.
  reasons.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'at_risk' ? -1 : 1));

  return { band, reasons };
}

/** Bands that count as "active" for the overview cards — anything being built. */
export const ACTIVE_BANDS: readonly HealthBand[] = ['on_track', 'attention', 'at_risk'];
