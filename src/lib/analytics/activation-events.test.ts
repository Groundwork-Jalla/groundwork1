import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The activation spine (Communication Flow v1.0, §9.1 and §9.2).
 *
 * Philip decided on 2 Nov 2026 that GoHighLevel sends and schedules the reminder
 * sequences: "let's not do that on there. Let's just use go high level." That leaves
 * Groundwork responsible for one thing — emitting the milestone — and makes every
 * mistake in this area SILENT. A workflow whose entry condition names a field we never
 * send does not error; it matches nobody, sends nothing, and looks exactly like a
 * sequence that simply has no one in it yet.
 *
 * Nothing below can be caught by tsc or by a passing deploy, which is why it is here.
 */

const read = (p: string) => readFileSync(p, 'utf8');

describe('every lifecycle event §9.1 names can actually be sent', () => {
  const forward = read('api/ghl/_forward.ts');
  const pipeline = read('api/ghl/_pipeline.ts');

  // The eight §9.1 events that are not `user_signup` / `project_created`, both of
  // which predate this document and already had a sender.
  const EVENTS = [
    'contractor_onboarding_completed',
    'client_invited',
    'contractor_invited',
    'invitation_accepted',
    'project_membership_active',
    'contractor_support_requested',
    'no_active_project_selected',
  ];

  it.each(EVENTS)('%s is in the GhlEvent union', event => {
    expect(forward).toMatch(new RegExp(`\\|\\s*'${event}'`));
  });

  it.each(EVENTS)('%s has a tag, so a workflow has something to enter on', event => {
    /**
     * `SOURCE` is `Record<GhlEvent, string>`, so tsc already forces an entry to exist.
     * What it cannot force is a NON-EMPTY one, and an empty source means no tag is
     * added — which for a lifecycle event means the sequence can never start.
     * `email_changed` is deliberately empty and deliberately not in this list.
     */
    expect(pipeline).toMatch(new RegExp(`${event}:\\s*'groundwork:[a-z-]+'`));
  });
});

describe('the party is stated where the event cannot say it', () => {
  it('partyFor takes an override', () => {
    const pipeline = read('api/ghl/_pipeline.ts');
    expect(pipeline).toMatch(/export function partyFor\(\s*event: GhlEvent,/);
    expect(pipeline).toMatch(/if \(override\) return override;/);
  });

  it('and the two both-track events pass one', () => {
    /**
     * `invitation_accepted` and `project_membership_active` happen to a contractor in
     * §6 and to a client in §8. Without the override both would be labelled Contractor,
     * and every invited homeowner would land in the contractor's column.
     */
    const handler = read('api/_handlers/crm-lifecycle.ts');
    expect(handler).toMatch(/party: isContractor \? 'Contractor' : 'Homeowner'/);
  });
});

describe('§9.2 routing fields have exactly one spelling', () => {
  const fields = read('api/ghl/_routing-fields.ts');

  // Spelled as GHL will filter on them. A rename here is a rename in every workflow,
  // which is the point of them being in one file.
  const KEYS = [
    'user_role', 'entry_source', 'onboarding_status', 'project_id', 'project_name',
    'inviter_user_id', 'inviter_name', 'inviter_role', 'invitation_status',
    'activation_stage', 'stage_entered_at',
  ];

  it.each(KEYS)('%s is produced by routingFields', key => {
    expect(fields).toMatch(new RegExp(`put\\('${key}',`));
  });

  it('omits what it does not know rather than blanking it', () => {
    /**
     * GHL's upsert overwrites the fields it is given. Sending `inviter_name: ''` on a
     * self-signup would erase the real inviter recorded when that same person was
     * invited to a different project.
     */
    expect(fields).toMatch(/if \(v\) out\[key\] = v;/);
  });

  it('does not claim a send schedule it does not own', () => {
    // GoHighLevel writes these. Groundwork writing them too would let the two drift
    // the first time somebody edits a workflow.
    for (const owned of ['last_email_id', 'next_email_due_at', 'human_follow_up_status']) {
      expect(fields).not.toMatch(new RegExp(`put\\('${owned}'`));
    }
  });
});

describe('a claim is verified before it is believed', () => {
  const handler = read('api/_handlers/crm-lifecycle.ts');

  it('only accepts events a person can report about themselves', () => {
    // `client_invited` describes somebody who has not signed in. Accepting it here
    // would let any account start an invitation sequence for any address.
    expect(handler).not.toMatch(/client_invited:/);
    expect(handler).not.toMatch(/contractor_invited:/);
  });

  it('reads the contact from the database, never the body', () => {
    // The body may name an event and a project id. Everything else is looked up.
    expect(handler).toMatch(/const user = await requireUser\(req\)/);
    expect(handler).toMatch(/\.from\('profiles'\)[\s\S]{0,120}\.eq\('id', user\.id\)/);
  });

  it('will not announce an onboarding that has not happened', () => {
    // Forwarding this starts the project-creation sequence (CS05).
    expect(handler).toMatch(/if \(!onboarded\) \{[\s\S]{0,120}onboarding_incomplete/);
  });

  it('reads the opt-out from the answer already recorded, not from the caller', () => {
    // "I don't have a project" is written as `client_intent = 'no_client'` at the end
    // of onboarding. Trusting the body instead would let the screen and the
    // suppression disagree about what the contractor said.
    expect(handler).toMatch(/clientIntent !== 'no_client'/);
    expect(handler).toMatch(/did_not_opt_out/);
  });

  it('checks real membership before calling somebody connected', () => {
    // `contractor_invites` is where an accepted contractor lives (086). There is no
    // `project_contractors` table, and a select against one would silently return
    // nothing — making every joined contractor look like a stranger.
    expect(handler).toMatch(/\.from\('contractor_invites'\)/);
    // Matched as a query, not as a word: the header comment names the table that
    // does not exist, precisely so the next person does not reach for it again.
    expect(handler).not.toMatch(/\.from\('project_contractors'\)/);
    expect(handler).toMatch(/\.from\('project_viewers'\)/);
  });
});

describe('the milestones are emitted where the action happens', () => {
  it('onboarding completion tells the CRM as well as the funnel', () => {
    const onboarding = read('src/app/routes/work/onboarding.tsx');
    expect(onboarding).toMatch(/trackFunnel\('contractor_onboarding', 'completed'\)/);
    expect(onboarding).toMatch(/trackLifecycle\('contractor_onboarding_completed'\)/);
  });

  it('and "I have no project" opts out of the project-creation sequence', () => {
    const onboarding = read('src/app/routes/work/onboarding.tsx');
    expect(onboarding).toMatch(/trackLifecycle\('no_active_project_selected'\)/);
  });

  it('both acceptance paths close their reminder track', () => {
    for (const path of ['src/lib/supabase/project-viewers.ts', 'src/lib/supabase/invites.ts']) {
      const src = read(path);
      expect(src).toMatch(/trackLifecycle\('invitation_accepted'/);
      expect(src).toMatch(/trackLifecycle\('project_membership_active'/);
    }
  });

  it('an invitation SEND is emitted by the server, not the browser', () => {
    // The invitee has no session — they are the person being invited. Only the
    // handler that already holds the row can say this happened.
    expect(read('api/_handlers/send-share-invite.ts')).toMatch(/forwardToGhl\('client_invited'/);
    expect(read('api/send-invite.ts')).toMatch(/forwardToGhl\('contractor_invited'/);
  });

  it('and is deduped per invitation, not per person', () => {
    // The same address invited to a SECOND build starts a second reminder clock.
    expect(read('api/_handlers/send-share-invite.ts'))
      .toMatch(/dedupeKey: `client_invited:\$\{shareToken\}`/);
    expect(read('api/send-invite.ts'))
      .toMatch(/dedupeKey: `contractor_invited:\$\{inviteToken\}`/);
  });
});

describe('telling the CRM never costs the action', () => {
  it('the browser helper swallows its own failures', () => {
    const lib = read('src/lib/analytics/lifecycle.ts');
    expect(lib).toMatch(/} catch \{/);
    expect(lib).toMatch(/export function trackLifecycle/);
  });

  it('and the senders await the forward rather than floating it', () => {
    /**
     * Vercel freezes the instance the moment a handler responds, so `void forwardToGhl(...)`
     * is suspended mid-flight and the event never lands. The same mistake the
     * contractor acknowledgement made with its CRM note — invisible from every
     * direction: email sends, endpoint returns 200, nothing is logged.
     */
    for (const path of ['api/_handlers/send-share-invite.ts', 'api/send-invite.ts']) {
      const src = read(path);
      expect(src).toMatch(/const fwd = await forwardToGhl\(/);
      expect(src).not.toMatch(/void forwardToGhl\(/);
    }
  });
});
