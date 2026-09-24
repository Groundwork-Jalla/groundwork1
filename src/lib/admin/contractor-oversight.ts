// =========================================================
// What Groundwork can honestly say about a contractor (01 §3 PEOPLE) — pure.
//
// ── The join problem, stated plainly ─────────────────────────────────────────────────
// A directory entry (`contractors`, 033) has no key pointing at any work. Assignments
// live in `contractor_invites` (project_id, email, status); evidence in
// `site_updates.submitted_by` (an ACCOUNT id); money in `payments.beneficiary_id` (an
// account id, and 089 deliberately gives it no foreign key). Nothing joins a directory
// row to any of them.
//
// The bridge is the email address — and here, unlike the CRM pipeline, that is not a
// guess dressed up as a fact: `admin_assign_contractor(project_id, email)` (029) is the
// product's own assignment call, and the address IS the identifier staff use to put a
// contractor on a project. So the match is made, and it is labelled everywhere it is
// shown. A directory entry with no email address is matched to nothing at all rather
// than to whatever shares its name.
//
// ── What this file refuses to compute ────────────────────────────────────────────────
// `contractors.rating` and `review_count` exist as columns, default to 0, and have NO
// WRITER anywhere in the codebase — a rating shown from them would be a fabricated
// metric that happens to be stored. `completed_projects` is worse: 033 sets it to
// `jsonb_array_length(application.projects)`, the count of past jobs the applicant typed
// into their own application form before they ever joined. None of the three is a
// performance measure and none of them is presented as one.
//
// There is also no on-time rate, no rework rate and no completion rate, because there is
// no per-contractor attribution of a stage outcome. `stage_verifications` names a stage
// and a project, never a contractor, and a project may carry several — so a rejected
// verification is project history, offered as context and labelled as context.
// =========================================================

export type InviteStatus = 'pending' | 'accepted' | 'rejected';

export interface InviteRow { projectId: string; email: string; status: InviteStatus; acceptedAt: string | null; createdAt: string | null }
export interface ProjectRow { id: string; name: string; status: string | null; currentStage: number | null }
export interface VerificationRow { projectId: string; decision: string; decidedAt: string | null }
export interface UpdateRow { projectId: string; submittedBy: string | null; submittedAt: string | null }
export interface PaymentRow { projectId: string | null; beneficiaryId: string | null; direction: string; state: string; amount: number; currency: string | null; createdAt: string | null }

export interface Assignment {
  projectId: string;
  project: ProjectRow | null;
  status: InviteStatus;
  since: string | null;
}

/** Lower-cased and trimmed, or `null`. The one normalisation the email match is allowed. */
export const norm = (email: string | null | undefined): string | null => {
  const v = (email ?? '').trim().toLowerCase();
  return v || null;
};

/**
 * Every project this contractor has been invited onto, accepted ones first.
 *
 * A `rejected` invite is dropped: it records that somebody declined, not an assignment.
 * `pending` is kept and labelled — "invited, has not accepted" is exactly the kind of
 * thing an oversight screen exists to surface.
 */
export function assignmentsFor(
  contractorEmail: string | null,
  invites: InviteRow[],
  projects: Map<string, ProjectRow>,
): Assignment[] {
  const key = norm(contractorEmail);
  if (!key) return [];
  return invites
    .filter(i => norm(i.email) === key && i.status !== 'rejected')
    .map(i => ({
      projectId: i.projectId,
      project: projects.get(i.projectId) ?? null,
      status: i.status,
      since: i.status === 'accepted' ? (i.acceptedAt ?? i.createdAt) : i.createdAt,
    }))
    .sort((a, b) =>
      Number(b.status === 'accepted') - Number(a.status === 'accepted')
      || (b.since ?? '').localeCompare(a.since ?? ''));
}

/** Only the projects they actually took on. Everything downstream is scoped to these. */
export const acceptedProjectIds = (rows: Assignment[]): Set<string> =>
  new Set(rows.filter(a => a.status === 'accepted').map(a => a.projectId));

export interface VerificationContext {
  /** Every decision on the projects they accepted — NOT attributed to them. */
  byDecision: Record<string, number>;
  total: number;
  /** True when more than one contractor accepted any of these projects. */
  shared: boolean;
}

/**
 * Verification history on the projects this contractor accepted.
 *
 * Context, never a score. `shared` is the reason why: if another contractor also accepted
 * one of these projects, a rejected verification on it cannot be laid at either door, and
 * the screen has to say so rather than quietly counting it against whoever is on screen.
 */
export function verificationContext(
  accepted: Set<string>,
  verifications: VerificationRow[],
  allInvites: InviteRow[],
  contractorEmail: string | null,
): VerificationContext {
  const byDecision: Record<string, number> = {};
  let total = 0;
  for (const v of verifications) {
    if (!accepted.has(v.projectId)) continue;
    byDecision[v.decision] = (byDecision[v.decision] ?? 0) + 1;
    total += 1;
  }

  const me = norm(contractorEmail);
  const shared = [...accepted].some(pid =>
    allInvites.some(i => i.projectId === pid && i.status === 'accepted' && norm(i.email) !== me));

  return { byDecision, total, shared };
}

/** Site updates filed by this contractor's ACCOUNT, on projects they accepted. */
export function updatesFor(
  personId: string | null,
  accepted: Set<string>,
  updates: UpdateRow[],
): UpdateRow[] {
  if (!personId) return [];
  return updates
    .filter(u => u.submittedBy === personId && accepted.has(u.projectId))
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}

/**
 * Groundwork's own payment records naming this contractor as the beneficiary.
 *
 * `direction === 'out'` only: an inbound funding row is the client's money arriving and
 * has nothing to do with the contractor. No account details exist in this schema to leak.
 */
export function paymentsFor(personId: string | null, payments: PaymentRow[]): PaymentRow[] {
  if (!personId) return [];
  return payments
    .filter(p => p.direction === 'out' && p.beneficiaryId === personId)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * The directory's search, in one place so the URL and the box cannot diverge.
 * Matches the fields a person would actually type: name, trade, location, email.
 */
export function matchesQuery(
  row: { name: string; trade: string; location: string; email: string | null; specialties?: string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.trade, row.location, row.email ?? '', ...(row.specialties ?? [])]
    .some(v => v.toLowerCase().includes(q));
}
