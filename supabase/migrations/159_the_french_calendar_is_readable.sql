-- =========================================================
-- 159 — The French booking schedule, and the allowlist that guards it
--
-- Philip has made the qualification call two schedules instead of one:
--
--   English  Philip alone
--   French   Philip, with Vanessa as co-host
--
-- This is the shape Google forces. A co-host sits on the SCHEDULE, not on a booking, so
-- "Vanessa for French speakers" cannot be said on one calendar — she would join every
-- call or none. Two schedules is the only way to express it.
--
-- ── The part that would have failed silently ────────────────────────────────────────
-- 134's `public_setting` is not a generic reader. Its allowlist is a single literal key,
-- and that test is the whole protection: `app_config` also holds the Resend key and the
-- fan-out secret, and the function is callable by any signed-in user.
--
-- So adding a row for the French schedule is not enough. Without this migration the
-- lookup returns NULL, the booking code falls back to the English calendar, and every
-- French applicant is quietly offered the call without Vanessa in it. No error, no
-- empty frame — the feature would simply not be doing anything.
--
-- The allowlist stays a closed list of literals rather than becoming a pattern like
-- `key LIKE 'booking_%'`. A pattern is a rule about names; this is a decision about
-- which specific values are safe to hand to the browser, and it should keep reading
-- like one.
--
-- Run in: Supabase Dashboard > SQL Editor (after 158)
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.public_setting(p_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM public.app_config
   WHERE key = p_key
     -- The allowlist IS the security boundary. Without it this function would read the
     -- Resend key and the fan-out secret for anybody who asked.
     AND key IN ('booking_schedule_philip', 'booking_schedule_fr');
$$;

REVOKE ALL ON FUNCTION public.public_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_setting(text) TO authenticated;

COMMENT ON FUNCTION public.public_setting(text) IS
  'Reads one of a closed list of non-secret settings out of app_config (134; the French '
  'booking schedule added in 159). The key test is the whole protection: app_config also '
  'holds API keys, and this function is callable by any signed-in user.';

-- The French schedule itself. A row, not a constant, so changing the calendar is a SQL
-- statement rather than a redeploy — the same reasoning as the English one.
INSERT INTO public.app_config (key, value)
VALUES ('booking_schedule_fr',
        'AcZssZ2WIMjycH6UT17ZOMu2LujhkjpREeSSmt3y6j6YBP6suaBrS5gvBjIsldtUa8oMCeHAcmCNfV3S')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   Both schedules read, and nothing else does:
--     SELECT public.public_setting('booking_schedule_philip');  -- the English id
--     SELECT public.public_setting('booking_schedule_fr');      -- the French id
--     SELECT public.public_setting('resend_api_key');           -- MUST be null
--     SELECT public.public_setting('ghl_api_token');            -- MUST be null
