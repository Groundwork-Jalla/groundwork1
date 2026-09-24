-- =========================================================
-- 097  A message from Groundwork reaches the client
--
-- WHY
--
-- Native Jalla messaging works in both directions, but only one direction tells anybody.
-- `notify_project_members` (013) is called from `src/lib/supabase/messages.ts` — the
-- CLIENT's chat — so a client writing in notifies staff. Staff writing back notifies
-- nobody: the admin Inbox and the workspace Conversations tab both go through
-- `send_message` (091), which raises no notification at all.
--
-- So the team sends "the verifier needs more foundation photos" and the client finds out
-- the next time they happen to open the project. That is not a messaging system.
--
-- WHY A TRIGGER AND NOT ANOTHER CALL IN THE UI
--
-- There are already three routes that produce an outbound message — the Inbox, the
-- project's Conversations tab, and anything added later — and the product rule is "no
-- matter the route chosen". A notification raised in one screen is a notification the
-- next screen forgets. The row is the event, so the row is where this belongs.
--
-- WHAT IT REFUSES TO DO
--
-- Notify the sender. 013's INSERTs already exclude `p_sender_id`; this does the same.
-- An internal note is never mentioned — it is staff-only by definition (091) and must not
-- leak its existence through a notification or an email subject line.
--
-- WHO IT SENDS TO, AND WHY NOT THE THREAD'S PERSON
--
-- The recipient is `projects.user_id`, and `conversations.person_id` is checked against
-- it rather than trusted. The notification says "a message about YOUR project" and links
-- to that project, so a thread wrongly associated with the wrong person would tell them
-- about somebody else's build. The canonical shape of a native thread is already
-- person_id = projects.user_id (091's `project_conversation`), so normal data behaves
-- identically — and mismatched data fails closed, with a warning, instead of delivering
-- private project information to the wrong account.
--
-- WHY THE CONVERSATION'S CHANNEL AND NOT THE MESSAGE'S
--
-- `send_message` (091) stamps every message row `channel = 'jalla'`, including on a
-- WhatsApp conversation — a known defect. Gating on `NEW.channel` would therefore send a
-- "you have a Jalla message" email about a message that went out over WhatsApp, on top of
-- the WhatsApp delivery itself. The conversation's channel is the authority.
--
-- `direction = 'outbound'` stays, but note it is slightly broader than "a staff member
-- typed this": 091's defaulting can classify a session-less `origin='ghl'` row as
-- outbound. The channel gate is what removes that case here.
--
-- WHY THE WHOLE BODY IS WRAPPED
--
-- `AFTER INSERT` does NOT by itself protect the insert: an uncaught exception in an AFTER
-- ROW trigger still aborts the statement. The bell and the email have their own handlers
-- for diagnosis, and an outer one around everything is the actual guarantee that a bug in
-- project lookup, HTML building or config resolution can never cost a client their
-- message.
--
-- Run in: Supabase Dashboard > SQL Editor (after 096)
-- =========================================================

CREATE OR REPLACE FUNCTION public.notify_client_of_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_conv       public.conversations%ROWTYPE;
  v_project    public.projects%ROWTYPE;
  v_recipient  UUID;
  v_email      TEXT;
  v_name       TEXT;
  v_preview    TEXT;
  resend_key   TEXT;
  body_html    TEXT;
  v_subject    TEXT;
BEGIN
  -- Everything below is best-effort. Nothing in it may cost the message.
  BEGIN
    -- Only what staff sent outward. `inbound` is the client's own words coming in, and
    -- `internal` is a note they must never learn exists.
    IF NEW.direction IS DISTINCT FROM 'outbound' THEN RETURN NEW; END IF;
    IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- The CONVERSATION's channel, never the message row's: `send_message` stamps every
    -- row 'jalla' regardless of the thread it is on.
    IF v_conv.channel IS DISTINCT FROM 'jalla' THEN RETURN NEW; END IF;
    IF v_conv.project_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_project FROM public.projects WHERE id = v_conv.project_id;
    IF NOT FOUND OR v_project.user_id IS NULL THEN RETURN NEW; END IF;
    v_recipient := v_project.user_id;

    -- The thread's person is an invariant to check, not the address to deliver to. If
    -- the two ever disagree the data is wrong, and the safe answer is to send nothing.
    IF v_conv.person_id IS DISTINCT FROM v_recipient THEN
      RAISE WARNING 'message % : notification skipped, conversation person % is not the owner of project %',
        NEW.id, v_conv.person_id, v_conv.project_id;
      RETURN NEW;
    END IF;

    -- Never the author. A staff member who is also somebody's client still does not get
    -- told about their own message.
    IF v_recipient = NEW.sender_id THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(full_name, ''), email), email
      INTO v_name, v_email
      FROM public.profiles WHERE id = v_recipient;

    -- ── The bell ───────────────────────────────────────────
    -- Its own block: the in-app notification is the one that must not be lost to an
    -- email problem.
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_recipient,
        'message_received',
        'New message about ' || COALESCE(NULLIF(v_project.name, ''), 'your project'),
        left(COALESCE(NEW.content, ''), 140),
        jsonb_build_object(
          'project_id', v_conv.project_id,
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'message % : client notification failed: %', NEW.id, SQLERRM;
    END;

    -- ── The email ──────────────────────────────────────────
    IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;
    SELECT value INTO resend_key FROM public.app_config WHERE key = 'resend_api_key';
    IF resend_key IS NULL OR resend_key = '' THEN
      RAISE WARNING 'message % : no resend_api_key in app_config', NEW.id;
      RETURN NEW;
    END IF;

    -- Built INSIDE the handler below, not before it. A plpgsql BEGIN/EXCEPTION block is a
    -- subtransaction: if the outer net catches something, everything done in the outer
    -- block since it started is rolled back — including a bell that had already
    -- succeeded. Anything that can fail after the bell therefore has to fail nearer.
    BEGIN
      -- The message itself is NOT put in the email. A project message can carry a
      -- decision, a cost or a photo request, and email is the one place Groundwork does
      -- not control who ends up reading it. The mail says a message is waiting and where
      -- to read it.
      v_preview := 'You have a new message from the Groundwork team about '
                 || COALESCE(NULLIF(v_project.name, ''), 'your project') || '.';
      v_subject := 'New message about ' || COALESCE(NULLIF(v_project.name, ''), 'your project');

      body_html :=
        '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
        || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;">'
        || '<tr><td style="background:#0a0a0a;padding:20px 28px;">'
        || '<p style="margin:0;font-size:16px;font-weight:700;color:#fff;">Groundwork by Jalla</p>'
        || '<p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.55);">'
        || public.html_escape(COALESCE(NULLIF(v_project.name, ''), 'Your project')) || '</p></td></tr>'
        || '<tr><td style="padding:24px 28px;">'
        || '<p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
        || 'Hello ' || public.html_escape(COALESCE(v_name, 'there')) || ',</p>'
        || '<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;">'
        || public.html_escape(v_preview) || '</p>'
        || '<p style="margin:22px 0 0;"><a href="https://www.tryjalla.com/projects/' || v_conv.project_id::text
        || '?tab=messages" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;'
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
      RAISE WARNING 'message % : client email failed: %', NEW.id, SQLERRM;
    END;

  EXCEPTION WHEN OTHERS THEN
    -- The final guarantee. An AFTER ROW trigger that raises still aborts the statement,
    -- so anything unhandled above would have cost the client their message.
    RAISE WARNING 'message % : client message notification failed: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_client_of_message() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT so it sees the finished row; the outer handler above, not the timing, is
-- what stops a failure taking the message with it. Runs alongside 091's
-- `messages_advance_conversation`, which concerns the conversation's status rather than
-- anybody's inbox.
DROP TRIGGER IF EXISTS trg_notify_client_of_message ON public.project_messages;
CREATE TRIGGER trg_notify_client_of_message
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_client_of_message();

COMMENT ON FUNCTION public.notify_client_of_message() IS
  'Tells a project owner that staff wrote to them on the project''s native thread. Gated on '
  'the CONVERSATION''s channel (jalla) because send_message stamps every row jalla. Recipient '
  'is projects.user_id; a conversation whose person is not the owner is skipped with a warning. '
  'Outbound only, never the sender. Wholly best-effort: nothing here can fail the message. See 097.';

-- ── Verify ───────────────────────────────────────────────
SELECT 'trigger installed' AS what,
       count(*)::text AS n
  FROM pg_trigger WHERE tgname = 'trg_notify_client_of_message';

-- ── Rollback (not run) ───────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_notify_client_of_message ON public.project_messages;
-- DROP FUNCTION IF EXISTS public.notify_client_of_message();
