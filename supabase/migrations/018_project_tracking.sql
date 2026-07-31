-- Migration 018: Pre-tracking budget verification
-- Adds a project lifecycle gate: projects stay in "planning" (tracking_started_at IS NULL)
-- until the owner confirms their final budget, at which point stage 1 activates and every
-- stage's payment_milestone_usd is re-derived from the confirmed budget.
-- Apply in Supabase SQL editor after migration 017.

-- 1. Lifecycle field ---------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tracking_started_at TIMESTAMPTZ;

-- 2. Grandfather every existing project as already-tracking -------------------
-- (so live projects don't suddenly show the "Start Tracking" gate)
UPDATE public.projects
  SET tracking_started_at = created_at
  WHERE tracking_started_at IS NULL;

-- 3. Atomic start-tracking RPC ----------------------------------------------
-- Owner-guarded + idempotent. Runs as the caller (SECURITY INVOKER) so RLS
-- still applies; the explicit user_id / tracking_started_at guards give a clean
-- error instead of a silent 0-row update.
CREATE OR REPLACE FUNCTION public.start_project_tracking(
  p_project_id  uuid,
  p_final_budget numeric
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Confirm the budget, stamp the start, flip the gate (owner-only, once)
  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found, not owned by you, or tracking already started';
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
