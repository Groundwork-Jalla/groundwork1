-- Allow primary contractors, project owners, and admins to add a new substage
-- directly to any non-completed, non-pre-existing stage across all projects.
-- Stages already split into priced parts (`paid_by_part` / `price_amount IS NOT NULL`)
-- continue to route new parts through `propose_stage_breakdown` so part prices
-- always sum to the stage total.
BEGIN;

CREATE OR REPLACE FUNCTION public.add_project_substage(
  p_stage uuid,
  p_name  text
)
RETURNS public.project_substages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_stage   public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_next    int;
  v_row     public.project_substages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_substage_name: substage name must be between 2 and 120 characters';
  END IF;

  SELECT * INTO v_stage
  FROM public.project_stages
  WHERE id = p_stage
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_not_found';
  END IF;

  IF v_stage.pre_existing OR v_stage.status = 'complete' THEN
    RAISE EXCEPTION 'stage_locked: cannot add substages to a completed or pre-existing stage';
  END IF;

  SELECT * INTO v_project
  FROM public.projects
  WHERE id = v_stage.project_id;

  IF NOT FOUND OR v_project.status = 'archived' THEN
    RAISE EXCEPTION 'project_archived';
  END IF;

  -- Authorization: project owner, accepted primary contractor, or platform admin.
  IF NOT (
    v_project.user_id = v_uid
    OR public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.contractor_invites ci
      WHERE ci.project_id = v_stage.project_id
        AND ci.contractor_user_id = v_uid
        AND ci.status = 'accepted'
        AND ci.is_primary = true
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: only the primary contractor, homeowner, or admin may add substages';
  END IF;

  -- Preserve the priced-breakdown invariant: split stages add new parts via proposal.
  IF v_stage.paid_by_part OR EXISTS (
    SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND price_amount IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'stage_split_use_breakdown: this stage is priced by part; propose a breakdown update to add a priced substage';
  END IF;

  SELECT coalesce(max(substage_number), 0) + 1
  INTO v_next
  FROM public.project_substages
  WHERE stage_id = p_stage;

  INSERT INTO public.project_substages (
    stage_id,
    project_id,
    substage_number,
    name,
    status
  )
  VALUES (
    p_stage,
    v_stage.project_id,
    v_next,
    v_name,
    CASE WHEN v_stage.status IN ('active', 'pending_review') THEN 'pending' ELSE 'locked' END
  )
  RETURNING * INTO v_row;

  PERFORM public.log_activity(
    v_stage.project_id,
    'substage.added',
    'project_stage',
    p_stage,
    v_uid,
    jsonb_build_object(
      'stage_id', p_stage,
      'substage_id', v_row.id,
      'stage_number', v_stage.stage_number,
      'substage_number', v_row.substage_number,
      'name', v_name
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.add_project_substage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_project_substage(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
