import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Who signs off a stage (174).
 *
 * Philip, 2 Nov 2026: the client "should always have the ability to [approve] whether
 * they're an invited client or a client that actually created the project themselves,
 * because that's really what their core function there is, is to unlock the next
 * stage." And on 3 Nov, on what it rests on: "after reviewing evidences uploaded by
 * contractors."
 *
 * Three things have to stay true together, and none of them is visible to tsc:
 *
 *   1. The invited client CAN approve        — or a contractor-run build stops at stage 1.
 *   2. A family viewer CANNOT                — 112 invited them to watch; a sibling must
 *                                              not unlock a payment.
 *   3. The contractor who owns the row CANNOT — on a contractor-run build `user_id` is
 *                                              the contractor, so an owner arm with no
 *                                              exclusion lets them approve their own work.
 *
 * (3) is the one that was briefly wrong while this was written, and it is the one that
 * would be hardest to notice: everything looks correct, and the sign-off silently means
 * nothing.
 */

const sql = readFileSync('supabase/migrations/174_the_client_approves_the_stage.sql', 'utf8');

describe('the invitation says which kind it is', () => {
  it('project_viewers carries is_client, defaulting to watching only', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT false/);
  });

  it('and at most one client per project', () => {
    // Two clients is "who signs off" with two answers — the same shape of bug as two
    // primary contractors.
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_one_client/);
    expect(sql).toMatch(/WHERE is_client AND revoked_at IS NULL/);
  });

  it('the invite function takes it, and the old signature is dropped', () => {
    // Left in place, the three-argument version would make every existing call
    // ambiguous rather than defaulting.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.invite_project_viewer\(uuid, text, text\)/);
    expect(sql).toMatch(/p_is_client\s+boolean DEFAULT false/);
  });
});

describe('one definition of who the client is', () => {
  it('admits the accepted client viewer', () => {
    expect(sql).toMatch(/FROM public\.project_viewers v[\s\S]{0,260}AND v\.is_client/);
  });

  it('admits the owner only while nobody else has been named', () => {
    /**
     * The whole point. Without the NOT EXISTS the contractor who owns a contractor-run
     * build approves their own work, and the sign-off the client was given means
     * nothing.
     */
    expect(sql).toMatch(
      /FROM public\.projects p[\s\S]{0,120}AND NOT EXISTS \(SELECT 1 FROM public\.project_viewers v[\s\S]{0,180}AND v\.is_client/);
  });

  it('and the exclusion keys on the invitation, not its acceptance', () => {
    // Otherwise the approver flips over on the day the client accepts, and a stage
    // approvable by the contractor on Tuesday is not on Wednesday.
    const fn = sql.slice(sql.indexOf('FUNCTION public.is_project_client'));
    const ownerArm = fn.slice(fn.indexOf('AND NOT EXISTS'), fn.indexOf('$$;'));
    expect(ownerArm).not.toMatch(/accepted_at/);
  });
});

describe('both gates use that one definition', () => {
  it.each(['approve_stage', 'submit_stage_for_review'])('%s asks is_project_client()', fn => {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
    expect(body.slice(0, 3000)).toMatch(/is_project_client\(/);
  });

  it('and neither still tests the owner by hand', () => {
    // Two hand-written lists that can disagree is how the invited client was lost the
    // first time — see 173 on the messaging gate.
    expect(sql).not.toMatch(/v_project\.user_id IS DISTINCT FROM v_actor/);
    expect(sql).not.toMatch(/v_owner := \(v_project\.user_id = auth\.uid\(\)\)/);
  });
});

describe('there must be something to review', () => {
  it('evidence is read from the substage index, which is where it lives', () => {
    // 088 is explicit that site_updates is not the evidence index.
    expect(sql).toMatch(/FUNCTION public\.stage_has_evidence/);
    expect(sql).toMatch(/jsonb_array_length\(s\.evidence_urls\) > 0/);
  });

  it('and is required on both gates, but only where a contractor is on the build', () => {
    /**
     * Gated on the contractor, not on "the approver is an invited client": the two
     * coincide on a contractor-run build and come apart on a client-owned one, where
     * the same reasoning applies in full. It is also the only version that cannot break
     * a Starter build somebody tracks alone — no contractor, nobody to upload, no
     * change.
     */
    const occurrences = sql.match(/ci\.status = 'accepted'\)\s*\n\s*INTO v_built;/g) ?? [];
    expect(occurrences).toHaveLength(2);
    expect(sql.match(/IF v_built AND NOT public\.stage_has_evidence\(p_stage\) THEN/g) ?? [])
      .toHaveLength(2);
  });

  it('the preconditions an owner already had are not relaxed', () => {
    // Parity was the instruction. Admitting a new person is not a reason to lower the
    // bar for everybody.
    expect(sql).toMatch(/not_paid: this stage has not been paid for/);
    expect(sql).toMatch(/substages_not_ready: not all substages are complete/);
    expect(sql).toMatch(/not_verified: independent verification is required/);
  });
});

describe('the app marks the client invitation as such', () => {
  it('the contractor surface invites a client, the homeowner surface does not', () => {
    const work = readFileSync('src/app/routes/work/projects.detail.tsx', 'utf8');
    const client = readFileSync('src/components/project/ProjectTeam.tsx', 'utf8');
    // Both work-page invitation entry points require the sender to select a role.
    expect(work.match(/<ProjectSharing projectId=\{project\.id\} projectName=\{project\.name\} \/>/g) ?? []).toHaveLength(2);
    // Observer sharing keeps the default; only an actual primary contractor may
    // open the initial client invitation in the project Team tab.
    expect(client).toMatch(/<ProjectSharing projectId=\{project\.id\} projectName=\{project\.name\} \/>/);
    const sharing = readFileSync('src/components/project/ProjectSharing.tsx', 'utf8');
    expect(sharing).toContain("role === 'client' && <ShareProject");
  });

  it('and the flag reaches the RPC', () => {
    const lib = readFileSync('src/lib/supabase/project-viewers.ts', 'utf8');
    expect(lib).toMatch(/isClient = false/);
    expect(lib).toMatch(/p_is_client: isClient/);
  });

  it('defaulting to watching only, so forgetting cannot grant approval', () => {
    const cmp = readFileSync('src/components/project/ShareProject.tsx', 'utf8');
    expect(cmp).toMatch(/asClient = false/);
  });

  it('and the copy says which invitation it is', () => {
    // "Invite your client" was only ever right on the contractor's surface.
    const cmp = readFileSync('src/components/project/ShareProject.tsx', 'utf8');
    expect(cmp).toMatch(/asClient \? 'projectShare\.title' : 'projectShare\.familyTitle'/);
    expect(cmp).toMatch(/asClient \? 'projectShare\.body' : 'projectShare\.familyBody'/);
  });
});
