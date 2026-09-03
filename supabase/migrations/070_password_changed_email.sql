-- =========================================================
-- 070_password_changed_email.sql
--
-- Tell someone when their password changes.
--
-- ── WHY THIS IS A TRIGGER AND NOT A `sendEmail()` CALL ──────────────────────────────
-- The obvious implementation is a line in /auth/new-password.tsx after updateUser(),
-- through the /api/send-email endpoint that already exists. That implementation is
-- worthless, and it is worth saying why so nobody "simplifies" it back.
--
-- The entire value of this email is that it reaches the ACCOUNT OWNER when the person
-- changing the password is NOT the account owner. If the browser decides whether to send
-- it, then the attacker's browser — which is the one running the code in exactly the
-- scenario this exists for — simply does not send it. Worse, /api/send-email takes its
-- recipient verbatim from the caller, so a modified client could send it to itself.
-- A tripwire the intruder controls is not a tripwire.
--
-- Firing from the database removes the client from the decision. It fires for a reset
-- link, for a change from the profile page, for a change made through the Supabase
-- dashboard, and for one made by calling the Auth API directly with curl. There is no
-- path to `encrypted_password` that misses it.
--
-- ── WHAT IT DELIBERATELY DOES NOT SAY ───────────────────────────────────────────────
-- Not "we signed out your other devices". That happens in new-password.tsx and therefore
-- only on the reset path — an admin-side or dashboard change does not do it. An email
-- that promises a security action which did not occur is worse than one that stays quiet.
--
-- Follows 059: Resend is called straight from Postgres. Same reasoning — no shared
-- secret, no redeploy, no apex-vs-www redirect for pg_net to fall into.
--
-- Run in: Supabase Dashboard > SQL Editor (after 069)
-- =========================================================

-- ── Log ──────────────────────────────────────────────────
--
-- Same lesson as 063: a notification must never block the thing that triggered it, so
-- every failure is swallowed — and a swallowed failure with nowhere to land is one
-- nobody can diagnose. This is the more important of the two to be able to answer
-- questions about, because "I never got an email when my password changed" is a
-- security report, not a support ticket.
CREATE TABLE IF NOT EXISTS public.security_notify_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID,
  event      TEXT NOT NULL,
  step       TEXT NOT NULL,
  detail     TEXT,
  net_id     BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_notify_log_created_idx
  ON public.security_notify_log (created_at DESC);

-- RLS on with no policies, and revoked besides: these rows say when an account's password
-- changed, which is not something any browser session has business reading.
ALTER TABLE public.security_notify_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_notify_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.security_notify_log IS
  'One row per step of notify_password_changed(). Read it in the SQL editor when someone '
  'reports that a security notification did not arrive. Never logs the key, only its length.';

-- ── The notification ─────────────────────────────────────
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

  -- The address on the auth record is the authoritative one. profiles.email is a mirror
  -- (025) and only used for the name and language beside it.
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

  -- Their language, not ours. Most of this audience is francophone; a security email
  -- nobody can read is a security email nobody acts on.
  lang := CASE WHEN lang = 'fr' THEN 'fr' ELSE 'en' END;

  when_txt := to_char(now() AT TIME ZONE 'UTC', 'DD Mon YYYY') || ' at '
              || to_char(now() AT TIME ZONE 'UTC', 'HH24:MI') || ' UTC';

  IF lang = 'fr' THEN
    subject  := 'Votre mot de passe Groundwork a été modifié';
    greeting := CASE WHEN full_name IS NULL OR full_name = ''
                     THEN 'Bonjour,' ELSE 'Bonjour ' || public.html_escape(split_part(full_name, ' ', 1)) || ',' END;
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.5);">Sécurité du compte</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:15px;color:#0a0a0a;">' || greeting || '</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'Le mot de passe de votre compte Groundwork a été modifié le <strong>' || when_txt || '</strong>.</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'Si vous êtes à l''origine de ce changement, aucune action n''est nécessaire.</p>'
      || '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#0a0a0a;"><strong>Si ce n''est pas vous :</strong></p>'
      || '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'Votre compte est peut-être compromis. Réinitialisez immédiatement votre mot de passe, '
      || 'puis écrivez-nous à <a href="mailto:support@tryjalla.com" style="color:#0a0a0a;">support@tryjalla.com</a>.</p>'
      || '<p style="margin:0 0 0;"><a href="https://www.tryjalla.com/auth/reset-password" '
      || 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Réinitialiser mon mot de passe</a></p>'
      || '<p style="margin:22px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">'
      || 'Cet e-mail est envoyé automatiquement à chaque changement de mot de passe. Il ne peut pas être désactivé.</p>'
      || '</td></tr></table></body></html>';
  ELSE
    subject  := 'Your Groundwork password was changed';
    greeting := CASE WHEN full_name IS NULL OR full_name = ''
                     THEN 'Hello,' ELSE 'Hello ' || public.html_escape(split_part(full_name, ' ', 1)) || ',' END;
    body_html :=
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
      || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.5);">Account security</p>'
      || '</td></tr><tr><td style="padding:24px 28px;">'
      || '<p style="margin:0 0 14px;font-size:15px;color:#0a0a0a;">' || greeting || '</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'The password on your Groundwork account was changed on <strong>' || when_txt || '</strong>.</p>'
      || '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'If that was you, there is nothing to do.</p>'
      || '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#0a0a0a;"><strong>If it was not you:</strong></p>'
      || '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#0a0a0a;">'
      || 'Someone else may have access to your account. Reset your password straight away, then '
      || 'contact us at <a href="mailto:support@tryjalla.com" style="color:#0a0a0a;">support@tryjalla.com</a>.</p>'
      || '<p style="margin:0 0 0;"><a href="https://www.tryjalla.com/auth/reset-password" '
      || 'style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Reset my password</a></p>'
      || '<p style="margin:22px 0 0;font-size:11px;line-height:1.6;color:#8a8a87;">'
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
    -- A failed notification must never roll back the password change itself. Somebody
    -- locked out of their account is a worse outcome than a missing email, and the reset
    -- flow has already told them on screen that it worked.
    INSERT INTO public.security_notify_log (user_id, event, step, detail)
    VALUES (NEW.id, 'password_changed', 'failed', SQLERRM);
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_password_changed() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notify_password_changed() IS
  'Emails the account owner whenever auth.users.encrypted_password changes. Fires from '
  'the database so the client cannot suppress or redirect it — see 070 header.';

-- ── Trigger ──────────────────────────────────────────────
--
-- `OF encrypted_password` narrows to statements that mention the column; the WHEN clause
-- then requires the value to have actually changed. Both are needed: Supabase writes to
-- auth.users on ordinary sign-ins (last_sign_in_at and friends), and without the WHEN a
-- broad UPDATE touching that column would mail everybody for nothing.
--
-- INSERT is not covered, deliberately — that is a signup, which is not a password change
-- and already sends its own confirmation.
DROP TRIGGER IF EXISTS on_auth_password_changed ON auth.users;
CREATE TRIGGER on_auth_password_changed
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.notify_password_changed();

-- ── Verify ───────────────────────────────────────────────
-- One row: on_auth_password_changed.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
   AND tgname = 'on_auth_password_changed';
