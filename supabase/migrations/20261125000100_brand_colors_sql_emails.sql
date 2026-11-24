-- =========================================================
-- Rebrand all database-sent transactional & notification emails
-- to official Groundwork by Jalla brand colors:
--   - Dark Green header: #122D2B
--   - Teal CTA button & links: #006B5E
--
-- Covers every active Postgres trigger function that sends HTML email
-- via Resend:
--   1. public.notify_client_of_message()
--   2. public.notify_password_changed()
--   3. public.notify_contractor_onboarding_complete()
--   4. public.notify_verifier_of_assignment()
--   5. public.notify_french_partner_applicant()
--   6. public.notify_support_ticket()
--   7. public.notify_contractor_inquiry()
--   8. public.notify_agent_request()
-- =========================================================

BEGIN;

-- ── 1. Project & direct message notifications ────────────
CREATE OR REPLACE FUNCTION public.notify_client_of_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_conv     public.conversations%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_who      RECORD;
  v_email    TEXT;
  v_name     TEXT;
  v_label    TEXT;
  v_from     TEXT;
  v_subject  TEXT;
  v_link     TEXT;
  resend_key TEXT;
  body_html  TEXT;
BEGIN
  BEGIN
    IF NEW.direction = 'internal' THEN RETURN NEW; END IF;
    IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF v_conv.project_id IS NULL THEN
      IF v_conv.person_id IS NULL OR v_conv.person_id = NEW.sender_id THEN RETURN NEW; END IF;

      SELECT COALESCE(NULLIF(full_name, ''), email), email
        INTO v_name, v_email FROM public.profiles WHERE id = v_conv.person_id;

      BEGIN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (v_conv.person_id, 'message_received', 'New message from Groundwork',
                left(COALESCE(NEW.content, ''), 140),
                jsonb_build_object('conversation_id', NEW.conversation_id,
                                   'message_id', NEW.id));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'message % : bell failed for %: %', NEW.id, v_conv.person_id, SQLERRM;
      END;

      SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
      IF v_email IS NULL OR v_email = '' OR resend_key IS NULL OR resend_key = '' THEN
        RETURN NEW;
      END IF;

      BEGIN
        body_html :=
          '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
          || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
          || '<tr><td style="background:#122D2B;padding:20px 28px;">'
          || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
          || '<tr><td style="padding:24px 28px;">'
          || '<p style="margin:0;font-size:14px;line-height:1.7;color:#122D2B;">'
          || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
          || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#122D2B;">'
          || 'You have a new message waiting for you on Groundwork.</p>'
          || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/messages"'
          || ' style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;'
          || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Read it in Groundwork</a></p>'
          || '</td></tr></table></body></html>';
        PERFORM net.http_post(
          url     := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Content-Type','application/json',
                                        'Authorization','Bearer ' || resend_key),
          body    := jsonb_build_object(
                       'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                       'to',      jsonb_build_array(v_email),
                       'subject', 'New message from Groundwork',
                       'html',    body_html),
          timeout_milliseconds := 5000);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'message % : email failed for %: %', NEW.id, v_conv.person_id, SQLERRM;
      END;

      RETURN NEW;
    END IF;

    SELECT * INTO v_project FROM public.projects WHERE id = v_conv.project_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_label := COALESCE(NULLIF(v_project.name, ''), 'your project');

    v_from := CASE WHEN NEW.direction = 'outbound' THEN 'the Groundwork team'
                   ELSE COALESCE(
                     (SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = NEW.sender_id),
                     'someone on your project') END;

    SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';

    FOR v_who IN SELECT * FROM public.project_participants(v_conv.project_id) LOOP
      CONTINUE WHEN v_who.user_id = NEW.sender_id;

      BEGIN
        SELECT COALESCE(NULLIF(full_name, ''), email), email
          INTO v_name, v_email
          FROM public.profiles WHERE id = v_who.user_id;

        BEGIN
          INSERT INTO public.notifications (user_id, type, title, body, data)
          VALUES (
            v_who.user_id,
            'message_received',
            'New message about ' || v_label,
            left(COALESCE(NEW.content, ''), 140),
            jsonb_build_object(
              'project_id',      v_conv.project_id,
              'conversation_id', NEW.conversation_id,
              'message_id',      NEW.id,
              'role',            v_who.role));
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'message % : bell failed for %: %', NEW.id, v_who.user_id, SQLERRM;
        END;

        IF v_email IS NULL OR v_email = '' OR resend_key IS NULL OR resend_key = '' THEN
          CONTINUE;
        END IF;

        v_link    := public.message_link_for(v_who.role, v_conv.project_id);
        v_subject := 'New message about ' || v_label;

        BEGIN
          body_html :=
            '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
            || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
            || '<tr><td style="background:#122D2B;padding:20px 28px;">'
            || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
            || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">'
            || public.html_escape(v_label) || '</p></td></tr>'
            || '<tr><td style="padding:24px 28px;">'
            || '<p style="margin:0;font-size:14px;line-height:1.7;color:#122D2B;">'
            || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
            || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#122D2B;">'
            || 'You have a new message from ' || public.html_escape(v_from)
            || ' about ' || public.html_escape(v_label) || '.</p>'
            || '<p style="margin:22px 0 0;"><a href="' || v_link
            || '" style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;'
            || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Read it in Groundwork</a></p>'
            || '<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#66706E;">'
            || 'Reply inside Groundwork so the whole conversation stays with the project.</p>'
            || '</td></tr></table></body></html>';

          PERFORM net.http_post(
            url     := 'https://api.resend.com/emails',
            headers := jsonb_build_object('Content-Type','application/json',
                                          'Authorization','Bearer ' || resend_key),
            body    := jsonb_build_object(
                         'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                         'to',      jsonb_build_array(v_email),
                         'subject', v_subject,
                         'html',    body_html),
            timeout_milliseconds := 5000);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'message % : email failed for %: %', NEW.id, v_who.user_id, SQLERRM;
        END;

      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'message % : notification failed for %: %', NEW.id, v_who.user_id, SQLERRM;
      END;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'message % : notification failed: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_client_of_message() FROM PUBLIC, anon, authenticated;


-- ── 2. Password changed security email ───────────────────
CREATE OR REPLACE FUNCTION public.notify_password_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key TEXT;
  recipient  TEXT;
  lang       TEXT;
  full_name  TEXT;
  greeting   TEXT;
  subject    TEXT;
  when_txt   TEXT;
  body_html  TEXT;
  req_id     BIGINT;
BEGIN
  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';

  recipient := NEW.email;
  SELECT p.full_name, p.preferred_lang INTO full_name, lang
    FROM public.profiles p WHERE p.id = NEW.id;

  IF resend_key IS NULL OR resend_key = '' THEN
    INSERT INTO public.security_notify_log (user_id, event, step, detail)
    VALUES (NEW.id, 'password_changed', 'skipped', 'resend_api_key not set in app_config');
    RETURN NEW;
  END IF;

  IF recipient IS NULL OR recipient = '' THEN
    INSERT INTO public.security_notify_log (user_id, event, step, detail)
    VALUES (NEW.id, 'password_changed', 'skipped', 'no email address on the auth record');
    RETURN NEW;
  END IF;

  lang := CASE WHEN lang = 'fr' THEN 'fr' ELSE 'en' END;

  when_txt := to_char(now() AT TIME ZONE 'UTC', 'DD Mon YYYY') || ' at '
              || to_char(now() AT TIME ZONE 'UTC', 'HH24:MI') || ' UTC';

  IF lang = 'fr' THEN
    subject  := 'Votre mot de passe Groundwork a été modifié';
    greeting := CASE WHEN full_name IS NULL OR full_name = ''
                     THEN 'Bonjour,' ELSE 'Bonjour ' || public.html_escape(split_part(full_name, ' ', 1)) || ',' END;
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">Sécurité du compte</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:15px;color:#122D2B;">' || greeting || '</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'Le mot de passe de votre compte Groundwork a été modifié le <strong>' || when_txt || '</strong>.</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'Si vous êtes à l''origine de ce changement, aucune action n''est nécessaire.</p>'
      || '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#122D2B;"><strong>Si ce n''est pas vous :</strong></p>'
      || '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'Votre compte est peut-être compromis. Réinitialisez immédiatement votre mot de passe, '
      || 'puis écrivez-nous à <a href="mailto:support@tryjalla.com" style="color:#006B5E;">support@tryjalla.com</a>.</p>'
      || '<p style="margin:0 0 0;"><a href="https://www.tryjalla.com/auth/reset-password" '
      || 'style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Réinitialiser mon mot de passe</a></p>'
      || '<p style="margin:22px 0 0;font-size:11px;line-height:1.6;color:#66706E;">'
      || 'Cet e-mail est envoyé automatiquement à chaque changement de mot de passe. Il ne peut pas être désactivé.</p>'
      || '</td></tr></table></body></html>';
  ELSE
    subject  := 'Your Groundwork password was changed';
    greeting := CASE WHEN full_name IS NULL OR full_name = ''
                     THEN 'Hello,' ELSE 'Hello ' || public.html_escape(split_part(full_name, ' ', 1)) || ',' END;
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">Account security</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:15px;color:#122D2B;">' || greeting || '</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'The password on your Groundwork account was changed on <strong>' || when_txt || '</strong>.</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'If that was you, there is nothing to do.</p>'
      || '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#122D2B;"><strong>If it was not you:</strong></p>'
      || '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#122D2B;">'
      || 'Someone else may have access to your account. Reset your password straight away, then '
      || 'contact us at <a href="mailto:support@tryjalla.com" style="color:#006B5E;">support@tryjalla.com</a>.</p>'
      || '<p style="margin:0 0 0;"><a href="https://www.tryjalla.com/auth/reset-password" '
      || 'style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Reset my password</a></p>'
      || '<p style="margin:22px 0 0;font-size:11px;line-height:1.6;color:#66706E;">'
      || 'This email is sent automatically whenever a password changes. It cannot be turned off.</p>'
      || '</td></tr></table></body></html>';
  END IF;

  BEGIN
    SELECT net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || resend_key),
      body    := jsonb_build_object(
                   'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                   'to',      jsonb_build_array(recipient),
                   'subject', subject,
                   'html',    body_html),
      timeout_milliseconds := 5000)
    INTO req_id;

    INSERT INTO public.security_notify_log (user_id, event, step, detail, net_id)
    VALUES (NEW.id, 'password_changed', 'sent',
            'lang=' || lang || ' key_len=' || length(resend_key), req_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.security_notify_log (user_id, event, step, detail)
    VALUES (NEW.id, 'password_changed', 'failed', SQLERRM);
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_password_changed() FROM PUBLIC, anon, authenticated;


-- ── 3. Contractor onboarding acknowledgement email ───────
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
        || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
        || '<tr><td style="background:#122D2B;padding:20px 28px;"><p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
        || '<tr><td style="padding:24px 28px;">'
        || '<p style="margin:0 0 14px;font-size:15px;color:#122D2B;">' || greeting || '</p>'
        || '<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#122D2B;">'
        || 'Votre intégration Groundwork est terminée. Les informations de votre compte sont enregistrées et vous pouvez maintenant continuer sur la plateforme.</p>'
        || '<p style="margin:0;"><a href="https://www.tryjalla.com/work" style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Accéder à Groundwork</a></p>'
        || '<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#66706E;">Si vous avez choisi de présenter un client, vous pouvez poursuivre votre candidature de partenaire dans Groundwork.</p>'
        || '</td></tr></table></body></html>';
    ELSE
      subject := 'Your Groundwork onboarding is complete';
      greeting := CASE WHEN NULLIF(btrim(full_name), '') IS NULL
        THEN 'Hello,'
        ELSE 'Hello ' || public.html_escape(split_part(full_name, ' ', 1)) || ','
      END;
      body_html :=
        '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
        || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
        || '<tr><td style="background:#122D2B;padding:20px 28px;"><p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
        || '<tr><td style="padding:24px 28px;">'
        || '<p style="margin:0 0 14px;font-size:15px;color:#122D2B;">' || greeting || '</p>'
        || '<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#122D2B;">'
        || 'Your Groundwork onboarding is complete. Your account information has been saved, and you can now continue using the platform.</p>'
        || '<p style="margin:0;"><a href="https://www.tryjalla.com/work" style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Go to Groundwork</a></p>'
        || '<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#66706E;">If you chose to bring a client, you can continue your partner application in Groundwork.</p>'
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
    UPDATE public.contractor_onboarding_email_log
       SET status = 'failed', detail = SQLERRM
     WHERE user_id = NEW.user_id AND event = 'onboarding_acknowledgement';
    RAISE WARNING 'contractor onboarding acknowledgement failed for %: %', NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_contractor_onboarding_complete() FROM PUBLIC, anon, authenticated;


-- ── 4. Verifier assignment email ─────────────────────────
CREATE OR REPLACE FUNCTION public.notify_verifier_of_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email    TEXT;
  v_name     TEXT;
  v_project  TEXT;
  resend_key TEXT;
  body_html  TEXT;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(name, ''), 'a project') INTO v_project
    FROM public.projects WHERE id = NEW.project_id;
  SELECT email, NULLIF(btrim(COALESCE(full_name, '')), '') INTO v_email, v_name
    FROM public.profiles WHERE id = NEW.user_id;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, project_id, data)
    VALUES (NEW.user_id, 'project',
            'You have been assigned to ' || v_project,
            'You are the ' || NEW.discipline || ' verifier on this project. '
              || 'Your work list shows what needs checking.',
            NEW.project_id,
            jsonb_build_object('project_id', NEW.project_id, 'role', 'verifier',
                               'assignment_id', NEW.id, 'discipline', NEW.discipline));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verifier assignment % : bell failed: %', NEW.id, SQLERRM;
  END;

  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  IF v_email IS NULL OR v_email = '' OR resend_key IS NULL OR resend_key = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<p style="margin:0;font-size:14px;line-height:1.7;color:#122D2B;">'
      || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#122D2B;">'
      || 'You have been assigned as the ' || public.html_escape(NEW.discipline)
      || ' verifier on <strong>' || public.html_escape(v_project) || '</strong>.</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#122D2B;">'
      || 'You can see each stage and the evidence the contractor has submitted against '
      || 'it, and record your findings from there.</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/verifiers/projects/'
      || NEW.project_id::text || '"'
      || ' style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;'
      || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the project</a></p>'
      || '</td></tr></table></body></html>';
    PERFORM net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer ' || resend_key),
      body    := jsonb_build_object(
                   'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                   'to',      jsonb_build_array(v_email),
                   'subject', 'You are verifying ' || v_project,
                   'html',    body_html),
      timeout_milliseconds := 5000);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verifier assignment % : email failed: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_verifier_of_assignment() FROM PUBLIC, anon, authenticated;


-- ── 5. French partner applicant internal alert ───────────
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
  IF NOT ('fr' = ANY(COALESCE(NEW.languages, '{}'))) THEN RETURN NEW; END IF;

  SELECT value INTO to_email   FROM public.app_config WHERE key = 'partner_fr_notify_email';
  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  IF to_email IS NULL OR to_email = '' OR resend_key IS NULL OR resend_key = '' THEN
    RETURN NEW;
  END IF;

  ready := COALESCE(NEW.has_current_project, false) AND COALESCE(NEW.will_introduce, false);

  BEGIN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<p style="margin:0;font-size:14px;line-height:1.7;color:#122D2B;">'
      || public.html_escape(COALESCE(NULLIF(btrim(NEW.full_name), ''), 'A professional'))
      || ' has applied to the partner network and asked to be spoken to in <strong>French</strong>.</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#122D2B;">'
      || CASE WHEN ready
           THEN 'They have a live diaspora project and are willing to introduce it, so they are booking a call with Philip now. Please plan to join it.'
           ELSE 'They do not yet have a project to introduce, so no call is being booked. Worth a conversation when one comes up.'
         END
      || '</p>'
      || '<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#66706E;">'
      || 'Speciality: '   || public.html_escape(COALESCE(NEW.role, '—'))
      || '<br>City: '     || public.html_escape(COALESCE(NEW.city, '—'))
      || '<br>Contact: '  || public.html_escape(COALESCE(NEW.email, '—'))
      || ' · '            || public.html_escape(COALESCE(NEW.phone, '—'))
      || '</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/applications"'
      || ' style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;'
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
    RAISE WARNING 'notify_french_partner_applicant: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_french_partner_applicant() FROM PUBLIC, anon, authenticated;


-- ── 6. Support ticket admin email ────────────────────────
CREATE OR REPLACE FUNCTION public.notify_support_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key TEXT;
  inbox      TEXT;
  is_del     BOOLEAN := NEW.kind = 'account_deletion';
  heading    TEXT;
  body_html  TEXT;
BEGIN
  heading := CASE WHEN is_del THEN 'Account deletion request' ELSE 'New support message' END;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id,
           CASE WHEN is_del THEN 'account_deletion_request' ELSE 'support_ticket' END,
           heading,
           left(NEW.subject, 140),
           jsonb_build_object('ticket_id', NEW.id, 'kind', NEW.kind, 'email', NEW.email)
    FROM   public.user_roles ur
    WHERE  ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'support ticket % : admin notification failed: %', NEW.id, SQLERRM;
  END;

  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';

  IF resend_key IS NOT NULL AND resend_key <> '' AND inbox IS NOT NULL AND inbox <> '' THEN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:' || CASE WHEN is_del THEN '#7f1d1d' ELSE '#122D2B' END || ';padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">' || heading || '</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">'
      || public.html_escape(COALESCE(NEW.name, '')) || CASE WHEN NEW.name IS NULL OR NEW.name = '' THEN '' ELSE ' — ' END
      || public.html_escape(NEW.email) || '</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#122D2B;">' || public.html_escape(NEW.subject) || '</p>'
      || '<p style="margin:0;font-size:13px;line-height:1.7;color:#122D2B;white-space:pre-wrap;">' || public.html_escape(NEW.message) || '</p>'
      || CASE WHEN is_del THEN
           '<p style="margin:20px 0 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;line-height:1.6;color:#7f1d1d;">'
           || 'This is a data-rights request. The person was told we would process it within 48 hours.</p>'
         ELSE '' END
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/support" '
      || 'style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '<p style="margin:16px 0 0;font-size:11px;color:#66706E;">Reply straight to '
      || public.html_escape(NEW.email) || '.</p>'
      || '</td></tr></table></body></html>';

    BEGIN
      PERFORM net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',     'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',       jsonb_build_array(inbox),
                     'reply_to', NEW.email,
                     'subject',  CASE WHEN is_del THEN '[deletion] ' ELSE '[support] ' END
                                 || left(NEW.subject, 90),
                     'html',     body_html),
        timeout_milliseconds := 5000);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'support ticket % : email failed: %', NEW.id, SQLERRM;
    END;
  ELSE
    RAISE WARNING 'support ticket % : no resend_api_key/notify_email in app_config', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_support_ticket() FROM PUBLIC, anon, authenticated;


-- ── 7. Contractor quote inquiry admin email ──────────────
CREATE OR REPLACE FUNCTION public.notify_contractor_inquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  resend_key  TEXT;
  inbox       TEXT;
  who         TEXT;
  body_html   TEXT;
BEGIN
  SELECT c.name INTO who FROM public.contractors c WHERE c.id = NEW.contractor_id;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id, 'contractor_inquiry',
           'Quote request for ' || COALESCE(who, 'a contractor'),
           left(NEW.name || ' · ' || NEW.location, 140),
           jsonb_build_object('inquiry_id', NEW.id, 'contractor_id', NEW.contractor_id)
    FROM   public.user_roles ur WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inquiry % : admin notification failed: %', NEW.id, SQLERRM;
  END;

  SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
  SELECT value INTO inbox      FROM public.app_config WHERE key = 'notify_email';

  IF resend_key IS NOT NULL AND resend_key <> '' AND inbox IS NOT NULL AND inbox <> '' THEN
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Quote request</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">for '
      || public.html_escape(COALESCE(who, 'a contractor')) || '</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<table cellpadding="0" cellspacing="0">'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">From</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.name) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Where</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.location) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Build</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.build_type) || '</td></tr>'
      || '</table>'
      || '<p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:#122D2B;white-space:pre-wrap;">'
      || public.html_escape(NEW.message) || '</p>'
      || '<p style="margin:20px 0 0;padding:12px 14px;background:#f8f8f8;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;line-height:1.6;color:#4a4a48;">'
      || 'Groundwork brokers this introduction. Neither side has the other''s contact details.</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/inquiries" '
      || 'style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '</td></tr></table></body></html>';

    BEGIN
      PERFORM net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'Authorization','Bearer ' || resend_key),
        body    := jsonb_build_object(
                     'from',    'Groundwork by Jalla <noreply@mail.tryjalla.com>',
                     'to',      jsonb_build_array(inbox),
                     'subject', '[quote] ' || COALESCE(who, 'contractor') || ' — ' || left(NEW.name, 60),
                     'html',    body_html),
        timeout_milliseconds := 5000);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'inquiry % : email failed: %', NEW.id, SQLERRM;
    END;
  ELSE
    RAISE WARNING 'inquiry % : no resend_api_key/notify_email in app_config', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_contractor_inquiry() FROM PUBLIC, anon, authenticated;


-- ── 8. Agent request admin email ─────────────────────────
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

  IF resend_key IS NULL OR resend_key = '' OR inbox IS NULL OR inbox = '' THEN
    INSERT INTO public.agent_notify_log (request_id, step, detail)
    VALUES (NEW.id, 'email_skipped', 'resend_api_key or notify_email missing from app_config');
  ELSE
    rows_html :=
      '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Who it is for</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.audience) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">So they can</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.goal) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Shown on</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.channel) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Language</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.language) || '</td></tr>'
      || '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Deliver as</td>'
      || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || fmt || '</td></tr>'
      || CASE WHEN NEW.notes IS NULL OR NEW.notes = '' THEN '' ELSE
           '<tr><td style="padding:6px 14px 6px 0;font-size:12px;color:#66706E;white-space:nowrap;vertical-align:top;">Notes</td>'
           || '<td style="padding:6px 0;font-size:13px;color:#122D2B;">' || public.html_escape(NEW.notes) || '</td></tr>' END;

    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">'
      || '<tr><td style="background:#122D2B;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">New agent request</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.72);">' || public.html_escape(NEW.agent) || '</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#122D2B;">' || public.html_escape(NEW.title) || '</p>'
      || '<table cellpadding="0" cellspacing="0">' || rows_html || '</table>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/admin/requests" '
      || 'style="display:inline-block;background:#006B5E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open the queue</a></p>'
      || '<p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#66706E;">Pick it up with '
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
      INSERT INTO public.agent_notify_log (request_id, step, detail)
      VALUES (NEW.id, 'email_error', SQLSTATE || ' ' || SQLERRM);
    END;
  END IF;

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

EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.agent_notify_log (request_id, step, detail)
    VALUES (NEW.id, 'fatal', SQLSTATE || ' ' || SQLERRM);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$fn$;

COMMIT;
