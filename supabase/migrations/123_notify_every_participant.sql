-- =========================================================
-- 123  Everybody on the project hears about a message, not just the client
--
-- WHY
--
-- 097 told the project OWNER that staff had written to them. Three things about it are
-- now wrong, and each one is a message somebody never heard about:
--
--   1. ONLY THE OWNER. A contractor on the project got nothing — so staff could write
--      to a contractor in the Inbox and the contractor would never know. 122 gave every
--      active participant the right to write on the thread; this gives them the right
--      to be told about it.
--
--   2. ONLY THE `jalla` CHANNEL. A WhatsApp thread returned early, so a client messaged
--      over WhatsApp got no Groundwork notification. They may read WhatsApp on a phone
--      they do not carry to site; the point of telling them on Groundwork too is that
--      the project is where the answer belongs.
--
--   3. A THREAD WITH NO PROJECT told nobody at all. `project-whatsapp` deliberately
--      never links a WhatsApp chat to a project — the chat belongs to the person — so
--      every message staff sent that way notified nobody. Reported straight from
--      testing: "I sent a message to the contractor and the client, none received it."
--
--   4. ONLY `outbound`. A contractor's reply told the client nothing, and the client's
--      question told the contractor nothing. A thread where only one direction notifies
--      is a thread people stop using.
--
-- `internal` stays silent, and that is not an oversight: an internal note is staff
-- talking among themselves and the client must never learn one exists.
--
-- ── What is deliberately kept from 097 ──────────────────────────────────────────────
-- · The message CONTENT never goes in the email. A project message can carry a cost, a
--   decision or a photograph, and email is the one place Groundwork does not control
--   who ends up reading it. The mail says a message is waiting and where to read it.
-- · Nothing here may cost the message. An AFTER ROW trigger that raises still aborts
--   the statement, so every recipient is handled in its own subtransaction and the
--   whole body is wrapped again.
-- · The bell is inserted before the email is attempted, in its own block, so an email
--   problem cannot roll back a notification that already succeeded.
--
-- Run in: Supabase Dashboard > SQL Editor (after 122)
-- =========================================================

BEGIN;

-- ── Who should be told about a message on this project? ──
--
-- The owner, every contractor whose invitation was accepted, and every active verifier.
-- Returns ids only; the caller decides who to skip and how to reach them.
--
-- Separate from the trigger so the rule is readable on its own and can be checked
-- against `project_member()` (086), which is the same set expressed as a boolean.
CREATE OR REPLACE FUNCTION public.project_participants(p_project uuid)
RETURNS TABLE (user_id uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, 'owner'
    FROM public.projects p
   WHERE p.id = p_project AND p.user_id IS NOT NULL
  UNION
  SELECT ci.contractor_user_id, 'contractor'
    FROM public.contractor_invites ci
   WHERE ci.project_id = p_project
     AND ci.status = 'accepted'
     AND ci.contractor_user_id IS NOT NULL
  UNION
  SELECT pv.user_id, 'verifier'
    FROM public.project_verifiers pv
   WHERE pv.project_id = p_project
     AND pv.status = 'active'
     AND pv.user_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.project_participants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_participants(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_participants(uuid) IS
  'Everyone with standing on a project: owner, accepted contractors, active verifiers '
  '(123). The same set project_member() answers as a boolean — if one changes the other '
  'must, or somebody can read a thread nobody tells them about.';


-- ── Where a given person reads it ────────────────────────
--
-- A contractor has no access to /projects/<id>; that view assumes an owner. Sending
-- them there is a link that bounces, which reads as the product being broken rather
-- than as a message waiting.
CREATE OR REPLACE FUNCTION public.message_link_for(p_role text, p_project uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_role
           WHEN 'contractor' THEN 'https://www.tryjalla.com/work/projects/' || p_project::text
           WHEN 'verifier'   THEN 'https://www.tryjalla.com/verifiers/projects/' || p_project::text
           ELSE                   'https://www.tryjalla.com/projects/' || p_project::text || '?tab=messages'
         END;
$$;


-- ── The trigger ──────────────────────────────────────────
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
  -- Everything below is best-effort. Nothing in it may cost the message.
  BEGIN
    -- An internal note is staff talking among themselves. Inbound and outbound both
    -- notify now: a thread where only one direction tells anybody is a thread people
    -- stop using.
    IF NEW.direction = 'internal' THEN RETURN NEW; END IF;
    IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- ── A thread with no project still has a person ─────────────────────────────────
    -- `project-whatsapp` deliberately never sets `conversations.project_id`: a WhatsApp
    -- chat belongs to the PERSON, and the project is only where the admin happened to
    -- click. That is defensible, and returning early on it was not — it meant staff
    -- could WhatsApp a client or a contractor and nobody was told anything, which is
    -- precisely what was reported from testing.
    --
    -- So: no project, no participants to fan out to, but there is still exactly one
    -- person this thread is with. Tell them.
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
          || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
          || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
          || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p></td></tr>'
          || '<tr><td style="padding:24px 28px;">'
          || '<p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
          || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
          || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
          || 'You have a new message waiting for you on Groundwork.</p>'
          || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/messages"'
          || ' style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;'
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

    -- No channel gate. A WhatsApp thread notifies on Groundwork too: the message
    -- reached a phone, and the project is still where the answer belongs.

    SELECT * INTO v_project FROM public.projects WHERE id = v_conv.project_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_label := COALESCE(NULLIF(v_project.name, ''), 'your project');

    -- Who wrote it, for the subject line. Staff are named as the team rather than
    -- individually; a client does not need to learn the org chart.
    v_from := CASE WHEN NEW.direction = 'outbound' THEN 'the Groundwork team'
                   ELSE COALESCE(
                     (SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = NEW.sender_id),
                     'someone on your project') END;

    SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';

    FOR v_who IN SELECT * FROM public.project_participants(v_conv.project_id) LOOP
      -- Never the author. Somebody who is both a contractor here and the client
      -- elsewhere still does not get told about their own message.
      CONTINUE WHEN v_who.user_id = NEW.sender_id;

      -- Each recipient in its own subtransaction: one bad address must not cost the
      -- others their notification.
      BEGIN
        SELECT COALESCE(NULLIF(full_name, ''), email), email
          INTO v_name, v_email
          FROM public.profiles WHERE id = v_who.user_id;

        -- ── The bell ──
        -- Its own block, first: the in-app notification is the one that must survive
        -- an email problem.
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

        -- ── The email ──
        IF v_email IS NULL OR v_email = '' OR resend_key IS NULL OR resend_key = '' THEN
          CONTINUE;
        END IF;

        v_link    := public.message_link_for(v_who.role, v_conv.project_id);
        v_subject := 'New message about ' || v_label;

        -- Built inside the handler, not before it: a plpgsql BEGIN/EXCEPTION block is a
        -- subtransaction, so work done before a caught error is rolled back with it.
        BEGIN
          body_html :=
            '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
            || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
            || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
            || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
            || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.55);">'
            || public.html_escape(v_label) || '</p></td></tr>'
            || '<tr><td style="padding:24px 28px;">'
            || '<p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
            || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
            || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
            || 'You have a new message from ' || public.html_escape(v_from)
            || ' about ' || public.html_escape(v_label) || '.</p>'
            || '<p style="margin:22px 0 0;"><a href="' || v_link
            || '" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;'
            || 'padding:11px 20px;border-radius:9px;font-size:13px;font-weight:600;">Read it in Groundwork</a></p>'
            || '<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#8a8a87;">'
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
    -- The final guarantee. An AFTER ROW trigger that raises still aborts the statement,
    -- so anything unhandled above would have cost somebody their message.
    RAISE WARNING 'message % : notification failed: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_client_of_message() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notify_client_of_message() IS
  'Tells every active project participant except the author that a message arrived '
  '(123, replacing 097''s owner-only version). Any channel, inbound or outbound, never '
  'internal. The content is never emailed; the mail says a message is waiting and links '
  'to the surface that person can actually open.';

-- The trigger itself is unchanged from 097 and is re-asserted here only so this file
-- stands alone if 097 was never run.
DROP TRIGGER IF EXISTS trg_notify_client_of_message ON public.project_messages;
CREATE TRIGGER trg_notify_client_of_message
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_client_of_message();

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT * FROM public.project_participants('<a project uuid>');
--     → the owner, every accepted contractor, every active verifier.
--   SELECT public.message_link_for('contractor', '<uuid>');
--     → /work/projects/<uuid>, not /projects/<uuid>.
