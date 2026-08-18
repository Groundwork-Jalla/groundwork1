-- =========================================================
-- 044_recent_signups.sql
--
-- `recent_signups()` — the handful of rows the landing page's social-proof toast
-- shows. It replaced a hardcoded list of invented names ("Sarah from Lagos"), which
-- is a strange thing for a product whose promise is verified, accountable records.
--
-- A function rather than a view because `profiles` is RLS-protected and the visitor
-- reading this is signed out. SECURITY DEFINER lets exactly this projection past the
-- policy without granting anon any access to the table itself.
--
-- WHAT IS EXPOSED, and why it is the minimum that answers the question:
--   * first name only — `split_part(full_name, ' ', 1)`, so surnames never leave the row
--   * country, not city — enough for "from Cameroon", not enough to locate anyone
--   * no id, no email, no phone, no avatar, no timestamp
-- Anyone can call this anonymously and page through the most recent signups, so treat
-- the projection as public and add nothing to it without deciding that again.
--
-- Rows are capped and windowed: the toast claims "joined just now", and a signup from
-- last quarter would make that a lie. Outside the window the toast shows nothing at
-- all, which is the honest failure mode for an empty product.
-- =========================================================

CREATE OR REPLACE FUNCTION public.recent_signups(max_rows INT DEFAULT 8)
RETURNS TABLE (first_name TEXT, country TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    split_part(btrim(p.full_name), ' ', 1) AS first_name,
    p.country
  FROM public.profiles p
  WHERE p.full_name IS NOT NULL
    AND btrim(p.full_name) <> ''
    AND p.country IS NOT NULL
    AND p.created_at > now() - INTERVAL '30 days'
  ORDER BY p.created_at DESC
  -- Clamped here, not by the caller: this is reachable by anon.
  LIMIT LEAST(GREATEST(COALESCE(max_rows, 8), 1), 20);
$$;

COMMENT ON FUNCTION public.recent_signups(INT) IS
  'Public social proof: first name + country of recent signups. Anon-callable by '
  'design — never widen the projection without re-reading the note in 044.';

REVOKE ALL ON FUNCTION public.recent_signups(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recent_signups(INT) TO anon, authenticated;
