// =========================================================
// Where a person is in acquisition (01 §3 CRM) — pure.
//
// ── Why these lanes and not a funnel somebody drew ───────────────────────────────────
// Groundwork does not store opportunities. GoHighLevel holds the board, and the only
// opportunity call in the codebase is a per-contact lookup inside `moveToStage` — there
// is no read that lists who is in which stage. So a board rendered from GHL data would
// have to be invented, and this one is not: five of the six lanes below are keys that
// already exist in `ghl_stage_map` (see api/ghl/_pipeline.ts), and every record is placed
// by a row in the Groundwork table that is the reason we push that event in the first
// place.
//
// The sixth, `waitlist`, is the exception and is marked as one: it predates the stage map
// and was forwarded by its own webhook, never by a stage move. It is a real acquisition
// stage with a real table behind it; it is not a CRM pipeline stage.
//
// In other words: this is the pipeline as GROUNDWORK knows it, which is the same set of
// facts GHL is told about. It is not a mirror of GHL's board, and it does not claim to
// be one.
//
// ── A row is a RECORD, not a person ──────────────────────────────────────────────────
// `contractor_applications` has no `user_id`: an application carries an email address
// and nothing else that points at an account. So somebody who joined the waitlist, then
// signed up, then applied is three rows in three tables, and the only thing that could
// join them is their email — which is a guess, not a relationship. Matching on it would
// also silently merge a contractor who applied with a personal address into whichever
// homeowner happens to share it.
//
// So nothing here is merged. Every lead is one real row, the page says so, and the
// counts are counts of acquisition records. That is a smaller claim than "leads" usually
// implies, and it is the one the schema can support.
//
// ── What is deliberately absent ──────────────────────────────────────────────────────
// No score, no temperature, no conversion rate, no monetary value, no probability.
// Nothing in the schema carries any of them, and each would be a number an operator
// might act on. Age in a lane is the one derived figure here, and it is derived from a
// real timestamp on the row that put the person in that lane.
// =========================================================

/** The `ghl_stage_map` keys, plus `waitlist` — see the note above for why that one differs. */
export type Lane =
  | 'waitlist'
  | 'user_signup'
  | 'contractor_application'
  | 'application_decision:accepted'
  | 'application_decision:rejected'
  | 'project_created';

export const LANES: readonly Lane[] = [
  'waitlist', 'user_signup', 'contractor_application',
  'application_decision:accepted', 'application_decision:rejected', 'project_created',
] as const;

/** How the person arrived. The three real front doors, nothing else. */
export type Source = 'waitlist' | 'signup' | 'application';

/** What Groundwork knows about the CRM mirror for this person — never about their stage. */
export type SyncState =
  /** A GHL contact id is recorded against them, or the waitlist row is marked synced. */
  | 'mirrored'
  /** An outbox row for them is still pending, or retrying. */
  | 'pending'
  /** An outbox row for them failed. This is the one worth acting on. */
  | 'failed'
  /** Nothing has ever been queued and no contact id exists. */
  | 'none'
  /** The outbox could not be read at all. Not the same as `none`. */
  | 'unknown';

export interface Lead {
  /** The source row's own id. */
  key: string;
  /** An account id, only where a real foreign key says so. Never matched by email. */
  personId: string | null;
  name: string | null;
  email: string | null;
  lane: Lane;
  source: Source;
  sync: SyncState;
  /** The record's own timestamp. */
  since: string | null;
  /**
   * Whether `since` is also when they entered this lane.
   *
   * False for a decided application: 026 records no decision timestamp, so how long an
   * application has sat accepted or rejected is not knowable, and the screen must show
   * nothing rather than the age of the application itself dressed up as the age of the
   * decision.
   */
  sinceIsLaneEntry: boolean;
  /** Only when a real project exists, so the link is never a guess. */
  projectId: string | null;
  country: string | null;
}

export interface PersonRow { id: string; email: string | null; fullName: string | null; createdAt: string | null; country: string | null; ghlContactId: string | null }
/** No `userId`: 026 has no such column, and email is not a relationship. */
export interface ApplicationRow { id: string; email: string | null; fullName: string | null; status: string; createdAt: string | null; ghlContactId: string | null }
/** `syncedToGhl` is carried for completeness; nothing reads it — see the waitlist branch. */
export interface WaitlistRow { id: string; email: string; createdAt: string | null; syncedToGhl: boolean }
export interface ProjectRow { id: string; userId: string | null; createdAt: string | null }
export interface OutboxRow { email: string; status: string }

/**
 * Which lane the application's own status means.
 *
 * `pending` and `reviewing` are both "with us"; `accepted` and `rejected` are the two
 * decided ends the stage map already names. `disqualified` is a decision too — the
 * application did not meet the bar — and it shares the rejected lane rather than
 * inventing a sixth that GHL has no stage for.
 */
export function laneForApplication(status: string): Lane {
  if (status === 'accepted') return 'application_decision:accepted';
  if (status === 'rejected' || status === 'disqualified') return 'application_decision:rejected';
  return 'contractor_application';
}

/**
 * The CRM mirror's state for one person, from the outbox and whatever id is on file.
 *
 * `outbox === null` means the table could not be read; everybody is then `unknown`,
 * because reporting `none` would be an assertion that nothing was ever queued.
 */
export function syncFor(
  email: string | null,
  contactId: string | null,
  outbox: Map<string, string[]> | null,
): SyncState {
  if (outbox === null) return 'unknown';
  const statuses = email ? outbox.get(email.toLowerCase()) ?? [] : [];
  if (statuses.includes('failed')) return 'failed';
  if (contactId) return 'mirrored';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('sent')) return 'mirrored';
  return 'none';
}

/**
 * Every acquisition record, each in exactly one lane.
 *
 * Nothing is deduplicated across tables, because nothing in the schema joins them. See
 * the note at the top of this file: the alternative is matching on an email address,
 * which is a guess that would both merge strangers and hide a real application.
 */
export function buildPipeline(input: {
  people: PersonRow[];
  applications: ApplicationRow[];
  waitlist: WaitlistRow[];
  projects: ProjectRow[];
  outbox: Map<string, string[]> | null;
}): Lead[] {

  const { people, applications, waitlist, projects, outbox } = input;

  const firstProject = new Map<string, ProjectRow>();
  for (const pr of projects) {
    if (!pr.userId) continue;
    const seen = firstProject.get(pr.userId);
    if (!seen || (pr.createdAt ?? '') < (seen.createdAt ?? '')) firstProject.set(pr.userId, pr);
  }

  const out: Lead[] = [];

  // 1. Applications. `ghl_contact_id` is the application's OWN column (added after 026),
  //    so the mirror state is read from the row itself, not from an account it has none of.
  for (const a of applications) {
    const lane = laneForApplication(a.status);
    out.push({
      key: a.id,
      personId: null,
      name: a.fullName,
      email: a.email,
      lane,
      source: 'application',
      sync: syncFor(a.email, a.ghlContactId, outbox),
      since: a.createdAt,
      sinceIsLaneEntry: lane === 'contractor_application',
      projectId: null,
      country: null,
    });
  }

  // 2. Accounts — building if they own one, otherwise a signup. `projects.user_id` is a
  //    real foreign key, so this is the one relationship on the page that is not inferred.
  for (const p of people) {
    const project = firstProject.get(p.id) ?? null;
    out.push({
      key: p.id,
      personId: p.id,
      name: p.fullName,
      email: p.email,
      lane: project ? 'project_created' : 'user_signup',
      source: 'signup',
      sync: syncFor(p.email, p.ghlContactId, outbox),
      since: project ? project.createdAt : p.createdAt,
      sinceIsLaneEntry: true,
      projectId: project?.id ?? null,
      country: p.country,
    });
  }

  // 3. The waitlist, whole. An address here may belong to somebody who later signed up;
  //    both rows are shown, because no column says they are the same person.
  for (const w of waitlist) {
    out.push({
      key: w.id,
      personId: null,
      name: null,
      email: w.email,
      lane: 'waitlist',
      source: 'waitlist',
      // Always unknown, and deliberately. 023 added `synced_to_ghl` to be written by
      // `api/ghl/waitlist.ts` — a file that no longer exists, and no other writer took
      // over. The flag is therefore false on every row whether or not GHL has the
      // address, so reading it would report "Not sent" as a fact about the CRM when it
      // is only a fact about a deleted code path. The outbox has no waitlist rows
      // either: joining on the email address would be the same guess this file refuses
      // everywhere else. Unknown is the true answer until a writer exists again.
      sync: 'unknown',
      since: w.createdAt,
      sinceIsLaneEntry: true,
      projectId: null,
      country: null,
    });
  }

  return out.sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''));
}

/**
 * Whole days in the lane, or `null` when that is not knowable.
 *
 * A decided application returns `null`: 026 records no decision timestamp, and the age
 * of the application is not the age of the decision.
 */
export function daysIn(lead: Pick<Lead, 'since' | 'sinceIsLaneEntry'>, now = Date.now()): number | null {
  if (!lead.since || !lead.sinceIsLaneEntry) return null;
  const t = Date.parse(lead.since);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Counts per lane, for lanes that exist. A lane with nobody in it counts zero — that is a real zero. */
export function laneCounts(leads: Lead[]): Record<Lane, number> {
  const out = Object.fromEntries(LANES.map(l => [l, 0])) as Record<Lane, number>;
  for (const l of leads) out[l.lane] += 1;
  return out;
}
