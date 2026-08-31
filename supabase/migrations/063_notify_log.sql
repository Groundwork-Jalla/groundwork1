-- =========================================================
-- 063  Make the notification trigger say what it did
--
-- 059 sends the request email from the database. When it stopped arriving there was no
-- way to find out why, because the function catches every error and writes it to a
-- server log nobody can read:
--
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'agent request email failed for %: %', NEW.id, SQLERRM;
--
-- A notification must never block someone filing a request, so swallowing the error is
-- right. Swallowing it *silently* is not. This migration keeps the first property and
-- drops the second: every firing writes a row saying what it read, what it sent, and
-- what went wrong. An empty log after filing a request now means something specific —
-- the trigger never ran — instead of meaning nothing at all.
--
-- Secrets are never logged, only their length, which is what you actually need in order
-- to tell "not configured" from "configured wrong".
-- =========================================================

CREATE TABLE IF NOT EXISTS public.agent_notify_log (
  id         BIGSERIAL PRIMARY KEY,
  request_id UUID,
  step       TEXT NOT NULL,
  detail     TEXT,
  net_id     BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_notify_log_created_idx
  ON public.agent_notify_log (created_at DESC);

-- Same lock as app_config (058): RLS on, no policies, so no browser session can read it
-- whatever role it holds. The rows describe when notifications fired and to which inbox,
-- which is operational detail, not something the front end has any business seeing.
ALTER TABLE public.agent_notify_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_notify_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.agent_notify_log IS
  'One row per step of notify_agent_request(). Read it in the SQL editor when a request '
  'notification does not arrive. Never contains secrets — only their length.';


CREATE OR REPLACE FUNCTION public.notify_agent_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  resend_key TEXT;
  inbox      TEXT;
  endpoint   TEXT;
  secret     TEXT;
  fmt        TEXT;
  due        TEXT;
  body_html  TEXT;
  rows_html  TEXT;
  nid        BIGINT;
BEGIN
  INSERT INTO public.agent_notify_log (request_id, step, detail)
  VALUES (NEW.id, 'fired', 'agent=' || COALESCE(NEW.agent, '?')
                        || ' format=' || COALESCE(NEW.output_format, '?'));

  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';
  SELECT value INTO endpoint   FROM public.app_config WHERE key = 'agent_dispatch_url';
  SELECT value INTO secret     FROM public.app_config WHERE key = 'agent_dispatch_secret';

  -- Lengths, not values. Enough to distinguish "the definer cannot read app_config"
  -- (NULL) from "the key is there but wrong" (a plausible length that still 401s).
  INSERT INTO public.agent_notify_log (request_id, step, detail)
  VALUES (NEW.id, 'config',
          'resend_key='  || COALESCE(length(resend_key)::text || ' chars', 'NULL') ||
          ', inbox='     || COALESCE(inbox, 'NULL') ||
          ', endpoint='  || COALESCE(length(endpoint)::text || ' chars', 'NULL') ||
          ', secret='    || COALESCE(length(secret)::text || ' chars', 'NULL'));

  fmt := CASE COALESCE(NEW.output_format, 'mp4')
           WHEN 'pptx' THEN 'deck'
           WHEN 'both' THEN 'video + deck'
           ELSE 'video' END;
  due := CASE WHEN NEW.needed_by IS NULL THEN ''
              ELSE ' — needed by ' || NEW.needed_by::text END;

  -- ── The email ──
  IF resend_key IS NULL OR resend_key = '' OR inbox IS NULL OR inbox = '' THEN
    INSERT INTO public.agent_notify_log (request_id, step, detail)
    VALUES (NEW.id, 'email_skipped', 'resend_api_key or notify_email missing from app_config');
  ELSE
    rows_html :=
      '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Who it is for</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.audience) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">So they can</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.goal) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Shown on</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.channel) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Language</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.language) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Deliver as</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || fmt || '</td></tr>'
      || CASE WHEN NEW.notes IS NULL OR NEW.notes = '' THEN '' ELSE
           '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#8a8a87;white-space:nowrap;vertical-align:top;">Notes</td>'
           || '<td style="padding:6px 0;font-size:13px;color:#0a0a0a;">' || public.html_escape(NEW.notes) || '</td></tr>' END;

    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">New agent request</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.5);">' || public.html_escape(NEW.agent) || '</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#0a0a0a;">' || public.html_escape(NEW.title) || '</p>'
      || '<table cellpadding="0" cellspacing="0">' || rows_html || '</table>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/requests" '
      || 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '<p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">Pick it up with '
      || '<code style="background:#f4f4f4;padding:1px 5px;border-radius:4px;">npm run agent:queue -- brief '
      || left(NEW.id::text, 8) || '</code></p>'
      || '</td></tr></table></body></html>';

    BEGIN
      SELECT net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',      jsonb_build_array(inbox),
                     'subject', 'New ' || fmt || ' request: ' || left(COALESCE(NEW.title,'Untitled'), 80) || due,
                     'html',    body_html),
        timeout_milliseconds := 5000)
      INTO nid;

      INSERT INTO public.agent_notify_log (request_id, step, detail, net_id)
      VALUES (NEW.id, 'email_queued', 'to ' || inbox, nid);
    EXCEPTION WHEN OTHERS THEN
      -- Never let a notification failure block someone filing a request. The row is the
      -- point; the email is a convenience. But record it, so the next failure explains
      -- itself instead of costing an afternoon.
      INSERT INTO public.agent_notify_log (request_id, step, detail)
      VALUES (NEW.id, 'email_error', SQLSTATE || ' ' || SQLERRM);
    END;
  END IF;

  -- ── The GitHub kick, only if it has been configured ──
  IF endpoint IS NOT NULL AND endpoint <> '' AND secret IS NOT NULL AND secret <> '' THEN
    BEGIN
      SELECT net.http_post(
        url     := endpoint,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-agent-secret', secret),
        body    := jsonb_build_object('record', to_jsonb(NEW)),
        timeout_milliseconds := 4000)
      INTO nid;

      INSERT INTO public.agent_notify_log (request_id, step, detail, net_id)
      VALUES (NEW.id, 'dispatch_queued', endpoint, nid);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.agent_notify_log (request_id, step, detail)
      VALUES (NEW.id, 'dispatch_error', SQLSTATE || ' ' || SQLERRM);
    END;
  END IF;

  RETURN NEW;

-- The outer net. If anything above the send blocks throws — a config read that is denied
-- rather than empty, a NULL that breaks string concatenation — the insert must still
-- succeed. Without this the trigger takes the whole request down with it.
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.agent_notify_log (request_id, step, detail)
    VALUES (NEW.id, 'fatal', SQLSTATE || ' ' || SQLERRM);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- if even the log is unwritable, the request still gets filed
  END;
  RETURN NEW;
END;
$fn$;

-- The trigger is recreated rather than assumed: 056 created it, but if it was ever
-- dropped this migration is what puts it back, and an empty log stops meaning
-- "the function failed" and starts meaning "there is no trigger".
DROP TRIGGER IF EXISTS agent_requests_dispatch ON public.agent_requests;
CREATE TRIGGER agent_requests_dispatch
  AFTER INSERT ON public.agent_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_request();


-- =========================================================
-- The self-test
--
-- Runs the trigger's three preconditions from inside the trigger's own security context
-- — same SECURITY DEFINER, same owner, same search_path — which is the part a query in
-- the SQL editor cannot check, because the editor runs as a different role with
-- different privileges. That difference is exactly where a bug like this hides.
--
--     SELECT * FROM public.agent_notify_selftest();
--
-- It sends a real email as its last step, so a clean result is proof, not inference.
-- =========================================================
CREATE OR REPLACE FUNCTION public.agent_notify_selftest()
RETURNS TABLE (check_name TEXT, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  k    TEXT;
  i    TEXT;
  nid  BIGINT;
  tg   TEXT;
BEGIN
  check_name := '1. running as';
  outcome    := current_user || ' (definer)';
  RETURN NEXT;

  BEGIN
    SELECT value INTO k FROM public.app_config WHERE key = 'resend_api_key';
    SELECT value INTO i FROM public.app_config WHERE key = 'notify_email';
    check_name := '2. can read app_config';
    outcome    := CASE
      WHEN k IS NULL THEN 'NO — resend_api_key reads back NULL. THIS IS THE BUG.'
      ELSE 'yes — key ' || length(k) || ' chars, inbox ' || COALESCE(i, 'NULL') END;
  EXCEPTION WHEN OTHERS THEN
    check_name := '2. can read app_config';
    outcome    := 'NO — ' || SQLSTATE || ' ' || SQLERRM || '. THIS IS THE BUG.';
  END;
  RETURN NEXT;

  SELECT tgenabled::text INTO tg FROM pg_trigger
   WHERE tgrelid = 'public.agent_requests'::regclass
     AND tgname  = 'agent_requests_dispatch';
  check_name := '3. trigger attached';
  -- Searched CASE, not CASE tg: `WHEN NULL` matches nothing, so a value-CASE would have
  -- reported a missing trigger as healthy — the precise failure this test exists to find.
  outcome := CASE
     WHEN tg IS NULL THEN 'NO — no trigger on agent_requests. THIS IS THE BUG.'
     WHEN tg = 'O'   THEN 'yes, enabled'
     WHEN tg = 'D'   THEN 'NO — trigger exists but is DISABLED. THIS IS THE BUG.'
     ELSE 'enabled (' || tg || ')' END;
  RETURN NEXT;

  IF k IS NULL OR k = '' OR i IS NULL OR i = '' THEN
    check_name := '4. can send email';
    outcome    := 'not attempted — check 2 failed';
  ELSE
    BEGIN
      SELECT net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type',  'application/json',
                                      'Authorization', 'Bearer ' || k),
        body    := jsonb_build_object(
                     'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',      jsonb_build_array(i),
                     'subject', 'Groundwork self-test',
                     'html',    '<p>Sent by agent_notify_selftest(), from inside the '
                             || 'trigger''s own security context. If this arrived, the '
                             || 'notification path is healthy.</p>'),
        timeout_milliseconds := 5000)
      INTO nid;
      check_name := '4. can send email';
      outcome    := 'queued, pg_net request ' || nid || ' — check the inbox';
    EXCEPTION WHEN OTHERS THEN
      check_name := '4. can send email';
      outcome    := 'NO — ' || SQLSTATE || ' ' || SQLERRM || '. THIS IS THE BUG.';
    END;
  END IF;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agent_notify_selftest() FROM PUBLIC, anon, authenticated;
