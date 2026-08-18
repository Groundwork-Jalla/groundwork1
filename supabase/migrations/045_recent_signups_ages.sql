-- =========================================================
-- 045_recent_signups_ages.sql
--
-- Replaces `recent_signups()` from 044 so the landing-page toast can say how long ago
-- someone joined, rather than only showing people who joined in the last 30 days.
--
-- 044 windowed to 30 days because the toast asserted "joined just now" and an older
-- signup would have made that a lie. The toast now states the real age — "Neo joined
-- 79 days ago" — so the window is no longer protecting anything, and it was hiding the
-- entire user base from a page whose job is to show that people are here. Returning
-- `joined_at` moves that decision to the caller, which can now be truthful either way.
--
-- DROP then CREATE: the return type changes, and CREATE OR REPLACE cannot do that.
--
-- The projection is unchanged in kind and still anon-callable — first name only, country
-- not city, no id, no email, no phone. `joined_at` is the one addition; it is already
-- implied by the ordering, and it is the account's age, not activity. Re-read the note
-- in 044 before widening this any further.
-- =========================================================

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
    p.country,
    p.created_at
  FROM public.profiles p
  WHERE p.full_name IS NOT NULL
    AND btrim(p.full_name) <> ''
  ORDER BY p.created_at DESC
  -- Clamped here, not by the caller: this is reachable by anon.
  LIMIT LEAST(GREATEST(COALESCE(max_rows, 12), 1), 30);
$$;

COMMENT ON FUNCTION public.recent_signups(INT) IS
  'Public social proof: first name, country and join date of recent signups. '
  'Anon-callable by design — never widen the projection without re-reading 044.';

REVOKE ALL ON FUNCTION public.recent_signups(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recent_signups(INT) TO anon, authenticated;
