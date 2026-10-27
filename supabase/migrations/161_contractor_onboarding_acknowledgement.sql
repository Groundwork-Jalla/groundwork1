-- =========================================================
-- 161  A contractor hears when onboarding is complete
--
-- The final onboarding answer is persisted as `client_intent` (118), after all required
-- setup steps are complete. Send one acknowledgement from the database, to the address
-- on the auth record, in the language the contractor chose. The email is not part of the
-- transaction: a Resend or logging failure must never undo a completed onboarding.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractor_onboarding_email_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL,
  event      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('queued', 'skipped', 'failed')),
  detail     TEXT,
  net_id     BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event)
);

ALTER TABLE public.contractor_onboarding_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contractor_onboarding_email_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.contractor_onboarding_email_log IS
  'One record for the contractor onboarding acknowledgement attempt (161). '
  'Not readable from browser sessions.';

CREATE OR REPLACE FUNCTION public.notify_contractor_onboarding_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  recipient  TEXT;
  resend_key TEXT;
  full_name  TEXT;
  lang       TEXT;
  greeting   TEXT;
  subject    TEXT;
  body_html  TEXT;
  req_id     BIGINT;
BEGIN
  -- The answer is the last action in onboarding. Do not send for an incomplete record,
  -- nor again if an existing answer is edited.
  IF NEW.client_intent IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.client_intent IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NOT COALESCE(
      (public.contractor_onboarding_status(NEW.user_id) ->> 'complete')::boolean,
      false
    ) THEN
      INSERT INTO public.contractor_onboarding_email_log (user_id, event, status, detail)
      VALUES (NEW.user_id, 'onboarding_acknowledgement', 'skipped', 'required onboarding steps incomplete')
      ON CONFLICT (user_id, event) DO NOTHING;
      RETURN NEW;
    END IF;

    SELECT email INTO recipient FROM auth.users WHERE id = NEW.user_id;
    SELECT p.full_name, p.preferred_lang INTO full_name, lang
      FROM public.profiles p WHERE p.id = NEW.user_id;
    SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';

    IF recipient IS NULL OR btrim(recipient) = '' THEN
      INSERT INTO public.contractor_onboarding_email_log (user_id, event, status, detail)
      VALUES (NEW.user_id, 'onboarding_acknowledgement', 'skipped', 'no email address on auth record')
      ON CONFLICT (user_id, event) DO NOTHING;
      RETURN NEW;
    END IF;

    IF resend_key IS NULL OR resend_key = '' THEN
      INSERT INTO public.contractor_onboarding_email_log (user_id, event, status, detail)
      VALUES (NEW.user_id, 'onboarding_acknowledgement', 'skipped', 'resend_api_key not set in app_config')
      ON CONFLICT (user_id, event) DO NOTHING;
      RETURN NEW;
    END IF;

    -- Reserve the single send before queuing it, so repeated or concurrent writes cannot
    -- send duplicate acknowledgements.
    INSERT INTO public.contractor_onboarding_email_log (user_id, event, status, detail)
    VALUES (NEW.user_id, 'onboarding_acknowledgement', 'queued', 'Resend request not yet queued')
    ON CONFLICT (user_id, event) DO NOTHING;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    lang := CASE WHEN lang = 'fr' THEN 'fr' ELSE 'en' END;
    IF lang = 'fr' THEN
      subject := 'Votre intégration Groundwork est terminée';
      greeting := CASE WHEN NULLIF(btrim(full_name), '') IS NULL
        THEN 'Bonjour,'
        ELSE 'Bonjour ' || public.html_escape(split_part(full_name, ' ', 1)) || ','
      END;
      body_html :=
        '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
        || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
        || '<tr><td style="background:#0a0a0a;padding:20px 28px;"><p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
        || '<tr><td style="padding:24px 28px;">'
        || '<p style="margin:0 0 14px;font-size:15px;color:#0a0a0a;">' || greeting || '</p>'
        || '<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#0a0a0a;">'
        || 'Votre intégration Groundwork est terminée. Les informations de votre compte sont enregistrées et vous pouvez maintenant continuer sur la plateforme.</p>'
        || '<p style="margin:0;"><a href="https://www.tryjalla.com/work" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Accéder à Groundwork</a></p>'
        || '<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a8a87;">Si vous avez choisi de présenter un client, vous pouvez poursuivre votre candidature de partenaire dans Groundwork.</p>'
        || '</td></tr></table></body></html>';
    ELSE
      subject := 'Your Groundwork onboarding is complete';
      greeting := CASE WHEN NULLIF(btrim(full_name), '') IS NULL
        THEN 'Hello,'
        ELSE 'Hello ' || public.html_escape(split_part(full_name, ' ', 1)) || ','
      END;
      body_html :=
        '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
        || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
        || '<tr><td style="background:#0a0a0a;padding:20px 28px;"><p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
        || '<tr><td style="padding:24px 28px;">'
        || '<p style="margin:0 0 14px;font-size:15px;color:#0a0a0a;">' || greeting || '</p>'
        || '<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#0a0a0a;">'
        || 'Your Groundwork onboarding is complete. Your account information has been saved, and you can now continue using the platform.</p>'
        || '<p style="margin:0;"><a href="https://www.tryjalla.com/work" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Go to Groundwork</a></p>'
        || '<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a8a87;">If you chose to bring a client, you can continue your partner application in Groundwork.</p>'
        || '</td></tr></table></body></html>';
    END IF;

    SELECT net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || resend_key),
      body    := jsonb_build_object(
                   'from', 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                   'to', jsonb_build_array(recipient),
                   'subject', subject,
                   'html', body_html),
      timeout_milliseconds := 5000)
      INTO req_id;

    UPDATE public.contractor_onboarding_email_log
       SET detail = 'lang=' || lang, net_id = req_id
     WHERE user_id = NEW.user_id AND event = 'onboarding_acknowledgement';
  EXCEPTION WHEN OTHERS THEN
    -- Email is best-effort and must not prevent the final onboarding answer from saving.
    UPDATE public.contractor_onboarding_email_log
       SET status = 'failed', detail = SQLERRM
     WHERE user_id = NEW.user_id AND event = 'onboarding_acknowledgement';
    RAISE WARNING 'contractor onboarding acknowledgement failed for %: %', NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_contractor_onboarding_complete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contractor_onboarding_complete_email ON public.contractor_onboarding;
CREATE TRIGGER trg_contractor_onboarding_complete_email
  AFTER INSERT OR UPDATE OF client_intent ON public.contractor_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_contractor_onboarding_complete();

COMMENT ON FUNCTION public.notify_contractor_onboarding_complete() IS
  'Queues one English or French acknowledgement when a contractor saves the final '
  'onboarding answer. Email failure never blocks completion (161).';
