-- =========================================================
-- 058  Somewhere to keep the dispatch settings
--
-- Migration 056 read the webhook URL and shared secret from database settings:
--
--   ALTER DATABASE postgres SET app.agent_dispatch_url = '...';
--
-- That does not work on Supabase. Setting a custom parameter at database level requires
-- superuser, and the dashboard role is not one:
--
--   ERROR: 42501: permission denied to set parameter "app.agent_dispatch_url"
--
-- So the settings live in a table instead. A table is arguably the better home anyway —
-- it is versioned, readable, and changing a value is an UPDATE rather than a privileged
-- command plus a reconnect.
--
-- WHY IT IS SAFE TO PUT A SECRET HERE. RLS is on and there are NO POLICIES, which in
-- Postgres means every ordinary role is denied — anon, authenticated, and admins alike.
-- The only readers are SECURITY DEFINER functions (which run as the owner and bypass
-- RLS) and service_role, which can already read everything. Nothing reachable from the
-- browser can see this table, including with a valid admin session.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies. See the note above.

REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.app_config IS
  'Server-side settings read only by SECURITY DEFINER functions. RLS is on with no '
  'policies, so nothing reachable from the browser can read it. Used for the agent '
  'dispatch URL and shared secret (058), which Supabase will not let us set as '
  'database-level parameters.';


-- ── Re-point the dispatch trigger at the table ───────────
--
-- Falls back to the old database setting if one happens to exist, so a self-hosted
-- Postgres where ALTER DATABASE *is* permitted keeps working without a second path.
CREATE OR REPLACE FUNCTION public.notify_agent_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  endpoint TEXT;
  secret   TEXT;
BEGIN
  SELECT value INTO endpoint FROM public.app_config WHERE key = 'agent_dispatch_url';
  SELECT value INTO secret   FROM public.app_config WHERE key = 'agent_dispatch_secret';

  endpoint := COALESCE(endpoint, current_setting('app.agent_dispatch_url', true));
  secret   := COALESCE(secret,   current_setting('app.agent_dispatch_secret', true));

  -- Unconfigured is a normal state, not an error: nothing should stop someone filing a
  -- request because a notification endpoint has not been set up yet.
  IF endpoint IS NULL OR endpoint = '' OR secret IS NULL OR secret = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := jsonb_build_object(
                   'Content-Type',   'application/json',
                   'x-agent-secret', secret),
      body    := jsonb_build_object('record', to_jsonb(NEW)),
      timeout_milliseconds := 4000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'agent dispatch failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agent_request() FROM PUBLIC, anon, authenticated;
