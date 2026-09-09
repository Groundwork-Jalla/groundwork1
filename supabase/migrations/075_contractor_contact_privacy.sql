-- =========================================================
-- 075  Contractor contact details are a server-side entitlement
--
-- WHAT WAS WRONG
--
-- `contractors` holds every directory entry's `phone` and `email`, and 033 granted:
--
--   CREATE POLICY "anyone_reads_active_contractors"
--     ON public.contractors FOR SELECT TO anon, authenticated USING (active);
--
-- RLS is ROW-level. That policy hands every COLUMN of every active row to anyone who
-- asks, and `anon` needs no account at all — the anon key ships inside the browser
-- bundle. So all 33 contractors' phone numbers and email addresses were readable by
-- anybody, with one HTTP request.
--
-- The product does not intend that. `routes/contractors.tsx` puts the directory behind
-- Jalla Verify and puts contact details behind a second check on top. Both gates are
-- React. Neither is a boundary.
--
-- The second gate was also broken, in a way that hid the first. It read:
--
--   const rawTier = user?.user_metadata?.tier ?? 'starter';        // client-writable
--   const isUnlocked = plan === 'pro' || plan === 'enterprise';    // dead vocabulary
--
-- Nothing writes 'pro' or 'enterprise' any more — onboarding writes 'self_verify', and
-- the tiers are self_verify / jalla_verify / jalla_management. So `isUnlocked` was false
-- for EVERY user including paying ones: subscribers never saw a phone number in the UI,
-- while anyone at all could read them from the API. The worst way round.
--
-- HOW IT IS FIXED
--
-- Column privileges, which RLS cannot express. `phone` and `email` come out of the
-- table grant entirely and are served by a SECURITY DEFINER function that checks
-- `profiles.subscription_tier` — the column only the Stripe webhook can write (021).
--
-- NOBODY OUTSIDE THE TEAM GETS THEM
--
-- Product rule, 9 Sep 2026: every form of contact happens inside Groundwork. A homeowner
-- never receives a contractor's phone number or email, on any tier — handing those over
-- is what moves the relationship off the platform, and a paid tier that does it is worse
-- than a free one that does not.
--
-- So `phone` and `email` are staff-only. They leave the browser grant entirely and the
-- only thing that reads them is the admin list. Homeowners reach a contractor through
-- `contractor_inquiries` (migration 076), which the team brokers.
-- =========================================================

-- ── 1. Harden is_admin ───────────────────────────────────
--
-- 066 gave every SECURITY DEFINER a fixed search_path and missed this one, which is the
-- function the whole admin surface is built on. Its body is already fully qualified so
-- the behaviour does not change; this closes the shape of the hazard rather than a bug.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
$$;

-- ── 2. Take phone and email out of the table grant ───────
--
-- Postgres has no "revoke these two columns" when the role holds table-level SELECT: the
-- table grant has to go, and the readable columns come back one by one.
--
-- ⚠ MAINTENANCE: a column added to `contractors` after this is NOT readable by the app
-- until it is added to the GRANT below. That is the cost of column-level privileges, and
-- it fails loudly (a 42501 on the select) rather than by leaking.
REVOKE SELECT ON public.contractors FROM anon, authenticated;

GRANT SELECT (
  id, name, trade, location, rating, review_count, verified, years_exp,
  completed_projects, specialties, bio, avatar_initials, active, created_at,
  application_id
) ON public.contractors TO anon, authenticated;

-- ── 3. Who may approach a contractor at all ──────────────
--
-- Not "who may see a phone number" — nobody may. This is the gate on filing an inquiry
-- through `contractor_inquiries` (076), and on seeing the directory in the first place.
-- Tier comes from `profiles.subscription_tier`, which only the Stripe webhook writes
-- (021), never from user metadata, which the browser can set on itself.
CREATE OR REPLACE FUNCTION public.contractor_directory_entitled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.subscription_tier IN ('jalla_verify', 'jalla_management')
  )
$$;

GRANT EXECUTE ON FUNCTION public.contractor_directory_entitled() TO authenticated;

-- ── 4. The admin list ────────────────────────────────────
--
-- /admin/contractors reads email and phone for every entry, active or not. Column
-- privileges are not RLS: revoking from `authenticated` revokes from admins too, since
-- an admin is an authenticated user. So the admin path gets its own definer function
-- rather than a grant that would reopen the hole for everyone.
CREATE OR REPLACE FUNCTION public.admin_list_contractors()
RETURNS SETOF public.contractors
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.contractors ORDER BY created_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_list_contractors() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_contractors() TO authenticated;

COMMENT ON FUNCTION public.admin_list_contractors() IS
  'Every directory entry including phone and email, for the admin surface only. Those two '
  'columns are readable nowhere else: they are outside the browser grant, and no homeowner '
  'receives them on any tier. Introductions go through contractor_inquiries (076).';
