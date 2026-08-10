-- =========================================================
-- 031_admin_read_waitlist.sql
--
-- Let admins read the waitlist.
--
-- `waitlist_emails` (002_waitlist.sql) has RLS enabled with a single INSERT policy —
-- "Anyone can join the waitlist". There has never been a SELECT policy, so the table
-- is write-only to every client, admins included: an admin query returns zero rows
-- rather than an error, which is why the backfill query documented in 023 could only
-- ever be run from the SQL editor.
--
-- `waitlist_members` (name + location, the public social-proof feed) already has a
-- public SELECT policy and is deliberately left alone.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

-- Emails are personal data. Admin-only, mirroring contractor_applications (026).
DROP POLICY IF EXISTS "admins_read_waitlist" ON public.waitlist_emails;
CREATE POLICY "admins_read_waitlist"
  ON public.waitlist_emails FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Deliberately no UPDATE or DELETE policy. `synced_to_ghl` is written by the service
-- role from api/ghl/waitlist.ts and must not be settable from a browser session —
-- flipping it by hand would hide a lead from the backfill query permanently.

DO $$
DECLARE
  v_total    INTEGER;
  v_unsynced INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT synced_to_ghl)
    INTO v_total, v_unsynced
  FROM public.waitlist_emails;

  RAISE NOTICE 'waitlist_emails: % total, % never forwarded to GHL.', v_total, v_unsynced;
END $$;
