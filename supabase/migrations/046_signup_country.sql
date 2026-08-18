-- =========================================================
-- 046_signup_country.sql
--
-- `profiles.signup_country` — where the account was created, derived from the request
-- IP (Vercel's `x-vercel-ip-country`) rather than asked for.
--
-- Signup never collects a country, so `profiles.country` is NULL on every account that
-- exists and the social-proof toast had no location to show. Asking for one at signup
-- is a field on a form people already abandon; the request already carries the answer.
--
-- SEPARATE COLUMN, not a backfill of `country`. `profiles.country` is user-editable —
-- it is the country they *tell* us, shown and edited on the profile page. An IP guess
-- must never overwrite a stated fact, and the two disagree legitimately: a diaspora
-- owner in London signing up to build in Douala is exactly the customer.
--
-- Written only by the server (api/profile-geo.ts, service role) and only when NULL, so
-- it records the first observation and never drifts with travel or VPN.
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_country TEXT;

COMMENT ON COLUMN public.profiles.signup_country IS
  'ISO 3166-1 alpha-2 from the signup request IP. Server-written once. Never overwrites '
  'profiles.country, which is what the user states about themselves.';

-- ── Resolution order for the public toast ────────────────
--   1. country         — stated by the user, most trustworthy
--   2. signup_country  — observed from the IP at signup
--   3. project country — where they are building, for accounts predating both
DROP FUNCTION IF EXISTS public.recent_signups(INT);

CREATE FUNCTION public.recent_signups(max_rows INT DEFAULT 12)
RETURNS TABLE (first_name TEXT, country TEXT, joined_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    split_part(btrim(p.full_name), ' ', 1) AS first_name,
    COALESCE(
      p.country,
      p.signup_country,
      (SELECT pr.country
         FROM public.projects pr
        WHERE pr.user_id = p.id
        ORDER BY pr.created_at DESC
        LIMIT 1)
    ) AS country,
    p.created_at
  FROM public.profiles p
  WHERE p.full_name IS NOT NULL
    AND btrim(p.full_name) <> ''
  ORDER BY p.created_at DESC
  -- Clamped here, not by the caller: this is reachable by anon.
  LIMIT LEAST(GREATEST(COALESCE(max_rows, 12), 1), 30);
$$;

COMMENT ON FUNCTION public.recent_signups(INT) IS
  'Public social proof: first name, country and join date. Country resolves '
  'country -> signup_country -> project country. Anon-callable — see the note in 044.';

REVOKE ALL ON FUNCTION public.recent_signups(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recent_signups(INT) TO anon, authenticated;
