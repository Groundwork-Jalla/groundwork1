-- =========================================================
-- 042_fix_tracking_execute.sql
--
-- Fix `permission denied for function apply_budget_milestones (42501)` when an owner
-- confirms their budget at the last step of the wizard.
--
-- ── The mistake ──────────────────────────────────────────
--
-- Migration 036 factored the milestone arithmetic into a shared helper,
-- `apply_budget_milestones()`, called by both start-tracking RPCs. It then locked the
-- helper down:
--
--     REVOKE ALL ON FUNCTION public.apply_budget_milestones(...) FROM PUBLIC, anon, authenticated;
--
-- with a comment claiming the grant reaches it "through the two callers' definer
-- context". That is true of exactly one of the two callers.
--
--   admin_start_project_tracking   SECURITY DEFINER  -> runs as owner  -> works
--   start_project_tracking         SECURITY INVOKER  -> runs as caller -> 42501
--
-- 018 made the owner-facing RPC SECURITY INVOKER deliberately, so RLS still applies to
-- everything it touches. Running as `authenticated`, it cannot execute a function
-- `authenticated` has no EXECUTE on. Every client hit this; only the admin path worked.
--
-- ── Why not simply grant EXECUTE to authenticated ────────
--
-- Because `apply_budget_milestones` is SECURITY DEFINER and performs no authorisation of
-- its own — it takes a project_id and rewrites that project's milestones and fees. Handing
-- it to every signed-in user would let anyone rewrite the payment schedule of any project
-- in the system by passing someone else's id. That is a straight privilege escalation on
-- the money path, and a worse bug than the one being fixed.
--
-- ── The fix ──────────────────────────────────────────────
--
-- Make the owner-facing RPC SECURITY DEFINER as well, and leave the helper unreachable
-- from any client role.
--
-- Losing SECURITY INVOKER costs nothing here, because this function never relied on RLS
-- for authorisation — it has always carried the check explicitly:
--
--     WHERE id = p_project_id AND user_id = auth.uid() AND tracking_started_at IS NULL
--     IF NOT FOUND THEN RAISE EXCEPTION ...
--
-- A caller who does not own the project raises before a single milestone is written, and
-- the whole thing is one transaction. That guard is doing the work RLS was there to do,
-- which is why 018 wrote it in the first place — for a clean error instead of a silent
-- zero-row update.
--
-- `SET search_path = public` is added because a SECURITY DEFINER function without one is
-- how search_path hijacking works.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

CREATE OR REPLACE FUNCTION public.start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ownership is enforced HERE, not by RLS. Nothing below runs unless this matches, and
  -- the whole function is one transaction.
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

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee, p_professional_fee
  );

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

GRANT EXECUTE ON FUNCTION public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated;

COMMENT ON FUNCTION public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric) IS
  'Confirm a budget and begin tracking. SECURITY DEFINER so it can reach '
  'apply_budget_milestones(); ownership is enforced by the explicit user_id = auth.uid() '
  'guard rather than by RLS.';

-- Restate the lockdown, so this file is the whole story if anyone reads it alone.
-- The helper stays unreachable from client roles; both callers are DEFINER and own it.
REVOKE ALL ON FUNCTION public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
