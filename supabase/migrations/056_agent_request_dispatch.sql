-- =========================================================
-- 056  Fire the agent runner when a request is filed
--
-- INSERT on agent_requests -> POST /api/agent-dispatch -> GitHub repository_dispatch
-- -> .github/workflows/agent-request.yml, which plans, records, checks and delivers.
--
-- BEFORE THIS, NOTHING RAN. Requests were filed and sat as 'new' until somebody
-- remembered to drain the queue by hand. Two briefs went six hours unanswered that way,
-- which is the whole reason this exists.
--
-- TWO SECRETS, AND NEITHER IS IN THIS FILE. They are read from database settings, which
-- are set out of band (below). A committed migration is the wrong place for a key, and
-- a rotated key should not need a migration.
--
--   ALTER DATABASE postgres SET app.agent_dispatch_url =
--     'https://tryjalla.com/api/agent-dispatch';
--   ALTER DATABASE postgres SET app.agent_dispatch_secret = '<same as AGENT_DISPATCH_SECRET on Vercel>';
--
-- Then reconnect, because database settings apply to new sessions.
--
-- THIS IS BEST-EFFORT BY DESIGN. The workflow also runs on a schedule and collects
-- anything still pending, so a failed POST delays a request by up to fifteen minutes
-- rather than losing it. That is why the trigger swallows its own errors: a webhook
-- that cannot reach the internet must never stop someone filing a brief.
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_agent_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  endpoint TEXT := current_setting('app.agent_dispatch_url', true);
  secret   TEXT := current_setting('app.agent_dispatch_secret', true);
BEGIN
  -- Unconfigured is a normal state, not an error: the scheduled run still collects it.
  IF endpoint IS NULL OR endpoint = '' OR secret IS NULL OR secret = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := jsonb_build_object(
                   'Content-Type',   'application/json',
                   'x-agent-secret', secret),
      body    := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
      timeout_milliseconds := 4000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let the notification break the insert. Someone filing a brief must not see
    -- an error because a build server is unreachable.
    RAISE WARNING 'agent dispatch failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_requests_dispatch ON public.agent_requests;
CREATE TRIGGER agent_requests_dispatch
  AFTER INSERT ON public.agent_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_request();

REVOKE ALL ON FUNCTION public.notify_agent_request() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notify_agent_request() IS
  'Pings /api/agent-dispatch so GitHub Actions produces the request. Best-effort: the '
  'workflow also runs on a schedule, so a failed ping delays work rather than losing it.';
