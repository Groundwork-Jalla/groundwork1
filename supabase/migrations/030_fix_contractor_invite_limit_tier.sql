-- =========================================================
-- 030_fix_contractor_invite_limit_tier.sql
--
-- The one-contractor cap on the free plan has never been enforced.
--
-- `check_contractor_invite_limit()` (20260714000000_contractor_access.sql) gates on
-- `v_tier = 'starter'`, but the free tier was renamed to `self_verify` and no project
-- carries 'starter' any more — so the branch never runs and free-plan projects can
-- invite unlimited contractors.
--
-- The client has been ready for this: src/lib/supabase/invites.ts already matches
-- both 'starter_limit' and 'self_verify_limit' on the raised message. Only the
-- trigger lagged.
--
-- 'starter' is kept in the check so that any legacy row still carrying the old value
-- stays capped rather than silently becoming unlimited.
-- =========================================================

CREATE OR REPLACE FUNCTION public.check_contractor_invite_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier         TEXT;
  v_invite_count INTEGER;
BEGIN
  SELECT tier INTO v_tier
  FROM public.projects
  WHERE id = NEW.project_id;

  IF v_tier IN ('self_verify', 'starter') THEN
    SELECT COUNT(*) INTO v_invite_count
    FROM public.contractor_invites
    WHERE project_id = NEW.project_id
      AND status IN ('pending', 'accepted');

    IF v_invite_count >= 1 THEN
      -- The prefix is the contract with the client, which swaps in a translated
      -- message; the English text after it is a fallback for direct SQL callers.
      RAISE EXCEPTION 'self_verify_limit: Self Verify allows 1 contractor per project. Upgrade to Jalla Verify for unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged, but recreate it so a database that somehow lost it
-- during an earlier partial run ends up in the same state as a fresh one.
DROP TRIGGER IF EXISTS enforce_contractor_invite_limit ON public.contractor_invites;
CREATE TRIGGER enforce_contractor_invite_limit
  BEFORE INSERT ON public.contractor_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.check_contractor_invite_limit();

-- Report any project that is already over the cap. Existing rows are left alone —
-- revoking a contractor someone is actively working with would be worse than the
-- overage — but you should know they exist before support hears about it.
DO $$
DECLARE
  v_over INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_over
  FROM (
    SELECT ci.project_id
    FROM public.contractor_invites ci
    JOIN public.projects p ON p.id = ci.project_id
    WHERE p.tier IN ('self_verify', 'starter')
      AND ci.status IN ('pending', 'accepted')
    GROUP BY ci.project_id
    HAVING COUNT(*) > 1
  ) AS over_cap;

  IF v_over > 0 THEN
    RAISE NOTICE '% free-plan project(s) already exceed the 1-contractor cap. Existing invites are untouched; new ones are now blocked.', v_over;
  END IF;
END $$;
