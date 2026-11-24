-- =========================================================
-- Safe post-creation adjustment of a project's starting stage (25 Nov 2026)
--
-- If a contractor or homeowner accidentally creates a project starting at Stage 1
-- (e.g. Land Secured) instead of Stage 5 (Structure & Walls), they can adjust the
-- starting stage right after creation — strictly BEFORE any payment receipts,
-- confirmed payments, verifications, or site evidence have been recorded.
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.update_project_starting_stage(
  p_project_id  uuid,
  p_start_stage integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project      public.projects%ROWTYPE;
  v_stages       integer;
  v_start        integer;
  v_skipped      integer;
  v_is_boq       boolean;
  v_verify       boolean;
  v_live_usd     numeric;
  v_live_pct     numeric;
  v_construction numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  IF NOT (
       public.is_admin()
    OR public.is_my_clients_project(p_project_id)
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = p_project_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.contractor_invites ci
                WHERE ci.project_id = p_project_id
                  AND ci.contractor_user_id = auth.uid()
                  AND ci.status = 'accepted'
                  AND ci.is_primary = true)
  ) THEN
    RAISE EXCEPTION 'not_allowed: this is not your project';
  END IF;

  SELECT * INTO v_project
    FROM public.projects
   WHERE id = p_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION 'project_archived';
  END IF;

  IF v_project.tracking_started_at IS NULL THEN
    RAISE EXCEPTION 'tracking_not_started';
  END IF;

  SELECT count(*) INTO v_stages
    FROM public.project_stages
   WHERE project_id = p_project_id;

  IF v_stages = 0 THEN
    RAISE EXCEPTION 'no_stages: this project has no stage schedule yet';
  END IF;

  v_start := COALESCE(p_start_stage, 1);
  IF v_start < 1 OR v_start >= v_stages THEN
    RAISE EXCEPTION 'bad_stage: starting stage must be between 1 and %', v_stages - 1;
  END IF;

  -- Safety gate: once real site work, verifications, or payments have been recorded,
  -- shifting the starting stage could contradict financial or inspection records.
  IF EXISTS (
    SELECT 1 FROM public.project_stages
     WHERE project_id = p_project_id
       AND COALESCE(pre_existing, false) = false
       AND (status IN ('complete', 'pending_review') OR COALESCE(payment_status, 'unpaid') = 'paid')
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: work or payments have already started on this project';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_substages
     WHERE project_id = p_project_id
       AND (COALESCE(cardinality(evidence_urls), 0) > 0 OR approved_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: evidence has already been uploaded on this project';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stage_payment_receipts
     WHERE project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: payment receipts have already been recorded on this project';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments
     WHERE project_id = p_project_id
       AND (state <> 'expected' OR receipt_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: payments have already been recorded on this project';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contractor_stage_verifications
     WHERE project_id = p_project_id
       AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: upfront payments have already been confirmed on this project';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stage_verifications sv
      JOIN public.project_stages ps ON ps.id = sv.stage_id
     WHERE ps.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'starting_stage_locked: stage verifications have already been requested on this project';
  END IF;

  v_is_boq := COALESCE(v_project.budget_source, '') = 'boq';
  v_verify := COALESCE(v_project.tier, '') IN ('verified', 'management');

  -- Recover full construction pool from active/locked stages so moving the starting
  -- stage BACKWARD (e.g. from Stage 5 to Stage 3) restores milestone amounts cleanly.
  SELECT COALESCE(sum(payment_milestone_usd), 0), COALESCE(sum(budget_pct), 0)
    INTO v_live_usd, v_live_pct
    FROM public.project_stages
   WHERE project_id = p_project_id
     AND COALESCE(pre_existing, false) = false
     AND COALESCE(budget_pct, 0) > 0
     AND COALESCE(payment_milestone_usd, 0) > 0;

  IF v_live_pct > 0 THEN
    v_construction := v_live_usd / (v_live_pct / 100.0);
  END IF;

  PERFORM set_config('app.join_in_progress', 'on', true);

  -- 1. Stages before the new starting stage → marked as completed before Groundwork.
  UPDATE public.project_stages
     SET status                   = 'complete',
         pre_existing             = true,
         pre_existing_recorded_at = COALESCE(pre_existing_recorded_at, now()),
         verification_required    = false,
         payment_milestone_usd    = CASE WHEN v_is_boq THEN payment_milestone_usd ELSE 0 END,
         fixed_amount_usd         = 0,
         completed_at             = NULL
   WHERE project_id = p_project_id
     AND stage_number < v_start;
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  UPDATE public.project_substages sub
     SET status = 'complete', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number < v_start;

  -- 2. The new starting stage → active & billable.
  UPDATE public.project_stages
     SET status                   = 'active',
         pre_existing             = false,
         pre_existing_recorded_at = NULL,
         verification_required    = v_verify,
         completed_at             = NULL,
         payment_milestone_usd    = CASE
           WHEN v_is_boq THEN payment_milestone_usd
           WHEN COALESCE(payment_milestone_usd, 0) > 0 THEN payment_milestone_usd
           WHEN v_construction > 0 AND COALESCE(budget_pct, 0) > 0 THEN ROUND(v_construction * budget_pct / 100.0, 2)
           ELSE payment_milestone_usd
         END
   WHERE project_id = p_project_id
     AND stage_number = v_start;

  UPDATE public.project_substages sub
     SET status = 'pending', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number = v_start;

  -- 3. Stages after the new starting stage → locked & billable.
  UPDATE public.project_stages
     SET status                   = 'locked',
         pre_existing             = false,
         pre_existing_recorded_at = NULL,
         verification_required    = v_verify,
         completed_at             = NULL,
         payment_milestone_usd    = CASE
           WHEN v_is_boq THEN payment_milestone_usd
           WHEN COALESCE(payment_milestone_usd, 0) > 0 THEN payment_milestone_usd
           WHEN v_construction > 0 AND COALESCE(budget_pct, 0) > 0 THEN ROUND(v_construction * budget_pct / 100.0, 2)
           ELSE payment_milestone_usd
         END
   WHERE project_id = p_project_id
     AND stage_number > v_start;

  UPDATE public.project_substages sub
     SET status = 'locked', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number > v_start;

  -- 4. Update project pointers.
  UPDATE public.projects
     SET joined_at_stage = CASE WHEN v_start > 1 THEN v_start ELSE NULL END,
         current_stage   = v_start,
         updated_at      = now()
   WHERE id = p_project_id;

  -- 5. Audit log & notify other project members.
  PERFORM public.log_activity(
    p_project_id,
    'project.starting_stage_updated',
    'project',
    p_project_id,
    auth.uid(),
    jsonb_build_object(
      'previous_start_stage', COALESCE(v_project.joined_at_stage, 1),
      'start_stage', v_start,
      'stages_marked_pre_existing', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'start_stage', v_start,
    'pre_existing_stages', v_skipped
  );
END $$;

REVOKE ALL ON FUNCTION public.update_project_starting_stage(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_starting_stage(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
