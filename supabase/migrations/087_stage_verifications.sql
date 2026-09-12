-- =========================================================
-- 087  Verification is a record, and approval is a database decision
--
-- Phase 4 of the admin re-architecture, migration 3 of 7
-- (docs/groundwork-admin/04-implementation-plan.md §2; Phase 3 §3.6–3.9, §4). Depends
-- on 086 (project_verifiers, verification_required, log_activity, is_contractor_on).
--
-- WHAT WAS MISSING. On Jalla Verify, "independent verification" was an admin pressing
-- Approve after looking at photos — nothing recorded who looked, whether anyone visited,
-- what they found, or that the person approving was not also the person who built it.
-- The 3 Sep meeting decided an independent professional must visit the site. This
-- migration is where that visit becomes a row.
--
-- THE CHAIN, AND WHO MAY DO WHAT AT EACH LINK
--
--   evidence → verification requested (admin picks ONE verifier)
--            → verifier decides: verified | rejected | needs_more_evidence
--            → approval (approve_stage: refuses unless verified, where required)
--            → eligibility (090, derived) → release (090, authorised)
--
-- A verifier saying "verified" authorises nothing — it is one input to approval. An
-- admin approving cannot skip a required verification — the function refuses. Those are
-- two authorities kept apart on purpose (Phase 3 §2, reviewer note on 087).
--
-- VERIFIED MEANS VISITED. A 'verified' decision requires visited_at — enforced by CHECK
-- and named by the RPC (visit_required:). Pending, rejected and needs_more_evidence do
-- not: a request has no visit yet, and a refusal can be given on the plans alone.
--
-- ADMIN ON BEHALF OF A VERIFIER. Allowed, strictly (Phase 3 §8.1): the row's verifier_id
-- stays the professional; recorded_by is the admin; recorded_on_behalf_of MUST equal
-- verifier_id and a reason is mandatory — both enforced by CHECK, not by the UI. The
-- audit row carries both identities. "Recorded by admin on behalf of X" is never
-- "verified by admin".
--
-- APPROVAL MOVES INTO SQL. approve_stage() is now the one place project_stages.status
-- becomes 'complete' — for the admin path AND the self-verify owner path — and a
-- trigger refuses that transition from anywhere else, using a transaction-local flag
-- the function sets (the set_config pattern from 025). The owner UPDATE policy from 086
-- stays for every other stage field; the status transition alone is gated. The client
-- keeps its side effects (certificate PDF, emails, notifications) — those are not state.
--
-- THE FOUR STORED STATUSES ARE UNCHANGED. verification_pending, verified, rejected and
-- the rest are derived in src/lib/lifecycle/stage.ts from status + this table; nothing
-- here stores a lifecycle value.
--
-- Run in: Supabase Dashboard > SQL Editor (after 086)
-- =========================================================

-- ── 1. The verification record ───────────────────────────
CREATE TABLE IF NOT EXISTS public.stage_verifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id               uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  verifier_id            uuid NOT NULL REFERENCES auth.users(id),
  requested_by           uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  -- The site update that was inspected. Plain uuid now; 088 adds the FK when the table exists.
  site_update_id         uuid,
  visited_at             timestamptz,
  decision               text NOT NULL DEFAULT 'pending'
                         CHECK (decision IN ('pending', 'verified', 'rejected', 'needs_more_evidence')),
  findings               text,
  checklist              jsonb,
  decided_at             timestamptz,
  recorded_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_on_behalf_of  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason                 text,
  certificate_id         uuid REFERENCES public.certificates(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- pending ⇔ undecided; nothing else may be undecided.
  CONSTRAINT stage_verifications_decided_iff
    CHECK ((decision = 'pending') = (decided_at IS NULL)),
  -- On-behalf recording names the actual verifier and gives a reason, or is not on-behalf.
  CONSTRAINT stage_verifications_on_behalf_strict
    CHECK (recorded_on_behalf_of IS NULL
           OR (recorded_on_behalf_of = verifier_id AND reason IS NOT NULL AND btrim(reason) <> '')),
  -- "Verified" means an independent professional visited the site (3 Sep decision). A
  -- verified row with no visit would be a record of exactly the photo-review this
  -- migration exists to replace. Rejections need no visit: a plan can be refused on paper.
  CONSTRAINT stage_verifications_verified_means_visited
    CHECK (decision <> 'verified' OR visited_at IS NOT NULL)
);

-- One open request per stage. A re-verification after a rejection is a new row once the
-- first is decided.
CREATE UNIQUE INDEX IF NOT EXISTS stage_verifications_one_pending_per_stage
  ON public.stage_verifications (stage_id) WHERE decision = 'pending';

CREATE INDEX IF NOT EXISTS stage_verifications_stage_idx   ON public.stage_verifications (stage_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stage_verifications_verifier_idx ON public.stage_verifications (verifier_id) WHERE decision = 'pending';

-- The contractor-cannot-verify rule, again at this boundary: the assignment table (086)
-- refuses it, and so does the verification row, so neither can be reached around the other.
CREATE OR REPLACE FUNCTION public.stage_verifications_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_contractor_on(NEW.project_id, NEW.verifier_id) THEN
    RAISE EXCEPTION 'contractor_cannot_verify: user % is a contractor on project %', NEW.verifier_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stage_verifications_guard ON public.stage_verifications;
CREATE TRIGGER stage_verifications_guard
  BEFORE INSERT OR UPDATE ON public.stage_verifications
  FOR EACH ROW EXECUTE FUNCTION public.stage_verifications_guard();

ALTER TABLE public.stage_verifications ENABLE ROW LEVEL SECURITY;

-- Read: admin; the verifier on the row; every project member (owner, contractor,
-- assigned verifiers) — the decision and findings are part of the project record.
-- Write: RPCs only.
DROP POLICY IF EXISTS "admins_read_verifications" ON public.stage_verifications;
CREATE POLICY "admins_read_verifications"
  ON public.stage_verifications FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "members_read_verifications" ON public.stage_verifications;
CREATE POLICY "members_read_verifications"
  ON public.stage_verifications FOR SELECT TO authenticated USING (public.project_member(project_id));

-- ── 2. Request a verification — the admin picks one verifier ──
CREATE OR REPLACE FUNCTION public.request_verification(p_stage uuid, p_verifier uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage   public.project_stages%ROWTYPE;
  v_id      uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may request a verification';
  END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  IF v_stage.status <> 'pending_review' THEN
    RAISE EXCEPTION 'wrong_state: stage is %, not pending_review', v_stage.status;
  END IF;
  IF NOT v_stage.verification_required THEN
    RAISE EXCEPTION 'not_required: this stage does not require independent verification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_verifiers
                  WHERE project_id = v_stage.project_id AND user_id = p_verifier AND status = 'active') THEN
    RAISE EXCEPTION 'not_assigned: that verifier is not assigned to this project';
  END IF;
  -- One pending request per stage (partial unique). A second call is a clear error.
  IF EXISTS (SELECT 1 FROM public.stage_verifications WHERE stage_id = p_stage AND decision = 'pending') THEN
    RAISE EXCEPTION 'already_pending: a verification is already open for this stage';
  END IF;

  INSERT INTO public.stage_verifications (stage_id, project_id, verifier_id, requested_by)
  VALUES (p_stage, v_stage.project_id, p_verifier, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.log_activity(v_stage.project_id, 'verification.requested', 'stage_verification', v_id, p_verifier,
                              jsonb_build_object('stage_id', p_stage, 'stage_number', v_stage.stage_number));
  RETURN v_id;
END $$;

-- ── 3. Record the decision — the verifier, or an admin strictly on their behalf ──
CREATE OR REPLACE FUNCTION public.record_verification(
  p_verification uuid,
  p_decision     text,
  p_findings     text        DEFAULT NULL,
  p_checklist    jsonb       DEFAULT NULL,
  p_visited_at   timestamptz DEFAULT NULL,
  p_on_behalf_of uuid        DEFAULT NULL,
  p_reason       text        DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.stage_verifications%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  -- FOR UPDATE: two decisions on the same row serialise here, and the second sees
  -- the first's result rather than the pending row both started from.
  SELECT * INTO v FROM public.stage_verifications WHERE id = p_verification FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such verification'; END IF;
  IF v.decision <> 'pending' THEN
    RAISE EXCEPTION 'already_decided: this verification was decided at %', v.decided_at;
  END IF;
  IF p_decision NOT IN ('verified', 'rejected', 'needs_more_evidence') THEN
    RAISE EXCEPTION 'bad_decision: % is not a decision', p_decision;
  END IF;
  IF p_decision = 'verified' AND COALESCE(p_visited_at, v.visited_at) IS NULL THEN
    RAISE EXCEPTION 'visit_required: a verified decision needs the date of the site visit';
  END IF;

  -- Who is allowed to decide this row: the named verifier, or an admin recording on
  -- that verifier's behalf with a reason. Membership is not enough; admin alone is not
  -- enough; another verifier on the same project is not enough.
  IF v_actor = v.verifier_id THEN
    IF p_on_behalf_of IS NOT NULL THEN
      RAISE EXCEPTION 'on_behalf_not_applicable: the verifier records their own decision directly';
    END IF;
  ELSIF public.is_admin() THEN
    IF p_on_behalf_of IS NULL THEN
      RAISE EXCEPTION 'on_behalf_required: an administrator must name the verifier whose decision this is';
    END IF;
    IF p_on_behalf_of <> v.verifier_id THEN
      RAISE EXCEPTION 'on_behalf_mismatch: this verification belongs to a different verifier';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'reason_required: recording on behalf of a verifier needs a reason';
    END IF;
  ELSE
    RAISE EXCEPTION 'not_verifier: only the assigned verifier may record this decision';
  END IF;

  UPDATE public.stage_verifications
     SET decision              = p_decision,
         findings              = p_findings,
         checklist             = p_checklist,
         visited_at            = COALESCE(p_visited_at, visited_at),
         decided_at            = now(),
         recorded_by           = v_actor,
         recorded_on_behalf_of = p_on_behalf_of,
         reason                = p_reason
   WHERE id = p_verification;

  -- A rejection sends the stage back for more work — the same transitions
  -- adminRequestRework has always made, now in the same transaction as the decision.
  IF p_decision IN ('rejected', 'needs_more_evidence') THEN
    UPDATE public.project_stages SET status = 'active' WHERE id = v.stage_id;
    UPDATE public.project_substages
       SET status = 'in_progress', approved_by = NULL, approved_at = NULL
     WHERE stage_id = v.stage_id AND status = 'pending_review';
  END IF;

  PERFORM public.log_activity(v.project_id, 'verification.decided', 'stage_verification', p_verification, v.verifier_id,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_id', v.stage_id, 'decision', p_decision,
      'recorded_on_behalf_of', p_on_behalf_of, 'reason', p_reason)));
END $$;

-- ── 4. Approval — the one place a stage becomes 'complete' ──
--
-- Both paths that used to write this from the browser now come here:
--   admin  (any tier)            — from /admin/reviews
--   owner  (self_verify only)    — from the project page
-- Each keeps exactly the preconditions its TypeScript had. Where verification is
-- required, the latest decision must be 'verified' — no actor can approve past a
-- rejection or an open request.
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_admin    boolean := public.is_admin();
  v_owner    boolean;
  v_self     boolean;
  v_latest   public.stage_verifications%ROWTYPE;
  v_next     public.project_stages%ROWTYPE;
  v_final    boolean;
  v_now      timestamptz := now();
BEGIN
  -- FOR UPDATE: approval is a security-critical transition. Two admins clicking at once
  -- serialise on this lock; the second re-reads the row after the first commits, finds it
  -- already complete, and gets wrong_state — one approval, one audit row, one next-stage
  -- activation. Without the lock both would read pending_review and both would proceed.
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  v_owner := (v_project.user_id = auth.uid());
  v_self  := (v_project.tier IN ('self_verify', 'starter'));

  IF NOT v_admin AND NOT (v_owner AND v_self) THEN
    RAISE EXCEPTION 'not_authorized: only an administrator, or the owner of a Self Verify project, may approve a stage';
  END IF;
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  -- The owner path's own preconditions, as before (approvals.ts approveStage).
  IF NOT v_admin THEN
    IF v_stage.payment_status <> 'paid' THEN
      RAISE EXCEPTION 'not_paid: this stage has not been paid for';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN
      RAISE EXCEPTION 'substages_not_ready: not all substages are complete';
    END IF;
  END IF;

  -- The gate this migration exists for.
  IF v_stage.verification_required THEN
    SELECT * INTO v_latest FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND OR v_latest.decision <> 'verified' THEN
      RAISE EXCEPTION 'not_verified: independent verification is required and the latest decision is %',
        COALESCE(v_latest.decision, 'none');
    END IF;
  END IF;

  -- Lets the completion guard below know this transition is legitimate.
  PERFORM set_config('app.approve_stage', 'on', true);

  IF v_admin THEN
    UPDATE public.project_substages
       SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
     WHERE stage_id = p_stage AND status <> 'complete';
  END IF;

  UPDATE public.project_stages SET status = 'complete', completed_at = v_now WHERE id = p_stage;

  v_final := (v_stage.stage_number + 1 > 10);
  IF NOT v_final THEN
    SELECT * INTO v_next FROM public.project_stages
     WHERE project_id = v_stage.project_id AND stage_number = v_stage.stage_number + 1;
    IF FOUND THEN
      UPDATE public.project_stages    SET status = 'active'  WHERE id = v_next.id;
      UPDATE public.project_substages SET status = 'pending' WHERE stage_id = v_next.id;
    END IF;
  END IF;

  UPDATE public.projects
     SET current_stage = CASE WHEN v_final THEN v_stage.stage_number ELSE v_stage.stage_number + 1 END,
         status        = CASE WHEN v_final THEN 'completed' ELSE 'active' END
   WHERE id = v_stage.project_id;

  PERFORM public.log_activity(v_stage.project_id, 'stage.approved', 'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tier', v_project.tier,
      'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'owner' END,
      'verification_id', v_latest.id)));

  RETURN jsonb_build_object(
    'project_id',        v_stage.project_id,
    'stage_id',          p_stage,
    'stage_number',      v_stage.stage_number,
    'is_final',          v_final,
    'next_stage_id',     v_next.id,
    'next_stage_number', CASE WHEN v_final THEN NULL ELSE v_stage.stage_number + 1 END,
    'verification_id',   v_latest.id);
END $$;

-- The guard: 'complete' is only ever written by approve_stage(). Any other UPDATE that
-- tries it — a browser using the owner or admin UPDATE policy, a script, a future bug —
-- is refused. Everything else about a stage row remains writable as before.
CREATE OR REPLACE FUNCTION public.stages_guard_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete'
     AND current_setting('app.approve_stage', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'approve_via_rpc: a stage is completed through approve_stage(), not by updating status';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stages_guard_completion ON public.project_stages;
CREATE TRIGGER stages_guard_completion
  BEFORE UPDATE OF status ON public.project_stages
  FOR EACH ROW EXECUTE FUNCTION public.stages_guard_completion();

-- ── 5. Grants ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.request_verification(uuid, uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_verification(uuid, text, text, jsonb, timestamptz, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_stage(uuid)                                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_verification(uuid, uuid)                                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.record_verification(uuid, text, text, jsonb, timestamptz, uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.approve_stage(uuid)                                                TO authenticated;

COMMENT ON TABLE public.stage_verifications IS
  'One row per verification request on a stage; decided by the assigned verifier, or by an '
  'admin strictly on their behalf (recorded_on_behalf_of = verifier_id, reason required). '
  'A "verified" decision is an input to approve_stage(), never an authorisation itself. See 087.';

-- ── Verify ───────────────────────────────────────────────
-- Three rows: the three functions.
SELECT proname FROM pg_proc
 WHERE proname IN ('request_verification', 'record_verification', 'approve_stage') ORDER BY 1;
