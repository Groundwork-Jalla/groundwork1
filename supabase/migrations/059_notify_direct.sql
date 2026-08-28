-- =========================================================
-- 059  Send the request notification straight from the database
--
-- 056/058 routed notifications through /api/agent-dispatch on Vercel, which needed a
-- shared secret in Vercel's environment. That is not available: the project is on the
-- free plan and cannot take more environment variables.
--
-- So the database calls Resend itself. This is fewer moving parts than the version it
-- replaces, not a workaround dressed up as one:
--
--   · no shared secret to keep in step across two systems
--   · no Vercel redeploy to remember
--   · no www-vs-apex redirect to trip over — pg_net does not follow redirects, and the
--     apex domain 308s to www, which would have swallowed every notification silently
--   · one less hop that can be down
--
-- The Vercel endpoint is still called when it is configured, because that is what will
-- eventually trigger GitHub Actions for automatic production. It is simply no longer
-- required for the email.
--
-- Everything sensitive lives in app_config (058): RLS on, no policies, so only
-- SECURITY DEFINER functions can read it.
-- =========================================================

-- Minimal HTML escaping. Request text is written by staff, not the public, but a title
-- containing "R&D" or an ampersand should not corrupt the markup.
CREATE OR REPLACE FUNCTION public.html_escape(t TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    replace(replace(replace(replace(t, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'),
    '');
$$;

CREATE OR REPLACE FUNCTION public.notify_agent_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key TEXT;
  inbox      TEXT;
  endpoint   TEXT;
  secret     TEXT;
  fmt        TEXT;
  due        TEXT;
  body_html  TEXT;
  rows_html  TEXT;
BEGIN
  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';
  SELECT value INTO endpoint   FROM public.app_config WHERE key = 'agent_dispatch_url';
  SELECT value INTO secret     FROM public.app_config WHERE key = 'agent_dispatch_secret';

  fmt := CASE COALESCE(NEW.output_format, 'mp4')
           WHEN 'pptx' THEN 'deck'
           WHEN 'both' THEN 'video + deck'
           ELSE 'video' END;
  due := CASE WHEN NEW.needed_by IS NULL THEN ''
              ELSE ' — needed by ' || NEW.needed_by::text END;

  -- ── The email ──
  IF resend_key IS NOT NULL AND resend_key <> '' AND inbox IS NOT NULL AND inbox <> '' THEN
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
      PERFORM net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',      jsonb_build_array(inbox),
                     'subject', 'New ' || fmt || ' request: ' || left(COALESCE(NEW.title,'Untitled'), 80) || due,
                     'html',    body_html),
        timeout_milliseconds := 5000);
    EXCEPTION WHEN OTHERS THEN
      -- Never let a notification failure block someone filing a request.
      RAISE WARNING 'agent request email failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── The GitHub kick, only if it has been configured ──
  IF endpoint IS NOT NULL AND endpoint <> '' AND secret IS NOT NULL AND secret <> '' THEN
    BEGIN
      PERFORM net.http_post(
        url     := endpoint,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-agent-secret', secret),
        body    := jsonb_build_object('record', to_jsonb(NEW)),
        timeout_milliseconds := 4000);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'agent dispatch failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agent_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.html_escape(TEXT)      FROM PUBLIC, anon;
