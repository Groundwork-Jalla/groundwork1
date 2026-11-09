-- =========================================================
-- 180  The directory is admin-curated, not subscription-gated
--
-- WHY
--
-- Favour, 9 Nov 2026: "The contractor directory should not be gated by subscription, at
-- least for now… it is only admin that can unlock it — when the admin publishes, it goes
-- to the contractor directory. We want everything relating to the subscription removed,
-- because we have a different plan on how to generate revenue."
--
-- Two separate questions were answered with one mechanism, and that is the bug:
--
--   WHAT is in the directory   →  what an admin published. `contractors.active`, set by
--                                 `admin_promote_application` (033). This is the gate,
--                                 and it stays exactly as it is.
--   WHO may see it             →  was `subscription_tier IN (jalla_verify,
--                                 jalla_management)` (075). That is the subscription,
--                                 and it goes.
--
-- ── What this also repairs ───────────────────────────────────────────────────────────
-- The free-access migration dated today dropped `anyone_reads_active_contractors` and
-- redefined `contractor_directory_entitled()` as `is_admin()`. Together those close the
-- directory to everybody except staff: no client can list a contractor, and no client can
-- send an inquiry (076 gates INSERT on the same function). Under "free access" the
-- directory should open, not shut. This is forward-only and restores 033's read while
-- keeping 075's column-level privacy, rather than editing an unapplied file.
--
-- ── What is deliberately NOT changed ─────────────────────────────────────────────────
-- 075 keeps `phone` and `email` out of the anon/authenticated grant, so a listing is a
-- listing and contact details still come from the entitled path. Opening the directory is
-- not the same as publishing everybody's phone number.
--
-- Run in: Supabase Dashboard > SQL Editor (after the free-access migration, if that ran)
-- =========================================================

BEGIN;

-- ── 1. Anyone signed in may see what an admin published ──
--
-- 033's policy verbatim: SELECT on the rows an admin has made `active`. Restored because
-- today's free-access migration dropped it without a replacement.
DROP POLICY IF EXISTS "anyone_reads_active_contractors" ON public.contractors;
CREATE POLICY "anyone_reads_active_contractors"
  ON public.contractors FOR SELECT
  TO anon, authenticated
  USING (active);

-- ── 2. Entitlement is no longer a subscription ───────────
--
-- Kept as a FUNCTION rather than deleted: 076 gates inquiry INSERT on it, and 075's
-- contact-detail path reads it. Removing it would mean rewriting both policies to say
-- `true`, and the day a different entitlement rule arrives — which it will, under the new
-- revenue plan — this is the one place that has to change.
--
-- `auth.uid() IS NOT NULL` rather than a bare `true`: anon may READ a listing (policy
-- above) but may not act as an entitled party, so an inquiry still needs an account.
CREATE OR REPLACE FUNCTION public.contractor_directory_entitled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
$$;

REVOKE ALL     ON FUNCTION public.contractor_directory_entitled() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contractor_directory_entitled() TO authenticated;

COMMENT ON FUNCTION public.contractor_directory_entitled() IS
  'May this caller use the contractor directory? Any signed-in account, while access is '
  'free (180). NOT a subscription check any more, and never a check on WHAT is listed — '
  'that is contractors.active, set when an admin publishes an application (033).';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
SELECT 'read policy restored (expect 1)' AS what, count(*)::text AS n
  FROM pg_policies
 WHERE tablename = 'contractors' AND policyname = 'anyone_reads_active_contractors'
UNION ALL
SELECT 'entitlement no longer reads subscription_tier (expect 0)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'contractor_directory_entitled'
   AND pg_get_functiondef(p.oid) LIKE '%subscription_tier%'
UNION ALL
SELECT 'entitlement is not admin-only (expect 0)', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'contractor_directory_entitled'
   AND pg_get_functiondef(p.oid) LIKE '%is_admin%'
UNION ALL
SELECT 'published contractors visible', count(*)::text
  FROM public.contractors WHERE active;
