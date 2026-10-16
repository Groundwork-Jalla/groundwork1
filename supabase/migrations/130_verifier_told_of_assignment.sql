-- =========================================================
-- 130  A verifier is told when they are put on a project
--
-- WHY
--
-- Reported from testing: "when I add a verifier to a project, he doesn't get an email
-- that he has been added to a project." Correct — `assign_verifier` (086) inserts the row,
-- writes an activity entry and returns. Nothing else happens.
--
-- Two emails exist already and neither covers this. 105's invite says "become a Groundwork
-- verifier"; it is sent once, before they have an account. There is no second mail, so an
-- engineer who joined last month and is assigned today learns about it only by opening the
-- app and noticing. A verification is work somebody is waiting on — a stage cannot close
-- until it is done — so silence here stalls the build.
--
-- ── Only on becoming active ─────────────────────────────────────────────────────────
-- `assign_verifier` re-activates a previously removed row rather than inserting a second
-- one, so this must fire on the TRANSITION to `active`, not on every write. An UPDATE that
-- leaves the status alone — a discipline correction, a re-stamped `assigned_by` — is not a
-- new assignment and must not mail anybody again.
--
-- ── Where the link points ───────────────────────────────────────────────────────────
-- `/verifiers`, their work list. NOT `/verifiers/projects/<id>`, which 123 and 125 build
-- for message notifications and which DOES NOT EXIST as a route — the verifier surface is
-- `/verifiers` and `/verifiers/:id`, and `:id` is a verification id, not a project id. That
-- dead link is worth fixing on its own; this migration does not add a second one.
--
-- ── Nothing here may cost the assignment ────────────────────────────────────────────
-- An AFTER trigger that raises still aborts the statement, so the bell and the mail are
-- each wrapped. A verifier who is assigned but not emailed is a notification problem; an
-- assignment that fails because an email did is a staffing problem.
--
-- Run in: Supabase Dashboard > SQL Editor (after 129)
-- =========================================================

BEGIN;

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
  -- The transition, not the row. Re-assignment reactivates an existing row, and an
  -- ordinary UPDATE must not re-announce work somebody already knows about.
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(name, ''), 'a project') INTO v_project
    FROM public.projects WHERE id = NEW.project_id;
  SELECT email, NULLIF(btrim(COALESCE(full_name, '')), '') INTO v_email, v_name
    FROM public.profiles WHERE id = NEW.user_id;

  -- The bell first, in its own block: it is the record inside Groundwork and must not be
  -- lost to an email that would not send.
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
      || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
      || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
      || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
      || '<tr><td style="padding:24px 28px;">'
      || '<p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
      || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
      || 'You have been assigned as the ' || public.html_escape(NEW.discipline)
      || ' verifier on <strong>' || public.html_escape(v_project) || '</strong>.</p>'
      || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
      || 'Your work list shows each stage waiting on your check, with the evidence the '
      || 'contractor submitted.</p>'
      || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/verifiers"'
      || ' style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;'
      || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Open your work list</a></p>'
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

COMMENT ON FUNCTION public.notify_verifier_of_assignment() IS
  'Tells a verifier they are on a project (130). Fires only on the transition to active, '
  'so re-assignment and ordinary updates do not mail twice. Swallows every failure: an '
  'assignment must not fail because a notification did.';

DROP TRIGGER IF EXISTS trg_notify_verifier_of_assignment ON public.project_verifiers;
CREATE TRIGGER trg_notify_verifier_of_assignment
  AFTER INSERT OR UPDATE ON public.project_verifiers
  FOR EACH ROW EXECUTE FUNCTION public.notify_verifier_of_assignment();

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.project_verifiers'::regclass AND NOT tgisinternal;
--   -- after assigning somebody:
--   SELECT title, body, created_at FROM public.notifications
--    WHERE type = 'project' ORDER BY created_at DESC LIMIT 3;
