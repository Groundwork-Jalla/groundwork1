-- =========================================================
-- 049_profiles_ghl_sync.sql
--
-- Record which people have reached the CRM.
--
-- GoHighLevel has only ever heard about contractors. Not one homeowner or client has
-- ever been forwarded, which is the visibility gap raised in the 20 August meeting —
-- total, not partial. Phase 1 of the CRM plan sends them, and this is the bookkeeping
-- that makes the sending checkable.
--
-- Deliberately identical in shape to contractor_applications.synced_to_ghl /
-- synced_to_ghl_at (migration 026) and waitlist_emails (023). One idea, one spelling:
-- an admin screen or a backfill query written against one table works on the others.
--
-- The push is fire-and-forget by design — a CRM outage must never make a signup fail —
-- so without a column recording it, a silent miss is unfindable. That is exactly how the
-- email outage went unnoticed for a month.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 048)
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS synced_to_ghl    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synced_to_ghl_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.synced_to_ghl IS
  'True once this person has been forwarded to GoHighLevel. Written only by '
  'api/ghl/user.ts with the service role — never by the browser.';

-- Finding the ones that missed is the point, so keep that query cheap. Partial index:
-- once the backlog is worked through this costs almost nothing to maintain.
CREATE INDEX IF NOT EXISTS profiles_unsynced_ghl_idx
  ON public.profiles (created_at DESC)
  WHERE synced_to_ghl = false;

-- Not client-writable. There is no UPDATE policy granting these columns to anyone, and
-- the guard below stops a self-profile update from claiming a sync that never happened —
-- the same reasoning as guard_profile_email() in migration 025.
CREATE OR REPLACE FUNCTION public.guard_profile_ghl_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.synced_to_ghl IS DISTINCT FROM OLD.synced_to_ghl
     OR NEW.synced_to_ghl_at IS DISTINCT FROM OLD.synced_to_ghl_at THEN
    -- service_role is the server; anyone else is a browser and may not touch these.
    IF coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') <> 'service_role' THEN
      NEW.synced_to_ghl    := OLD.synced_to_ghl;
      NEW.synced_to_ghl_at := OLD.synced_to_ghl_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_ghl_sync ON public.profiles;
CREATE TRIGGER trg_guard_profile_ghl_sync
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_ghl_sync();

-- Who has not reached the CRM:
--   SELECT id, full_name, email, created_at
--     FROM public.profiles
--    WHERE synced_to_ghl = false
--    ORDER BY created_at;
