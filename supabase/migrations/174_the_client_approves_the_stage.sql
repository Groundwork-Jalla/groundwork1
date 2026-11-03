-- The client approves the stage — invited or not — and only against evidence.
--
-- ── WHAT IS WRONG ───────────────────────────────────────────────────────────────────
--
-- 166 let a contractor's invited client read and talk, and was emphatic that it granted
-- nothing else: "A viewer still cannot approve a stage, release money, change a budget,
-- or invite anybody." That was the right line to hold at the time and it is the wrong
-- line now.
--
-- Philip, 2 Nov 2026, asked directly whether an invited client keeps stage approval:
--
--   "The client should always have the ability to do that whether they're an invited
--    client or a client that actually created the project themselves, because that's
--    really what their core function there is, is to unlock the next stage. And they
--    can't unlock the next stage unless they approve whatever the current stage
--    completion is."
--
-- And on 3 Nov, on what the approval rests on: the client "must approve stages, after
-- reviewing evidences uploaded by contractors".
--
-- Today `approve_stage` (087) and `submit_stage_for_review` (089) both test
-- `projects.user_id = auth.uid()`. On a contractor-run build the owner IS the
-- contractor — that is the whole premise of 166 — so the test asks the contractor to
-- approve their own work and locks out the one person whose sign-off the stage is for.
-- The build stops at stage one and no stage is ever paid.
--
-- ── WHO THE CLIENT IS ───────────────────────────────────────────────────────────────
--
-- `project_viewers` carries two different people. 112 built it for family — "a spouse,
-- a parent, a sibling paying toward the build" — and 166 reused it for the client of a
-- contractor-owned project, because the one rule was "only the owner may share" and
-- there the owner is the contractor. Both readings are live, and only one of them may
-- approve a stage. A sibling must not be able to unlock a payment.
--
-- So the invitation says which it is. `is_client` is set by the inviter at the moment
-- they send it, exactly as `contractor_invites.is_primary` names the one contractor
-- whose details route a payout. One per project, enforced by a partial unique index
-- rather than by whoever writes the next caller.
--
-- ── WHAT THE CLIENT GETS: PARITY, AND NOTHING MORE ─────────────────────────────────
--
-- "Whether they're an invited client or a client that actually created the project
-- themselves" is a statement about parity, so that is what is implemented. The invited
-- client is admitted on EXACTLY the terms an owning client already has — same tier
-- rule, same paid gate, same substage gate, same verification gate. Not one of those is
-- relaxed here, and no new power is created: there is no path by which this lets
-- somebody move money, change a budget, or invite anybody.
--
-- `project_member()` stays read-only, as 112 insists. This widens two named functions.
--
-- ── EVIDENCE, AND WHY IT IS GATED ON A CONTRACTOR BEING PRESENT ────────────────────
--
-- "After reviewing evidences uploaded by contractors" is a real precondition: an
-- approval with nothing to review is a signature on a blank page, and the stage it
-- unlocks is the one that gets paid.
--
-- The gate is "this project has an accepted contractor", not "the approver is an
-- invited client". Those coincide on a contractor-run build and come apart on a
-- client-owned one — where the client owns the project, a contractor does the work, and
-- the same reasoning applies in full. Testing for the contractor covers both, and is
-- the only version that cannot break the case it must not touch: a Starter build
-- somebody is tracking alone has no contractor, nobody to upload anything, and keeps
-- the rule it has always had.
--
-- Run in: Supabase Dashboard > SQL Editor (after 173)

BEGIN;

-- ── 1. Which invitation is the client's ────────────────────
ALTER TABLE public.project_viewers
  ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_viewers.is_client IS
  'This invitation is to the CLIENT the build is for, not to family (112). Only a '
  'client viewer may approve a stage (174). Set when the invitation is sent.';

-- At most one live client per project. A second would make "who signs off" a question
-- with two answers, which is the same shape of bug as two primary contractors.
CREATE UNIQUE INDEX IF NOT EXISTS project_viewers_one_client
  ON public.project_viewers (project_id)
  WHERE is_client AND revoked_at IS NULL;

/*
 * Backfill. A no-op in production today — `project_viewers` has no rows at all, which
 * is its own finding: not one client invitation has ever been successfully delivered,
 * and that alone guarantees zero verified projects.
 *
 * Deliberately narrow for anywhere that does have rows: only where the project owner
 * holds the contractor role (so the viewer cannot be the owner's family) AND the
 * project has exactly one live viewer (so there is no guessing which of several is the
 * client). Anything less certain is left false and can be set by re-inviting.
 */
UPDATE public.project_viewers v
   SET is_client = true
 WHERE v.revoked_at IS NULL
   AND NOT v.is_client
   AND EXISTS (SELECT 1 FROM public.projects p
                JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'contractor'
               WHERE p.id = v.project_id)
   AND (SELECT count(*) FROM public.project_viewers w
         WHERE w.project_id = v.project_id AND w.revoked_at IS NULL) = 1;

-- ── 2. The invitation names the client ─────────────────────
-- Dropped and recreated rather than CREATE OR REPLACE: adding a parameter changes the
-- identity of the function, and leaving the three-argument version behind would make
-- every existing call ambiguous. Named-argument callers that pass only the first three
-- keep working against the new default.
DROP FUNCTION IF EXISTS public.invite_project_viewer(uuid, text, text);

CREATE OR REPLACE FUNCTION public.invite_project_viewer(
  p_project      uuid,
  p_email        text,
  p_relationship text    DEFAULT NULL,
  p_is_client    boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_owner uuid;
  v_token uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email: an invitation needs an address to send to';
  END IF;

  SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'no_project: no such project'; END IF;
  -- Unchanged from 112. Only the owner: who may see a person's finances is that
  -- person's decision, not staff's.
  IF v_owner <> v_actor THEN
    RAISE EXCEPTION 'not_owner: only the person whose project this is may share it';
  END IF;

  IF v_email = lower((SELECT email FROM public.profiles WHERE id = v_actor)) THEN
    RAISE EXCEPTION 'self_invite: you already have this project';
  END IF;

  -- Idempotent: an open invitation returns the token already in their inbox. If it is
  -- being re-sent AS the client this time, promote it rather than silently keeping the
  -- weaker invitation — a contractor correcting their own mistake should not have to
  -- revoke first.
  SELECT token INTO v_token FROM public.project_viewers
   WHERE project_id = p_project AND lower(email) = v_email AND revoked_at IS NULL;
  IF v_token IS NOT NULL THEN
    IF p_is_client THEN
      UPDATE public.project_viewers SET is_client = true WHERE token = v_token;
    END IF;
    RETURN v_token;
  END IF;

  INSERT INTO public.project_viewers (project_id, email, relationship, invited_by, is_client)
  VALUES (p_project, v_email, NULLIF(btrim(coalesce(p_relationship, '')), ''), v_actor,
          coalesce(p_is_client, false))
  RETURNING token INTO v_token;

  PERFORM public.log_activity(p_project, 'project.viewer_invited', NULL, NULL, v_actor,
    jsonb_build_object('email', v_email, 'is_client', coalesce(p_is_client, false)));
  RETURN v_token;
END $$;

REVOKE ALL ON FUNCTION public.invite_project_viewer(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_project_viewer(uuid, text, text, boolean) TO authenticated;

-- ── 3. One definition of "the client of this build" ────────
-- Shared by both gates below, for the reason 173 gave about messaging: starting a
-- thread and posting in it are one permission, and two hand-written lists that can
-- disagree is how the invited client was lost the first time.
CREATE OR REPLACE FUNCTION public.is_project_client(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    -- The named client, once they have accepted.
    EXISTS (SELECT 1 FROM public.project_viewers v
             WHERE v.project_id  = p_project
               AND v.user_id     = auth.uid()
               AND v.is_client
               AND v.accepted_at IS NOT NULL
               AND v.revoked_at  IS NULL)
    OR
    /*
     * The owner — but only while nobody else has been named.
     *
     * This half is the one that matters, and the first draft of it was wrong. On a
     * contractor-run build `projects.user_id` IS the contractor (166), so an owner arm
     * with no exclusion hands the contractor the client's sign-off: they would approve
     * their own work and release their own stage. That is precisely the separation the
     * whole approval step exists to create, and it would have been introduced by the
     * migration meant to protect it.
     *
     * The exclusion keys on the INVITATION, not on its acceptance. Once a contractor
     * has named the person the build is for, that person signs off and nobody else
     * does — including during the days before they accept. Flipping the approver over
     * on acceptance would mean a stage could be approved by the contractor on Tuesday
     * and only by the client on Wednesday, which is not a rule anybody could explain to
     * either of them. It also gives the contractor a reason to chase the acceptance,
     * which is what CS14 and CS15 are for.
     *
     * A client-owned build is untouched: family invitations are not `is_client`, so the
     * owner stays the client however many of them there are.
     */
    (
      EXISTS (SELECT 1 FROM public.projects p
               WHERE p.id = p_project AND p.user_id = auth.uid())
      AND NOT EXISTS (SELECT 1 FROM public.project_viewers v
                       WHERE v.project_id = p_project
                         AND v.is_client
                         AND v.revoked_at IS NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.is_project_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_client(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_project_client(uuid) IS
  'The person the build is FOR: the accepted client viewer a contractor invited, or '
  'the owner where no client has been named (174). On a contractor-run build the owner '
  'is the contractor, so naming a client moves the sign-off away from them — which is '
  'the point of the sign-off. Not family, not a verifier.';

-- ── 4. Is there anything to review? ────────────────────────
CREATE OR REPLACE FUNCTION public.stage_has_evidence(p_stage uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_substages s
     WHERE s.stage_id = p_stage
       AND jsonb_typeof(s.evidence_urls) = 'array'
       AND jsonb_array_length(s.evidence_urls) > 0
  );
$$;

REVOKE ALL ON FUNCTION public.stage_has_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_has_evidence(uuid) TO authenticated;

COMMENT ON FUNCTION public.stage_has_evidence(uuid) IS
  'At least one substage carries a file. project_substages.evidence_urls is the '
  'evidence index (088 is explicit that site_updates is not), so it is the only '
  'place this has to look.';

-- ── 5. The client approves ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_admin    boolean := public.is_admin();
  v_client   boolean;
  v_self     boolean;
  v_built    boolean;
  v_latest   public.stage_verifications%ROWTYPE;
  v_next     public.project_stages%ROWTYPE;
  v_final    boolean;
  v_now      timestamptz := now();
BEGIN
  -- FOR UPDATE, as 087: two approvals racing serialise here, the second re-reads and
  -- gets wrong_state. One approval, one audit row, one next-stage activation.
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  -- The one change of substance: the CLIENT, which on a contractor-run build is the
  -- invited viewer and not the owner. See is_project_client().
  v_client := public.is_project_client(v_stage.project_id);
  v_self   := (v_project.tier IN ('self_verify', 'starter'));

  IF NOT v_admin AND NOT (v_client AND v_self) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator, or the client of a Self Verify project, may approve a stage';
  END IF;
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  -- The client path's own preconditions, unchanged from 087.
  IF NOT v_admin THEN
    IF v_stage.payment_status <> 'paid' THEN
      RAISE EXCEPTION 'not_paid: this stage has not been paid for';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN
      RAISE EXCEPTION 'substages_not_ready: not all substages are complete';
    END IF;

    -- Evidence, where somebody else did the work. See the header: gated on a contractor
    -- being present, so a build the client is tracking alone is untouched.
    SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci
                    WHERE ci.project_id = v_stage.project_id AND ci.status = 'accepted')
      INTO v_built;
    IF v_built AND NOT public.stage_has_evidence(p_stage) THEN
      RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review yet';
    END IF;
  END IF;

  -- The gate 087 exists for, unchanged.
  IF v_stage.verification_required THEN
    SELECT * INTO v_latest FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND OR v_latest.decision <> 'verified' THEN
      RAISE EXCEPTION 'not_verified: independent verification is required and the latest decision is %',
        COALESCE(v_latest.decision, 'none');
    END IF;
  END IF;

  PERFORM set_config('app.approve_stage', 'on', true);

  IF v_admin THEN
    UPDATE public.project_substages
       SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
     WHERE stage_id = p_stage AND status <> 'complete';
  END IF;

  UPDATE public.project_stages
     SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
   WHERE id = p_stage;

  SELECT * INTO v_next FROM public.project_stages
   WHERE project_id = v_stage.project_id AND stage_number > v_stage.stage_number
   ORDER BY stage_number LIMIT 1;

  v_final := NOT FOUND;

  IF FOUND THEN
    UPDATE public.project_stages SET status = 'active' WHERE id = v_next.id;
    UPDATE public.projects SET current_stage = v_next.stage_number WHERE id = v_stage.project_id;
  ELSE
    UPDATE public.projects SET status = 'completed' WHERE id = v_stage.project_id;
  END IF;

  PERFORM public.log_activity(
    v_stage.project_id, 'stage.approved', 'project_stage', p_stage, auth.uid(),
    jsonb_build_object(
      'stage_number', v_stage.stage_number,
      'by',           CASE WHEN v_admin THEN 'admin' ELSE 'client' END,
      'verification', CASE WHEN v_stage.verification_required THEN v_latest.id ELSE NULL END));

  RETURN jsonb_build_object('final', v_final,
                            'next_stage', CASE WHEN v_final THEN NULL ELSE v_next.stage_number END);
END $$;

REVOKE ALL ON FUNCTION public.approve_stage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stage(uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_stage(uuid) IS
  'Approve a stage and open the next. Admitted: staff, and the CLIENT of a Self Verify '
  'project — owner or invited client viewer (174). Paid, every substage complete, any '
  'required verification passed, and, where a contractor is on the build, evidence to '
  'review.';

-- ── 6. And submits for review, on the verified tiers ───────
CREATE OR REPLACE FUNCTION public.submit_stage_for_review(p_stage uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage   public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_built   boolean;
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  -- Same widening as approve_stage, and for the same reason: on a Jalla Verify build
  -- run by a contractor, the owner is the contractor. Leaving this one behind would
  -- give the invited client approval on Self Verify and nothing on the tiers Jalla is
  -- actually paid for.
  IF NOT public.is_project_client(v_stage.project_id) THEN
    RAISE EXCEPTION 'not_client: only the client of this project submits a stage for review';
  END IF;
  IF v_project.tier IN ('self_verify', 'starter') THEN
    RAISE EXCEPTION 'self_verify: a Self Verify stage is approved with approve_stage(), not submitted';
  END IF;
  IF v_stage.status <> 'active' THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;
  IF v_stage.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'not_paid: this stage has not been paid for';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_substages
              WHERE stage_id = p_stage AND status NOT IN ('pending_review', 'complete')) THEN
    RAISE EXCEPTION 'substages_not_ready: every substage must be pending review or complete';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci
                  WHERE ci.project_id = v_stage.project_id AND ci.status = 'accepted')
    INTO v_built;
  IF v_built AND NOT public.stage_has_evidence(p_stage) THEN
    RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review yet';
  END IF;

  UPDATE public.project_stages SET status = 'pending_review' WHERE id = p_stage;

  PERFORM public.log_activity(v_stage.project_id, 'stage_submitted_for_review', 'project_stage', p_stage, NULL,
    jsonb_build_object('stage_number', v_stage.stage_number, 'tier', v_project.tier));
END $$;

REVOKE ALL ON FUNCTION public.submit_stage_for_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_for_review(uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_stage_for_review(uuid) IS
  'Send a stage to Jalla on a verified tier. Admitted: the CLIENT — owner or invited '
  'client viewer (174) — with the same paid, substage and evidence preconditions as '
  'approve_stage().';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- one invite function, taking four arguments
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'invite_project_viewer';
--
--   -- both gates now go through the shared definition
--   SELECT proname FROM pg_proc
--    WHERE prosrc LIKE '%is_project_client%' AND proname <> 'is_project_client';
--
--   -- at most one client per project
--   SELECT project_id, count(*) FROM public.project_viewers
--    WHERE is_client AND revoked_at IS NULL GROUP BY 1 HAVING count(*) > 1;
