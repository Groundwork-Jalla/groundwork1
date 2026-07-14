-- =========================================================
-- 008_tier_rename.sql
-- Rename tier values:
--   starter    → self_verify
--   pro        → jalla_verify
--   enterprise → enterprise_custom
-- =========================================================

-- 1. Loosen CHECK constraint to accept both old and new values during backfill
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_tier_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_tier_check CHECK (
  tier IN ('starter', 'pro', 'enterprise', 'self_verify', 'jalla_verify', 'enterprise_custom', 'jalla_management')
);

-- 2. Backfill existing projects (safe to run multiple times — WHERE guards idempotency)
UPDATE public.projects SET tier = 'self_verify'      WHERE tier = 'starter';
UPDATE public.projects SET tier = 'jalla_verify'     WHERE tier = 'pro';
UPDATE public.projects SET tier = 'enterprise_custom' WHERE tier IN ('enterprise', 'jalla_management');

-- NOTE: We intentionally keep the constraint accepting BOTH old and new values.
-- The code already maps new names → old DB values (TIER_DB_MAP in projects.ts)
-- so no constraint tightening is needed here. A future migration can drop the
-- old values once all environments are confirmed migrated.

-- 3. Update project cap trigger (accepts both 'starter' and 'self_verify')
CREATE OR REPLACE FUNCTION public.check_starter_project_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.tier IN ('self_verify', 'starter') THEN
    IF (
      SELECT COUNT(*) FROM public.projects
      WHERE user_id = NEW.user_id
        AND tier IN ('self_verify', 'starter')
        AND status != 'archived'
    ) >= 3 THEN
      RAISE EXCEPTION 'self_verify_limit: Self Verify plan allows a maximum of 3 active projects.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Update contractor invite limit trigger (accepts both 'starter' and 'self_verify')
CREATE OR REPLACE FUNCTION public.enforce_contractor_invite_limit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  SELECT tier INTO v_tier FROM public.projects WHERE id = NEW.project_id;

  IF v_tier IN ('self_verify', 'starter') THEN
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

-- Drop and recreate contractor invite limit trigger with new function
DROP TRIGGER IF EXISTS enforce_contractor_invite_limit ON public.contractor_invites;
CREATE TRIGGER enforce_contractor_invite_limit
  BEFORE INSERT ON public.contractor_invites
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contractor_invite_limit_fn();
