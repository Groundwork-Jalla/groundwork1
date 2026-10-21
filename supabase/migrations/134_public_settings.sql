-- =========================================================
-- 134  A few settings the app itself may read
--
-- WHY
--
-- `app_config` (058) is deliberately unreadable: RLS on, no policies, so every ordinary
-- role is denied and only SECURITY DEFINER functions and service_role can see it. That
-- is right — it holds API keys and the fan-out secret.
--
-- The booking schedules are not secrets. They are the ids in a Google appointment link
-- that gets handed to the applicant anyway, and the browser needs them to render the
-- booking frame. Rather than weaken the table, this exposes a NAMED, CLOSED LIST of
-- keys through one function, so a new row in `app_config` cannot accidentally become
-- public by sitting in the wrong table.
--
-- Run in: Supabase Dashboard > SQL Editor (after 133)
--
-- ── Not SQL, and booking does nothing without it ────────────────────────────────────
--   INSERT INTO public.app_config (key, value) VALUES
--     ('booking_schedule_philip', '<Philip''s Google schedule id>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- The id is the long string in the appointment-schedule link, between `/schedules/` and
-- any `?` — a `calendar.app.google/…` short link redirects to it. Until the row exists
-- the booking step tells the applicant Jalla will be in touch, rather than showing an
-- empty frame.
--
-- ONE schedule, deliberately. Everyone books Philip; a French-speaking applicant means
-- Vanessa is asked to join that same call, which is a notification Groundwork sends and
-- not a second calendar.
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.public_setting(p_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM public.app_config
   WHERE key = p_key
     -- The allowlist IS the security boundary. Without it this function would read the
     -- Resend key and the fan-out secret for anybody who asked.
     AND key = 'booking_schedule_philip';
$$;

REVOKE ALL ON FUNCTION public.public_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_setting(text) TO authenticated;

COMMENT ON FUNCTION public.public_setting(text) IS
  'Reads one of a closed list of non-secret settings out of app_config (134). The key '
  'test is the whole protection: app_config also holds API keys, and this function is '
  'callable by any signed-in user.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT public.public_setting('booking_schedule_philip');   -- the id, once set
--   SELECT public.public_setting('resend_api_key');            -- MUST be null
