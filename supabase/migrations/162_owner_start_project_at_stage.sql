-- Let the owner of a project start it at the stage it has actually reached.
--
-- 103 made this admin-only; 121 added the client's contractor. The one person it
-- never allowed is the one the project belongs to — so a client whose house is
-- already at roof level picked "6. Roofing" in the wizard, was shown it, and got a
-- project that began at stage 1 with nothing marked built. The choice was read and
-- discarded, which is worse than not offering it.
--
-- Nothing else changes. The function still refuses a project whose tracking has
-- already started, still refuses the final stage, and the stages it marks complete
-- are `pre_existing`: no milestone, no payment, no verification, no certificate.
-- Saying a stage was built before Groundwork arrived cannot release money.

BEGIN;

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
  p_note             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stages   integer;
  v_start    integer;
  v_skipped  integer;
BEGIN
  IF NOT (
       public.is_admin()
    OR public.is_my_clients_project(p_project_id)
    -- The person whose project it is. A client setting up their own half-finished
    -- house is making exactly the same statement a partner makes on their behalf,
    -- and the wizard has always shown them the choice; it simply threw it away.
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = p_project_id AND p.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_allowed: this is not your project';
  END IF;

  SELECT count(*) INTO v_stages FROM public.project_stages WHERE project_id = p_project_id;
  IF v_stages = 0 THEN RAISE EXCEPTION 'no_stages: this project has no stage schedule yet'; END IF;

  v_start := COALESCE(p_start_stage, 1);
  IF v_start < 1 OR v_start > v_stages THEN
    RAISE EXCEPTION 'bad_stage: % is not a stage on this project (1..%)', v_start, v_stages;
  END IF;
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

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee);

  PERFORM set_config('app.join_in_progress', 'on', true);

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

  UPDATE public.project_substages sub
     SET status = 'complete', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number < v_start;

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
GRANT EXECUTE ON FUNCTION public.admin_start_project_at_stage(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text) TO authenticated;

COMMIT;
