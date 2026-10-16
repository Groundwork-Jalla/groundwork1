-- =========================================================
-- 129  The WhatsApp button actually sends over WhatsApp
--
-- WHY
--
-- Reported from testing, and correctly: "when they click the WhatsApp button, they type
-- their message, and the contractor will receive it in their WhatsApp number, both in
-- their phone and on Groundwork." None of that could happen, for four stacked reasons —
-- each one alone enough:
--
--   1. `send_message` (122) HARDCODES `'jalla'` as the channel, whatever thread you typed
--      in. There was no way to record a message as having been sent over WhatsApp.
--   2. The WhatsApp tab in a project was the person's OWN thread with Jalla, which carries
--      no project (091). So a message typed there was project-less.
--   3. 126's trigger fires only on project-linked `jalla` rows, so (1) and (2) together
--      meant it never fired for anything typed in the WhatsApp tab.
--   4. The UI never asked for delivery in member view at all.
--
-- So the channel becomes a property of the MESSAGE, chosen when it is sent, and the
-- fan-out stops caring which channel a project message was written on.
--
-- ── One thread, two channels ────────────────────────────────────────────────────────
-- The project conversation stays one conversation. "Groundwork" and "WhatsApp" are not
-- two inboxes to keep in sync — they are two ways to carry the same project's
-- conversation, and every message stays on the project's record either way. That is what
-- makes "both in their phone and on Groundwork" true rather than a sync problem.
--
-- ── Why the loop guard moved ────────────────────────────────────────────────────────
-- 126 closed the loop by scope: it only fired on `jalla`, so a mirrored WhatsApp reply
-- could not re-enter. Widening that removes the guarantee, so the remaining guard carries
-- it — and it is the stronger one anyway:
--
--   · `message_deliveries` is unique on (message, recipient, channel), so a given message
--     is carried to a given person at most once, however many times anything fires.
--   · The inbound webhook (128) refuses to mirror a provider message id that appears in
--     `message_deliveries.provider_message_id` — our own send, echoed back.
--
-- Run in: Supabase Dashboard > SQL Editor (after 128)
-- =========================================================

BEGIN;

-- The 4-argument version must GO, not merely be replaced: adding a defaulted parameter
-- creates a second function, and a 4-argument call would then match both and fail as
-- ambiguous rather than picking one.
DROP FUNCTION IF EXISTS public.send_message(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation uuid, p_content text, p_direction text DEFAULT NULL,
  p_attachments jsonb DEFAULT NULL, p_channel text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv   public.conversations%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_admin  boolean := public.is_admin();
  v_member boolean;
  v_dir    text;
  v_chan   text;
  v_name   text;
  v_id     uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in: a message has an author'; END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN RAISE EXCEPTION 'empty_message: nothing to send'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such conversation'; END IF;

  v_member := v_conv.person_id = v_actor
           OR (v_conv.project_id IS NOT NULL AND public.project_messaging_member(v_conv.project_id));
  IF NOT (v_admin OR v_member) THEN
    RAISE EXCEPTION 'not_member: only a party to the conversation or an active project member may write on it';
  END IF;

  IF v_admin THEN
    v_dir := COALESCE(p_direction, 'outbound');
    IF v_dir NOT IN ('outbound', 'internal') THEN RAISE EXCEPTION 'bad_direction: staff write outbound or internal'; END IF;
  ELSE
    IF p_direction IS NOT NULL AND p_direction <> 'inbound' THEN
      RAISE EXCEPTION 'bad_direction: a project member message is inbound';
    END IF;
    v_dir := 'inbound';
  END IF;

  -- ── The channel the sender chose ────────────────────────────────────────────────
  -- Defaults to the conversation's own channel, so every existing caller behaves exactly
  -- as it did. An explicit choice is allowed only from the list we can actually carry:
  -- naming a channel nothing delivers would be a message that looks sent and is not.
  v_chan := COALESCE(NULLIF(btrim(COALESCE(p_channel, '')), ''), v_conv.channel, 'jalla');
  IF v_chan NOT IN ('jalla', 'whatsapp') THEN
    RAISE EXCEPTION 'bad_channel: a message is sent on Groundwork or WhatsApp';
  END IF;
  -- An internal note is staff talking among themselves and has nowhere to be carried to.
  IF v_dir = 'internal' THEN v_chan := 'jalla'; END IF;

  SELECT NULLIF(btrim(COALESCE(full_name, '')), '') INTO v_name
    FROM public.profiles WHERE id = v_actor;
  IF v_name IS NULL OR v_name LIKE '%@%' THEN
    v_name := CASE WHEN v_admin THEN 'Admin' ELSE 'Member' END;
  END IF;

  INSERT INTO public.project_messages
    (project_id, conversation_id, sender_id, sender_name, content, direction, channel, attachments)
  VALUES
    (v_conv.project_id, p_conversation, v_actor, v_name, p_content, v_dir, v_chan, p_attachments)
  RETURNING id INTO v_id;

  IF v_dir = 'internal' THEN
    PERFORM public.log_activity(v_conv.project_id, 'message.internal_note', 'conversation', p_conversation, v_conv.person_id,
      jsonb_build_object('message_id', v_id));
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.send_message(uuid, text, text, jsonb, text) IS
  'Writes a message as the caller. The channel is the sender''s choice (129) rather than '
  'always jalla (122): clicking WhatsApp records a WhatsApp message, which 126 then '
  'carries to the other participants'' phones. Display name never an email (127).';

-- ── The fan-out stops caring which channel ─────────────────
CREATE OR REPLACE FUNCTION public.fanout_message_to_phones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  endpoint TEXT;
  secret   TEXT;
BEGIN
  -- An internal note must never leave Groundwork, let alone arrive on a client's phone.
  IF NEW.direction = 'internal' THEN RETURN NEW; END IF;

  -- A project is still required: a message with no project has no other participants to
  -- carry it to, and the person's own thread is already their phone.
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO endpoint FROM public.app_config WHERE key = 'message_fanout_url';
  SELECT value INTO secret   FROM public.app_config WHERE key = 'message_fanout_secret';
  secret := COALESCE(secret, (SELECT value FROM public.app_config WHERE key = 'agent_dispatch_secret'));

  IF endpoint IS NULL OR endpoint = '' OR secret IS NULL OR secret = '' THEN
    RETURN NEW;
  END IF;

  -- Nothing here may cost the message: an AFTER trigger that raises still aborts the
  -- statement, so the whole call is swallowed.
  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || secret),
      body    := jsonb_build_object('messageId', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fanout_message_to_phones: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fanout_message_to_phones() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fanout_message_to_phones() IS
  'Asks the server to carry a project message to the other participants phones (126, '
  'widened in 129 to any channel). Never an internal note. The loop guard is the '
  'message_deliveries unique index plus the inbound echo check (128), not channel scope.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- exactly one send_message, taking five arguments
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'send_message' AND pronamespace = 'public'::regnamespace;
--
--   -- what channels messages are actually being sent on
--   SELECT channel, direction, count(*) FROM public.project_messages
--    GROUP BY 1, 2 ORDER BY 3 DESC;
