-- =========================================================
-- 064  Move the GoHighLevel settings out of Vercel
--
-- The CRM needs seven values. All seven lived in Vercel's environment, which has two
-- problems that only appear once someone other than a developer does the setup:
--
--   1. THE FREE PLAN HAS A CEILING and this project is at it. Steps 5 and 6 of
--      docs/GHL-SETUP.md — pipeline stages and the inbound webhook — need three more
--      variables that will not fit. Migration 058 hit this wall for the notification
--      secrets and solved it with a table; there is no reason the CRM should differ.
--
--   2. EVERY CHANGE NEEDS A REDEPLOY. Vercel does not apply a new value to a running
--      deployment. GHL-SETUP.md warns about this twice because it is the single most
--      common reason a tick stays a cross after someone has "already added it", and
--      rotating a leaked token should not require a deploy.
--
-- So the settings live in app_config alongside the Resend key. The code reads the table
-- first and falls back to the environment, so nothing already working stops working:
-- the three values currently set in Vercel keep being used until a row here overrides
-- them. See api/ghl/_config.ts.
--
-- Values are read only by Vercel functions holding the service role. app_config has RLS
-- on with no policies (058), so no browser session can read this table whatever role it
-- holds — and /admin/crm reports only whether each value is set and where it came from,
-- never the value itself.
-- =========================================================

-- Nothing is inserted. A row here OVERRIDES the environment, so seeding placeholders
-- would replace three working values with empty strings and take the CRM down. Paste
-- only the ones you actually want to set.

COMMENT ON TABLE public.app_config IS
  'Server-side settings read only by SECURITY DEFINER functions and by Vercel functions '
  'holding the service role. RLS is on with no policies, so nothing reachable from the '
  'browser can read it. Holds the Resend key and notification inbox (058/059) and the '
  'GoHighLevel settings (064).';


-- ── How to set one ───────────────────────────────────────
--
-- Uncomment the line you need, replace the value, and run it. Re-running is safe: the
-- ON CONFLICT updates in place rather than failing.
--
-- Takes effect within a minute — the app caches these for 60 seconds. No redeploy.
--
-- The keys, and which step of docs/GHL-SETUP.md each belongs to:
--
--   ghl_api_token               Step 3   the Private Integration Token (pit-...)
--   ghl_location_id             Step 3   the sub-account id
--   ghl_event_webhook_url       Step 1   lifecycle events (signups, projects, billing)
--   ghl_contractor_webhook_url  —        contractor applications, predates the rest
--   ghl_pipeline_id             Step 5   the pipeline to move contacts through
--   ghl_stage_map               Step 5   JSON: {"user_signup":"stg_1", ...}
--   ghl_inbound_secret          Step 6   shared header for GHL talking back
--
-- INSERT INTO public.app_config (key, value) VALUES
--   ('ghl_pipeline_id', 'PASTE_THE_PIPELINE_ID')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- INSERT INTO public.app_config (key, value) VALUES
--   ('ghl_stage_map', '{"user_signup":"STAGE_ID","application_decision:accepted":"STAGE_ID"}')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- INSERT INTO public.app_config (key, value) VALUES
--   ('ghl_inbound_secret', 'PASTE_A_LONG_RANDOM_STRING')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- ── What is set right now ────────────────────────────────
-- Run this any time. It never prints a secret, only its length — which is what actually
-- distinguishes "not set" from "set to the wrong thing".
--
--   SELECT key,
--          length(value) AS chars,
--          updated_at
--     FROM public.app_config
--    WHERE key LIKE 'ghl%'
--    ORDER BY key;


-- ── Added 2 Sep 2026: the legacy contractor webhook ──────
--
-- Every contractor application used to POST the legacy webhook AND run the API sync.
-- Philip's workflow creates a contact from the fields it maps — without the email, so
-- GHL cannot dedupe it, and with a raw phone that GHL stamps `+1` because the
-- sub-account is registered in Maryland. The API then creates the real record. Two
-- contacts per contractor, and the `+1` half is unreachable: a Cameroonian mobile
-- wearing a US country code belongs to a stranger.
--
--   ghl_contractor_webhook_mode
--     'fallback'  API first; webhook only if the API sync fails.  ← default, no row needed
--     'off'       API only. The end state, once Philip's workflow is rebuilt on the
--                 `groundwork:applied` tag trigger instead of the webhook.
--     'always'    both, every time. The old behaviour. Restores the duplicates.
--
-- INSERT INTO public.app_config (key, value) VALUES
--   ('ghl_contractor_webhook_mode', 'off')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
