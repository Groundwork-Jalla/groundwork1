-- =========================================================
-- 103  A build Groundwork joined halfway through
--
-- WHY
--
-- Partner contractors bring their own clients, and those builds are often already up to the
-- roof. Starting such a project at stage 1 asks the client to fund and have verified work
-- that was finished and paid for before Groundwork existed. Favour, 30 Sep 2026: mark the
-- earlier stages done, "it will not require any payment, we're not going to do anything, it
-- will just start from where that contractor is".
--
-- ── A STAGE WE DID NOT WATCH IS NOT A STAGE WE APPROVED ───────────────────────────────
-- This is the whole design. `approve_stage` (087) means "an administrator, on the strength of
-- a verification where one was required, accepts this stage". Nothing about a pre-existing
-- stage is that: no evidence was uploaded, no verifier visited, no money moved through us.
--
-- So these rows are marked `complete` AND `pre_existing = true`, written by their own RPC
-- under their own guard flag — never by `approve_stage`. Two consequences that matter:
--
--   · No certificate can ever be issued for one. Certificates come from the approval path
--     (014 / the admin approve action); this path does not touch it, so there is no code to
--     forget. A Groundwork certificate over work nobody from Groundwork saw would be the
--     single most damaging thing this feature could produce.
--   · `verification_required` is set FALSE on them, because it cannot be satisfied. A
--     verifier cannot inspect a foundation that is under a finished house, and leaving the
--     flag true would wedge the project behind a verification nobody can ever record.
--
-- ── The guard is extended, not weakened ──────────────────────────────────────────────
-- 087's rule was "only approve_stage() writes complete". It becomes "only approve_stage(),
-- or the joining RPC below, and the second one must also set pre_existing". Widening it with
-- a second named flag keeps the refusal in place for a browser, a script or a future bug —
-- which is what the guard is for — while making the two legitimate writers distinguishable
-- forever afterwards in the data.
--
-- ── No payment is recorded, because none was received ────────────────────────────────
-- Prior stages get `payment_milestone_usd = 0`, and no `in` or `out` row is fabricated.
-- Inventing a funded payment to make a stage look settled would put money in the ledger that
-- never existed and break every reconciliation after it.
--
-- `project_stages.payment_status` — 090's LEGACY projection — will read `paid` for a
-- zero-milestone stage, because its rule is "nothing is owed, so nothing is outstanding".
-- That stays as internal compatibility behaviour for the fourteen files still reading the
-- column, and it is NOT a statement that money moved. `Paid` on any Finance or Payments
-- surface means an outgoing row in state `disbursed`; a pre-existing stage has none and must
-- never be rendered that way. `stageLifecycle()` (the modern derivation) is the authority and
-- returns `pre_existing` for these rows, so no surface has to infer it from a milestone of 0.
--
-- The invariant, pinned by tests on both sides:
--   pre_existing + milestone 0 → no incoming row, no outgoing row,
--                                $0 confirmed inflow, $0 disbursed, never "Paid".
--
-- ── We do not know when it was built ─────────────────────────────────────────────────
-- `completed_at` is left NULL. Stamping `now()` would assert that a foundation poured in 2019
-- was completed the day an administrator typed a sentence, and that date would then flow into
-- timelines, exports and anything reading stage history as fact. What we actually know is
-- when GROUNDWORK RECORDED it, which is a different thing and is stored separately in
-- `pre_existing_recorded_at`. If a historical completion date is ever collected from the
-- contractor, it belongs in `completed_at` then — supplied, never inferred.
--
-- Run in: Supabase Dashboard > SQL Editor (after 102)
-- =========================================================

-- ── 1. Which stages were never ours ──────────────────────

ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS pre_existing boolean NOT NULL DEFAULT false;

-- When GROUNDWORK recorded this as already built. Not when it was built — see the header.
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS pre_existing_recorded_at timestamptz;

COMMENT ON COLUMN public.project_stages.pre_existing_recorded_at IS
  'When an administrator recorded this stage as already built. NOT the construction''s own '
  'completion date, which Groundwork does not know — `completed_at` stays NULL unless a '
  'historical date was actually supplied. See 103.';

-- A pre-existing stage carries its recording date, and nothing else carries one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_dated') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_dated
      CHECK (pre_existing = (pre_existing_recorded_at IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.project_stages.pre_existing IS
  'TRUE when this stage was already built before the project joined Groundwork. Complete, '
  'but never approved by us, never verified by us and never funded through us — so it '
  'carries no certificate and no milestone. See 103.';

-- A stage cannot be "already built" and still waiting: the whole point is that it is done.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_is_complete') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_is_complete
      CHECK (NOT pre_existing OR status = 'complete');
  END IF;
END $$;

-- Nothing we did not watch may ever claim verification. Belt and braces with the RPC, which
-- sets the flag false itself: this refuses a later hand-edit too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_stages_pre_existing_unverified') THEN
    ALTER TABLE public.project_stages
      ADD CONSTRAINT project_stages_pre_existing_unverified
      CHECK (NOT pre_existing OR verification_required = false);
  END IF;
END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS joined_at_stage integer
    CHECK (joined_at_stage IS NULL OR joined_at_stage BETWEEN 1 AND 10);

COMMENT ON COLUMN public.projects.joined_at_stage IS
  'The stage this build had reached when it joined Groundwork, when it did not join at the '
  'beginning. NULL for an ordinary new build. See 103.';

-- ── 2. The completion guard, widened by exactly one writer ─
CREATE OR REPLACE FUNCTION public.stages_guard_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete'
     AND current_setting('app.approve_stage', true)  IS DISTINCT FROM 'on'
     -- 103. The joining RPC, and only while it is also marking the row pre_existing: the
     -- flag alone is not a licence to complete a stage in any other way.
     AND NOT (current_setting('app.join_in_progress', true) = 'on' AND NEW.pre_existing) THEN
    RAISE EXCEPTION 'approve_via_rpc: a stage is completed through approve_stage(), not by updating status';
  END IF;
  RETURN NEW;
END $$;

-- ── 3. A pre-existing stage can never present a release ───
--
-- 090's `stage_release_blocker` would already refuse one, but only incidentally: the milestone
-- is 0, `amount > 0` is a CHECK on the payments table, so the refusal arrives as
-- `over_milestone` — the wrong reason, and only AFTER a screen may already have offered the
-- action. The reviewer's objection is right: eligibility must not depend on a later constraint
-- exploding.
--
-- So the reason is named first and explicitly. `stage_release_blocker` is restated here in
-- full with one clause added at the top of its checks; every other line is 090's, unchanged.
CREATE OR REPLACE FUNCTION public.stage_release_blocker(p_stage uuid, p_amount numeric)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_decision text;
  v_funded   numeric;
  v_out      numeric;
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- NEW IN 103, and deliberately before everything else. Work Groundwork never funded has
  -- nothing to release, and saying so by name means the UI can explain it rather than
  -- offering a button that fails.
  IF v_stage.pre_existing THEN RETURN 'pre_existing'; END IF;

  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;
  IF v_project.status = 'on_hold' THEN RETURN 'on_hold'; END IF;
  IF v_stage.status <> 'complete' THEN RETURN 'not_complete'; END IF;
  IF v_stage.verification_required THEN
    SELECT decision INTO v_decision FROM public.stage_verifications
     WHERE stage_id = p_stage ORDER BY requested_at DESC, created_at DESC LIMIT 1;
    IF v_decision IS DISTINCT FROM 'verified' THEN RETURN 'not_verified'; END IF;
  END IF;
  -- A stage with no milestone owes nothing, whether or not it is pre-existing.
  IF COALESCE(v_stage.payment_milestone_usd, 0) <= 0 THEN RETURN 'nothing_due'; END IF;
  IF p_amount > v_stage.payment_milestone_usd THEN RETURN 'over_milestone'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_funded FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'in' AND state IN ('funded', 'reconciled');
  SELECT COALESCE(sum(amount), 0) INTO v_out FROM public.payments
   WHERE project_id = v_stage.project_id AND direction = 'out' AND state <> 'failed';
  IF v_funded - v_out < p_amount THEN RETURN 'insufficient_funds'; END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.stage_release_blocker(uuid, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.stage_release_blocker(uuid, numeric) IS
  'Why a release for this stage cannot be authorised, or NULL when it can. 103 adds '
  '`pre_existing` (work Groundwork never funded) and `nothing_due` (no milestone) as named '
  'reasons ahead of the amount checks, so no surface can offer a release that would then be '
  'refused by a constraint. See 090, 103.';

-- ── 4. Start a project at the stage it has actually reached ─
--
-- Deliberately a SEPARATE function from `admin_start_project_tracking` rather than another
-- parameter on it. That one is called by the ordinary creation path and has been rewritten
-- four times (019, 036, 041, 072); adding a stage argument would change the meaning of every
-- existing call site and force its grant to be reissued. This one composes with it instead:
-- same milestone application, then the backdating.
CREATE OR REPLACE FUNCTION public.admin_start_project_at_stage(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric,
  p_verification_fee numeric,
  p_contingency_fee  numeric,
  p_start_stage      integer,
  -- What the contractor said, verbatim. The reason this project starts where it does has to
  -- outlive the admin who typed it, and "why is stage 4 complete with no evidence?" is a
  -- question somebody will ask in a year.
  p_note             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stages   integer;
  v_start    integer;
  v_skipped  integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: admins only'; END IF;

  SELECT count(*) INTO v_stages FROM public.project_stages WHERE project_id = p_project_id;
  IF v_stages = 0 THEN RAISE EXCEPTION 'no_stages: this project has no stage schedule yet'; END IF;

  v_start := COALESCE(p_start_stage, 1);
  IF v_start < 1 OR v_start > v_stages THEN
    RAISE EXCEPTION 'bad_stage: % is not a stage on this project (1..%)', v_start, v_stages;
  END IF;
  -- The last stage is the handover. A project cannot JOIN at its own completion — there
  -- would be nothing left to track, and it would arrive with every stage marked done by
  -- somebody's typed sentence.
  IF v_start = v_stages THEN
    RAISE EXCEPTION 'nothing_left: a project cannot join at its final stage';
  END IF;

  UPDATE public.projects
     SET budget_usd          = p_final_budget,
         tracking_started_at = now(),
         joined_at_stage     = CASE WHEN v_start > 1 THEN v_start ELSE NULL END,
         updated_at          = now()
   WHERE id = p_project_id
     AND tracking_started_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'already_started: project not found, or tracking already started';
  END IF;

  -- Every stage gets its true milestone from the full construction fee, exactly as an
  -- ordinary build would. The skipped ones are zeroed below, so a remaining stage costs the
  -- same whether the project joined at stage 1 or stage 6.
  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee);

  PERFORM set_config('app.join_in_progress', 'on', true);

  -- ── The stages that were already built ──
  -- One statement: complete, pre-existing, nothing owed, nothing to verify.
  --
  -- `completed_at` is deliberately left NULL. We do not know when this was built, and
  -- stamping today's date would put a fiction into every timeline and export that reads it.
  -- `pre_existing_recorded_at` carries the only date we actually know: when we wrote this down.
  UPDATE public.project_stages
     SET status                   = 'complete',
         pre_existing             = true,
         pre_existing_recorded_at = now(),
         verification_required    = false,
         payment_milestone_usd    = 0,
         fixed_amount_usd         = 0,
         completed_at             = NULL
   WHERE project_id = p_project_id AND stage_number < v_start;
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  -- `approved_by` and `approved_at` stay NULL: nobody at Groundwork approved these. A
  -- substage marked complete with an approver would name somebody who never saw the work.
  UPDATE public.project_substages sub
     SET status = 'complete', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number < v_start;

  -- ── The stage they are actually on ──
  UPDATE public.project_stages
     SET status = 'active'
   WHERE project_id = p_project_id AND stage_number = v_start;

  UPDATE public.project_substages sub
     SET status = 'pending'
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number = v_start
     AND sub.status = 'locked';

  UPDATE public.projects SET current_stage = v_start WHERE id = p_project_id;

  -- Why this project starts where it does, kept with the project rather than in a ticket.
  PERFORM public.log_activity(p_project_id, 'project.joined_in_progress', 'project', p_project_id, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'start_stage', v_start,
      'stages_marked_pre_existing', v_skipped,
      'budget_usd', p_final_budget,
      'described_as', NULLIF(btrim(p_note), ''))));

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'start_stage', v_start,
    'pre_existing_stages', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) TO authenticated;

COMMENT ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) IS
  'Start tracking a build that was already under way: stages below p_start_stage are marked '
  'complete and pre_existing — no milestone, no verification, no certificate — and the '
  'project becomes active at p_start_stage. See 103.';

-- ── Verify ───────────────────────────────────────────────
SELECT 'projects that joined mid-build' AS what, count(*)::text AS n
  FROM public.projects WHERE joined_at_stage IS NOT NULL
UNION ALL
SELECT 'stages marked already-built', count(*)::text
  FROM public.project_stages WHERE pre_existing
UNION ALL
SELECT 'already-built stages wrongly owing money (expect 0)', count(*)::text
  FROM public.project_stages WHERE pre_existing AND COALESCE(payment_milestone_usd, 0) > 0
UNION ALL
SELECT 'already-built stages wrongly holding a certificate (expect 0)', count(*)::text
  FROM public.stage_verifications sv
  JOIN public.project_stages ps ON ps.id = sv.stage_id
 WHERE ps.pre_existing AND sv.certificate_id IS NOT NULL;

-- ── Rollback (not run; here so the reviewer can see it is complete) ───────────
-- DROP FUNCTION IF EXISTS public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text);
-- Restore stages_guard_completion() from 087 (drop the app.join_in_progress clause).
-- ALTER TABLE public.project_stages DROP CONSTRAINT IF EXISTS project_stages_pre_existing_is_complete;
-- ALTER TABLE public.project_stages DROP CONSTRAINT IF EXISTS project_stages_pre_existing_unverified;
-- ALTER TABLE public.project_stages DROP COLUMN IF EXISTS pre_existing;
-- ALTER TABLE public.projects       DROP COLUMN IF EXISTS joined_at_stage;
-- Stages already marked complete STAY complete: they describe a real house, and reverting
-- them would ask a client to fund work that is standing.
