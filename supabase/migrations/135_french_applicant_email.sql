-- =========================================================
-- 135  A French applicant means Vanessa is told, by email
--
-- WHY
--
-- Every partner applicant books the same calendar — Philip's — because the call is a
-- partnership decision and he makes it. What changes with language is who else needs to
-- be in the room: an applicant who asked to be spoken to in French needs Vanessa there.
--
-- ── What we cannot do, and why this exists instead ──────────────────────────────────
-- Google sends the booking confirmation, to the organiser and the person booking.
-- Groundwork has no hook into that mail and cannot add a recipient to it, and a Google
-- appointment schedule cannot add a guest per booking — co-hosts sit on the schedule
-- and apply to every slot. So if Vanessa is to know about this one call, the message has
-- to be ours.
--
-- ── It fires on the APPLICATION, not the booking ────────────────────────────────────
-- There is no booking webhook: the slot is picked inside Google's iframe and nothing
-- comes back. So this is sent when the application is filed, which is the last moment
-- Groundwork actually knows about. The mail says a French applicant is booking now
-- rather than claiming a confirmed time it cannot see.
--
-- Run in: Supabase Dashboard > SQL Editor (after 134)
--
-- ── Not SQL, and nothing is sent without it ─────────────────────────────────────────
--   INSERT INTO public.app_config (key, value)
--   VALUES ('partner_fr_notify_email', '<Vanessa''s email>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- A row, not a constant, so the address changes without a deploy and a second person
-- can be added later by widening this one value.
-- =========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_french_partner_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  to_email   TEXT;
  resend_key TEXT;
  body_html  TEXT;
  ready      BOOLEAN;
BEGIN
  -- Only French, and only an application filed from inside the product. The public
  -- marketing form does not ask the question and leaves `languages` empty.
  IF NOT ('fr' = ANY(COALESCE(NEW.languages, '{}'))) THEN RETURN NEW; END IF;

  SELECT value INTO to_email   FROM public.app_config WHERE key = 'partner_fr_notify_email';
  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  -- Unconfigured is a normal state, not an error: nobody should be unable to apply
  -- because a notification address has not been set.
  IF to_email IS NULL OR to_email = '' OR resend_key IS NULL OR resend_key = '' THEN
    RETURN NEW;
  END IF;

  -- The two answers that decide whether this reaches Philip's calendar at all, so the
  -- mail says whether a call is actually coming.
  ready := COALESCE(NEW.has_current_project, false) AND COALESCE(NEW.will_introduce, false);

  BEGIN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
      || public.html_escape(COALESCE(NULLIF(btrim(NEW.full_name), ''), 'A professional'))
      || ' has applied to the partner network and asked to be spoken to in <strong>French</strong>.</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
      || CASE WHEN ready
           THEN 'They have a live diaspora project and are willing to introduce it, so they are booking a call with Philip now. Please plan to join it.'
           ELSE 'They do not yet have a project to introduce, so no call is being booked. Worth a conversation when one comes up.'
         END
      || '</p>'
      || '<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#63686d;">'
      || 'Speciality: '   || public.html_escape(COALESCE(NEW.role, '—'))
      || '<br>City: '     || public.html_escape(COALESCE(NEW.city, '—'))
      || '<br>Contact: '  || public.html_escape(COALESCE(NEW.email, '—'))
      || ' · '            || public.html_escape(COALESCE(NEW.phone, '—'))
      || '</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/applications"'
      || ' style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;'
      || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the application</a></p>'
      || '</td></tr></table></body></html>';

    PERFORM net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer ' || resend_key),
      body    := jsonb_build_object(
                   'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                   'to',      jsonb_build_array(to_email),
                   'subject', 'French-speaking partner applicant — please join the call',
                   'html',    body_html),
      timeout_milliseconds := 5000);
  EXCEPTION WHEN OTHERS THEN
    -- Nothing here may cost the application. An AFTER trigger that raises still aborts
    -- the statement, and losing somebody's application to a mail server is indefensible.
    RAISE WARNING 'notify_french_partner_applicant: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_french_partner_applicant() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notify_french_partner_applicant() IS
  'Emails whoever is named in partner_fr_notify_email when a partner applicant asks to '
  'be spoken to in French (135). Groundwork cannot add a recipient to Google''s own '
  'booking mail, so this is how Vanessa learns a call will need her.';

DROP TRIGGER IF EXISTS trg_notify_french_partner_applicant ON public.contractor_applications;
CREATE TRIGGER trg_notify_french_partner_applicant
  AFTER INSERT ON public.contractor_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_french_partner_applicant();

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.contractor_applications'::regclass AND NOT tgisinternal;
--   SELECT key FROM public.app_config WHERE key = 'partner_fr_notify_email';
