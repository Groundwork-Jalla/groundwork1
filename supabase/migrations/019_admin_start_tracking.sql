-- Migration 019: Admin-confirmed budget + start tracking (Jalla Management)
-- Jalla Management projects are gated like every other project, but the owner
-- cannot confirm their own budget — a Jalla admin sets it on their behalf.
-- Mirrors start_project_tracking (018) but guarded by is_admin() instead of the
-- owner check, and runs SECURITY DEFINER because admins have no UPDATE grant on
-- projects (see 009_admin.sql: admins get SELECT only).
-- Apply in Supabase SQL editor after migration 018.

CREATE OR REPLACE FUNCTION public.admin_start_project_tracking(
  p_project_id   uuid,
  p_final_budget numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only platform admins may run this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Confirm the budget, stamp the start, flip the gate (once)
  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or tracking already started';
  END IF;

  -- Re-derive every stage milestone from the confirmed budget
  UPDATE public.project_stages
    SET payment_milestone_usd = ROUND(p_final_budget * budget_pct / 100.0)
    WHERE project_id = p_project_id;

  -- Activate stage 1
  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  -- Promote stage 1's substages so evidence upload can begin
  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_start_project_tracking(uuid, numeric) TO authenticated;
