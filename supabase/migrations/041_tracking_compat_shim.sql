-- =========================================================
-- 041_tracking_compat_shim.sql
--
-- Unbreak project creation on the deployed frontend.
--
-- ── What went wrong ──────────────────────────────────────
--
-- Migration 036 changed the shape of the start-tracking RPCs, because stage milestones
-- are now shares of the CONSTRUCTION fee rather than of the client total:
--
--   before   start_project_tracking(uuid, numeric)
--   after    start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric)
--
-- and it DROPPED the two-argument version so a stale client could not silently keep
-- pricing milestones off the total.
--
-- That is the right end state, but it is a BREAKING change for whatever frontend is
-- currently deployed. Running 036 against production before shipping the matching code
-- leaves tryjalla.com calling a function that no longer exists — which is what happened
-- on 16 Aug (403/404 on start_project_tracking at the last step of the wizard).
--
-- ── What this does ───────────────────────────────────────
--
-- Restores the two-argument version as an OVERLOAD, with its pre-036 body. PostgREST
-- resolves by the argument names in the JSON body, so both signatures coexist without
-- ambiguity: the deployed frontend sends two and gets the old behaviour, the new frontend
-- sends six and gets the new.
--
-- The old body is restored verbatim rather than reimplemented on top of the new model.
-- Projects created by the old frontend carry the OLD stage percentages
-- ([0,11,5,16,21,11,11,10,10,5], summing to 100 of the total), so total x budget_pct is
-- exactly right for them. Trying to be clever here — deriving a construction fee and
-- applying new percentages to old seeds — would produce milestones that sum to neither.
--
-- ── DELETE THIS once the new frontend is deployed ────────
--
--   DROP FUNCTION IF EXISTS public.start_project_tracking(uuid, numeric);
--
-- Leaving it in place indefinitely means a rolled-back deploy would quietly price
-- milestones off the client total again — inflating every one by the permit, professional
-- and design fees — with nothing on screen to show it happened.
--
-- ── Check what you actually have before running this ─────
--
--   SELECT p.oid::regprocedure AS signature
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE '%start_project_tracking';
--
-- Expect the 6-arg forms if 036 ran. If you see the 2-arg forms as well, this migration
-- has already been applied.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

CREATE OR REPLACE FUNCTION public.start_project_tracking(
  p_project_id   uuid,
  p_final_budget numeric
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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

  -- COALESCE, unlike the pre-036 original: `fixed_amount_usd` is NULL on everything the
  -- old frontend creates, so this is identical for them, and correct rather than wrong if
  -- a new-frontend project ever reaches this path during a rollback.
  UPDATE public.project_stages
    SET payment_milestone_usd = ROUND(
          COALESCE(fixed_amount_usd, p_final_budget * budget_pct / 100.0)
        )
    WHERE project_id = p_project_id;

  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_project_tracking(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.start_project_tracking(uuid, numeric) IS
  'COMPATIBILITY SHIM (migration 041) for frontends deployed before the 036 budget '
  'composition change. Drop once the six-argument callers are live.';

-- Same story for the admin twin, which 036 also re-signed.
CREATE OR REPLACE FUNCTION public.admin_start_project_tracking(
  p_project_id   uuid,
  p_final_budget numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or tracking already started';
  END IF;

  UPDATE public.project_stages
    SET payment_milestone_usd = ROUND(
          COALESCE(fixed_amount_usd, p_final_budget * budget_pct / 100.0)
        )
    WHERE project_id = p_project_id;

  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

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

COMMENT ON FUNCTION public.admin_start_project_tracking(uuid, numeric) IS
  'COMPATIBILITY SHIM (migration 041). Drop once the six-argument callers are live.';
