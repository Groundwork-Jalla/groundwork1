/**
 * The routing fields every GoHighLevel workflow filters on.
 *
 * ── Why this is a module and not a literal at each call site ────────────────────────
 *
 * Communication Flow v1.0 §9.2 lists the fields a sequence needs to route correctly, and
 * §9.3 turns most of them into suppression rules — "an invited user must resume the
 * invitation after authentication", "existing users skip account-creation emails". Every
 * one of those is a GHL filter on a contact field, so a field spelled `entry_source` at
 * one call site and `entrySource` at another does not fail: it silently matches nothing,
 * and the person drops out of the sequence with no error anywhere. A workflow that sends
 * nothing looks exactly like a workflow with nobody in it.
 *
 * So the keys live here once, and `routingFields()` is the only way to produce them.
 *
 * ── What this file deliberately does NOT carry ──────────────────────────────────────
 *
 * §9.2 also asks for `last_email_id`, `last_email_sent_at`, `next_email_id`,
 * `next_email_due_at`, and the `human_follow_up_*` trio. Those are written by whoever
 * sends and schedules — which, as of Philip's decision on 2 Nov 2026, is GoHighLevel and
 * not us: "let's not do that on there. Let's just use go high level."
 *
 * Groundwork writing a `next_email_due_at` would be Groundwork claiming to know a
 * schedule it does not own, and the two would drift the first time somebody edits a
 * workflow. We state facts about the person; GHL states facts about its own sends.
 *
 * No imports from `src/`, no `import.meta`: this is reachable from `api/`. See
 * api/README.md.
 */

/** How this person first arrived. §9.2. */
export type EntrySource =
  | 'independent_signup'
  | 'contractor_invitation'
  | 'client_invitation'
  | 'direct_outreach'
  | 'referral';

/** §9.2 — `not_started` is the honest default for an account that has only just verified. */
export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed';

/** §9.2. `failed` matters: §9.3 rule 5 suppresses reminders on a delivery failure. */
export type InvitationStatus = 'sent' | 'accepted' | 'expired' | 'cancelled' | 'failed';

/**
 * Where the person currently is on their track — the single stage a reminder may fire on.
 *
 * Rule 1 of §2 is "one user, one active activation sequence, and one primary call to
 * action at a time", and this field is what makes that enforceable from GHL's side: a
 * sequence entry condition reads `activation_stage = awaiting_project`, so a contact who
 * has moved on simply stops matching. Without it, cancelling a pending send depends on
 * every workflow remembering to check every exit condition independently.
 */
export type ActivationStage =
  | 'awaiting_onboarding'
  | 'awaiting_project'
  | 'awaiting_client_invite'
  | 'awaiting_client_join'
  | 'awaiting_contractor_invite'
  | 'awaiting_contractor_join'
  | 'awaiting_invitation_response'
  | 'awaiting_contractor_support'
  | 'connected'
  | 'nurture';

export interface RoutingInput {
  userRole?: 'contractor' | 'client' | null;
  entrySource?: EntrySource | null;
  onboardingStatus?: OnboardingStatus | null;
  projectId?: string | null;
  projectName?: string | null;
  inviterUserId?: string | null;
  inviterName?: string | null;
  inviterRole?: 'contractor' | 'client' | null;
  invitationStatus?: InvitationStatus | null;
  activationStage?: ActivationStage | null;
  /** When the person entered `activationStage`. §2 rule 2 measures Day 1/3/7 from here. */
  stageEnteredAt?: Date | string | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build the field bag, omitting anything unknown.
 *
 * Omission is the point. GHL's upsert overwrites the fields it is given and leaves the
 * rest alone, so sending `inviter_name: ''` on a self-signup would erase the real
 * inviter recorded when that same person was invited to a second project. An absent key
 * means "no news", which is true; an empty string means "nobody", which is not.
 */
export function routingFields(input: RoutingInput): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (v) out[key] = v;
  };

  put('user_role',         input.userRole);
  put('entry_source',      input.entrySource);
  put('onboarding_status', input.onboardingStatus);
  put('project_id',        input.projectId);
  put('project_name',      input.projectName);
  put('inviter_user_id',   input.inviterUserId);
  put('inviter_name',      input.inviterName);
  put('inviter_role',      input.inviterRole);
  put('invitation_status', input.invitationStatus);
  put('activation_stage',  input.activationStage);
  put('stage_entered_at',  iso(input.stageEnteredAt));

  return out;
}
