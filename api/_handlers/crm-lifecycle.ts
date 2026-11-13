import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { forwardToGhl } from '../ghl/_forward.js';
import type { GhlEvent } from '../ghl/_forward.js';
import { routingFields } from '../ghl/_routing-fields.js';
import type { ActivationStage, EntrySource } from '../ghl/_routing-fields.js';

/**
 * The activation milestones a person reaches about THEMSELVES → GoHighLevel.
 *
 * ── Why one endpoint and not six ────────────────────────────────────────────────────
 *
 * Communication Flow v1.0 §9.1 lists ten lifecycle events. Four of them are things the
 * signed-in person does to their own account — finishing onboarding, accepting an
 * invitation, asking for help finding a contractor, saying they have no project to add.
 * Each needs the service role to read a profile and to write to the CRM, so each needs
 * a server endpoint, and this project has one serverless function left on the Hobby
 * plan (api/events.ts is the dispatcher; see api/README.md). Six handlers would not fit
 * and would be six copies of the same twenty lines besides.
 *
 * The other six events are not here, because they are not about the caller:
 * `client_invited` and `contractor_invited` describe a person who has not signed in yet
 * and are emitted by the handlers that send those invitations; `user_signup` and
 * `project_created` predate this file and already have theirs.
 *
 * ── Nothing about the contact comes from the request ────────────────────────────────
 *
 * Same rule as `user.ts`, for the same reason: the body carries an event name and at
 * most a project id, and every other fact — who they are, their email, their role,
 * their language, whether they have actually finished onboarding — is read back with
 * the service role. A browser that could name its own contact could write anybody into
 * the CRM, and the CRM is what the team trusts when they pick up the phone.
 *
 * ── A claim is checked, never taken ─────────────────────────────────────────────────
 *
 * `contractor_onboarding_completed` is the event that starts the project-creation
 * sequence, so a browser that could assert it could pull somebody into a track they
 * have not earned. Every event below is verified against the database before it is
 * forwarded. An unverified claim returns 200 with a reason, not an error: the caller is
 * fire-and-forget and must never block the screen on the CRM.
 */

/** The events a person may report about themselves, and what must be true to believe it. */
const SELF_EVENTS = {
  contractor_onboarding_completed: 'awaiting_project',
  invitation_accepted:             'connected',
  project_membership_active:       'connected',
  contractor_support_requested:    'awaiting_contractor_support',
  no_active_project_selected:      'nurture',
} as const satisfies Record<string, ActivationStage>;

type SelfEvent = keyof typeof SELF_EVENTS;

const isSelfEvent = (v: unknown): v is SelfEvent =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SELF_EVENTS, v);

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const event = req.body?.event;
  if (!isSelfEvent(event)) {
    res.status(400).json({ error: 'Unknown lifecycle event' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[ghl] SUPABASE_SERVICE_ROLE_KEY is not set — lifecycle not forwarded');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, country, preferred_lang, phone, ghl_contact_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    console.error('[ghl] no profile for', user.id);
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  const email = (profile.email as string | null) ?? user.email ?? '';
  if (!email) { res.status(200).json({ ok: false, reason: 'no_email' }); return; }

  const { data: roleRows } = await admin
    .from('user_roles').select('role').eq('user_id', user.id);
  const roles = new Set((roleRows ?? []).map(r => String(r.role)));
  let isContractor = roles.has('contractor');

  /**
   * Onboarding is finished when the contractor has answered the project question.
   *
   * Not a column on `profiles` — there isn't one. Philip, 30 Oct 2026: onboarding
   * "concludes when users select either 'I have a project' or 'I don't have a project'",
   * which is `contractor_onboarding.client_intent` becoming non-null. Both answers end
   * it; saying no is a finished onboarding, not an abandoned one, and onboarding.tsx
   * gates on exactly this.
   */
  const { data: onboarding } = await admin
    .from('contractor_onboarding').select('client_intent')
    .eq('user_id', user.id).maybeSingle();
  const clientIntent = (onboarding?.client_intent as string | null) ?? null;
  const onboarded = clientIntent !== null;

  // ── Verify the claim ───────────────────────────────────────────────────────────────
  let projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null;
  let projectName: string | null = null;
  let inviterUserId: string | null = null;
  let inviterName: string | null = null;

  if (event === 'contractor_onboarding_completed') {
    if (!isContractor) { res.status(200).json({ ok: false, reason: 'not_a_contractor' }); return; }
    // The claim, checked. Forwarding this starts the project-creation sequence (CS05),
    // and a contractor pulled into it mid-onboarding would be asked to create a project
    // while still being asked to finish signing up.
    if (!onboarded) { res.status(200).json({ ok: false, reason: 'onboarding_incomplete' }); return; }

    // A contractor who came in through a client's invitation is finishing onboarding to
    // JOIN that project, so they get "you've joined" (CI09), never "create your first
    // project" (CS05). The invitation is read off the record, not the request.
    const { data: invite } = await admin
      .from('contractor_invites')
      .select('project_id, invited_by, projects(name)')
      .ilike('email', email).in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (invite) {
      projectId = String(invite.project_id);
      projectName = ((invite as any).projects?.name as string | null) ?? null;
      inviterUserId = String(invite.invited_by);
      const { data: inv } = await admin
        .from('profiles').select('full_name').eq('id', inviterUserId).maybeSingle();
      inviterName = (inv?.full_name as string | null) ?? null;
    }
  }

  if (event === 'invitation_accepted' || event === 'project_membership_active') {
    // Membership is the claim, so membership is what is checked. `project_member()`
    // (086/112) is the read-only gate and admits exactly the people who can be on a
    // project without owning it — the accepted contractor, the active verifier, and the
    // invited client (166). Calling it with the service role would always say yes, so
    // the question is asked of the project rows directly.
    if (!projectId) { res.status(200).json({ ok: false, reason: 'no_project' }); return; }

    const { data: project } = await admin
      .from('projects').select('id, name, user_id').eq('id', projectId).maybeSingle();
    if (!project) { res.status(200).json({ ok: false, reason: 'no_such_project' }); return; }

    const owns = String(project.user_id) === user.id;

    const { data: viewer, error: viewerError } = await admin
      .from('project_viewers').select('id, invited_by, accepted_at, revoked_at, is_client')
      .eq('project_id', projectId).eq('user_id', user.id).maybeSingle();

    // `contractor_invites` is where an accepted contractor lives — the same row
    // `is_contractor_on()` (086) reads. There is no `project_contractors` table.
    const { data: claim, error: claimError } = await admin
      .from('contractor_invites').select('id, status, invited_by, is_primary')
      .eq('project_id', projectId).eq('contractor_user_id', user.id)
      .eq('status', 'accepted').maybeSingle();

    if (viewerError || claimError) { res.status(503).json({ ok: false, reason: 'membership_read_unavailable' }); return; }

    const joined = owns || (viewer && viewer.accepted_at && !viewer.revoked_at) || !!claim;

    if (!joined) { res.status(200).json({ ok: false, reason: 'not_a_member' }); return; }

    // Activation follows this project's primary role, independent of account type.
    if (viewer?.is_client && viewer.accepted_at && !viewer.revoked_at) isContractor = false;
    else if (claim?.is_primary) isContractor = true;
    else if (owns && !claim) isContractor = false;
    else { res.status(200).json({ ok: false, reason: 'observer_or_secondary' }); return; }

    projectName = (project.name as string | null) ?? null;

    if (viewer?.is_client && viewer.accepted_at && !viewer.revoked_at && viewer.invited_by) {
      inviterUserId = String(viewer.invited_by);
      const { data: inv } = await admin
        .from('profiles').select('full_name').eq('id', inviterUserId).maybeSingle();
      inviterName = (inv?.full_name as string | null) ?? null;
    } else if (!owns) {
      // Read the assignment’s inviter; the creator and primary client can differ.
      inviterUserId = String(claim?.invited_by ?? project.user_id);
      const { data: inv } = await admin
        .from('profiles').select('full_name').eq('id', inviterUserId).maybeSingle();
      inviterName = (inv?.full_name as string | null) ?? null;
    }
  }

  if (event === 'no_active_project_selected' || event === 'contractor_support_requested') {
    // §9.3 rules 6 and 7 both suppress a reminder sequence, and a suppression that
    // fires when the opposite is true is worse than none: a contractor who HAS a
    // project would stop being asked to invite their client. So the absence is checked.
    const { count } = await admin
      .from('projects').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (event === 'no_active_project_selected') {
      if ((count ?? 0) > 0) {
        res.status(200).json({ ok: false, reason: 'already_has_a_project' });
        return;
      }
      // The opt-out Philip asked for on 2 Nov is already a recorded answer: choosing
      // "I don't have a project" at the end of onboarding writes `no_client`. Reading
      // it rather than trusting the body means the suppression and the screen can
      // never disagree about what the contractor said.
      if (clientIntent !== 'no_client') {
        res.status(200).json({ ok: false, reason: 'did_not_opt_out' });
        return;
      }
    }
  }

  /**
   * How they arrived, as far as the record can say.
   *
   * An accepted invitation is proof of an invitation track; anything else is read as an
   * independent signup. `direct_outreach` and `referral` (§9.2) are not inferable from
   * the product at all — somebody in ops knows them and GHL is where they are set, so
   * this never overwrites them with a guess once they are already known.
   */
  const entrySource: EntrySource = inviterUserId
    ? (isContractor ? 'contractor_invitation' : 'client_invitation')
    : 'independent_signup';

  const result = await forwardToGhl(event as GhlEvent, {
    email,
    fullName: profile.full_name as string | null,
    country:  profile.country as string | null,
    lang:     profile.preferred_lang as string | null,
    phone:    profile.phone as string | null,
  }, {
    user_id: user.id,
    ...routingFields({
      userRole:         isContractor ? 'contractor' : 'client',
      entrySource,
      onboardingStatus: onboarded ? 'completed' : 'in_progress',
      projectId,
      projectName,
      inviterUserId,
      inviterName,
      inviterRole:      inviterUserId ? (isContractor ? 'client' : 'contractor') : null,
      invitationStatus: event === 'invitation_accepted' ? 'accepted' : null,
      activationStage:  SELF_EVENTS[event],
      stageEnteredAt:   new Date(),
    }),
  }, {
    // Once per person per milestone — except the two that are per project, which a
    // contractor legitimately reaches again on their next build.
    dedupeKey: projectId ? `${event}:${user.id}:${projectId}` : `${event}:${user.id}`,
    contactId: (profile.ghl_contact_id as string | null) ?? null,
    // Neither acceptance event can be read off the event name: both happen on the
    // contractor track and on the client track. See partyFor in _pipeline.ts.
    party: isContractor ? 'Contractor' : 'Homeowner',
  });

  res.status(200).json({ ok: result.ok, reason: result.reason });
}
