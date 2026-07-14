-- =========================================================
-- 008_tier_rename.sql
-- The projects table was created with new tier names from the start:
--   self_verify | jalla_verify | jalla_management
-- No backfill needed. This migration only updates the trigger
-- functions to use the correct tier names and adds SECURITY DEFINER.
-- =========================================================

-- Update project cap trigger
CREATE OR REPLACE FUNCTION public.check_starter_project_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.tier = 'self_verify' THEN
    IF (
      SELECT COUNT(*) FROM public.projects
      WHERE user_id = NEW.user_id
        AND tier = 'self_verify'
        AND status != 'archived'
    ) >= 3 THEN
      RAISE EXCEPTION 'self_verify_limit: Self Verify plan allows a maximum of 3 active projects.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Update contractor invite limit trigger
CREATE OR REPLACE FUNCTION public.enforce_contractor_invite_limit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  SELECT tier INTO v_tier FROM public.projects WHERE id = NEW.project_id;

  IF v_tier = 'self_verify' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.contractor_invites
    WHERE project_id = NEW.project_id
      AND status IN ('pending', 'accepted');

    IF v_count >= 1 THEN
      RAISE EXCEPTION 'self_verify_limit: Self Verify plan allows 1 contractor per project. Upgrade to Jalla Verify for unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate contractor invite limit trigger
DROP TRIGGER IF EXISTS enforce_contractor_invite_limit ON public.contractor_invites;
CREATE TRIGGER enforce_contractor_invite_limit
  BEFORE INSERT ON public.contractor_invites
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contractor_invite_limit_fn();
