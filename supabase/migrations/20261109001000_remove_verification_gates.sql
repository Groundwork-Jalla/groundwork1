-- Free mode: disable independent verification gates on all projects.

BEGIN;

-- Existing stages should approve directly without verifier decisions.
UPDATE public.project_stages
   SET verification_required = false
 WHERE verification_required;

-- New stages are always direct-approval while pricing gates are paused.
CREATE OR REPLACE FUNCTION public.stages_default_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.verification_required := false;
  RETURN NEW;
END $$;

-- Tier changes no longer affect stage approval requirements.
CREATE OR REPLACE FUNCTION public.projects_sync_stage_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    UPDATE public.project_stages
       SET verification_required = false
     WHERE project_id = NEW.id
       AND status <> 'complete';
  END IF;
  RETURN NEW;
END $$;

-- Stage approval still enforces paid + evidence requirements, but no verifier gate.
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage    public.project_stages%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_admin    boolean := public.is_admin();
  v_client   boolean;
  v_built    boolean;
  v_next     public.project_stages%ROWTYPE;
  v_final    boolean;
  v_now      timestamptz := now();
BEGIN
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = v_stage.project_id;

  v_client := public.is_project_client(v_stage.project_id);
  IF NOT v_admin AND NOT v_client THEN
    RAISE EXCEPTION 'not_authorized: only an administrator or the project client may approve a stage';
  END IF;
  IF v_stage.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status;
  END IF;

  IF NOT v_admin THEN
    IF v_stage.payment_status <> 'paid' THEN
      RAISE EXCEPTION 'not_paid: this stage has not been paid for';
    END IF;
    IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN
      RAISE EXCEPTION 'substages_not_ready: not all substages are complete';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci
                    WHERE ci.project_id = v_stage.project_id AND ci.status = 'accepted')
      INTO v_built;
    IF v_built AND NOT public.stage_has_evidence(p_stage) THEN
      RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review yet';
    END IF;
  END IF;

  PERFORM set_config('app.approve_stage', 'on', true);

  IF v_admin THEN
    UPDATE public.project_substages
       SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
     WHERE stage_id = p_stage AND status <> 'complete';
  END IF;

  UPDATE public.project_stages
     SET status = 'complete', completed_at = v_now, approved_by = auth.uid(), approved_at = v_now
   WHERE id = p_stage;

  v_final := (v_stage.stage_number + 1 > 10);
  IF NOT v_final THEN
    SELECT * INTO v_next FROM public.project_stages
     WHERE project_id = v_stage.project_id AND stage_number = v_stage.stage_number + 1;
    IF FOUND THEN
      IF public.stage_funding_settled(v_next.id) THEN
        UPDATE public.project_stages    SET status = 'active'  WHERE id = v_next.id;
        UPDATE public.project_substages SET status = 'pending' WHERE stage_id = v_next.id;
      ELSE
        PERFORM public.log_activity(v_stage.project_id, 'stage.awaiting_payment',
          'project_stage', v_next.id, NULL,
          jsonb_build_object('stage_number', v_stage.stage_number + 1));
      END IF;
    END IF;
  END IF;

  UPDATE public.projects
     SET current_stage = CASE WHEN v_final THEN v_stage.stage_number ELSE v_stage.stage_number + 1 END,
         status        = CASE WHEN v_final THEN 'completed' ELSE 'active' END
   WHERE id = v_stage.project_id;

  PERFORM public.log_activity(v_stage.project_id, 'stage.approved', 'project_stage', p_stage, auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tier', v_project.tier,
      'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'client' END)));

  RETURN jsonb_build_object(
    'project_id',        v_stage.project_id,
    'stage_id',          p_stage,
    'stage_number',      v_stage.stage_number,
    'is_final',          v_final,
    'next_stage_id',     v_next.id,
    'next_stage_number', CASE WHEN v_final THEN NULL ELSE v_stage.stage_number + 1 END,
    'awaiting_payment',  (v_next.id IS NOT NULL AND NOT public.stage_funding_settled(v_next.id)),
    'verification_id',   NULL);
END $$;

COMMIT;
