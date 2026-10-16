-- =========================================================
-- 127  Nobody's email address is their name in a chat
--
-- WHY
--
-- Reported from testing: in a project chat the admin shows as their email address.
-- 122's `send_message` picks the author's display name like this:
--
--     COALESCE(NULLIF(full_name, ''), email, 'Member')
--
-- `profiles.full_name` is empty for an account that never filled it in — which is the
-- normal state for a staff login — so the fallback lands on `email`, and a client reading
-- their own project thread sees `philip@tryjalla.com` where a name should be.
--
-- ── It is not only untidy ───────────────────────────────────────────────────────────
-- It publishes a working staff email address into a thread the client can read, screenshot
-- and forward, which is a direct invitation to take the conversation off Groundwork — the
-- one thing the product is built not to do. It is worse in the other direction, too: a
-- CLIENT with no full_name shows THEIR email to the contractor, and 126 now carries that
-- same line to WhatsApp.
--
-- So the fallback never reaches `email` again, for anybody.
--
-- ── Why 'Admin' and not 'Jalla' ─────────────────────────────────────────────────────
-- 'Jalla' is what the ROLE label beside the name already says. The name answers a
-- different question — who is writing — and for a staff account with no name on file the
-- honest answer is the desk, not the company. Reading "Admin · Jalla" tells the client
-- both things; "Jalla · Jalla" tells them one thing twice.
--
-- ── The history is cleaned too ──────────────────────────────────────────────────────
-- A fix from here forward leaves the address sitting in the thread, where scrolling up
-- still finds it. The backfill prefers the name the person has since filled in, and falls
-- back to the same labels — it never invents one.
--
-- Run in: Supabase Dashboard > SQL Editor (after 126)
-- =========================================================

BEGIN;

-- ── The source ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation uuid, p_content text, p_direction text DEFAULT NULL, p_attachments jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv   public.conversations%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_admin  boolean := public.is_admin();
  v_member boolean;
  v_dir    text;
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

  -- THE FIX. `email` is gone from this chain. A name that was never filled in falls back
  -- to what the person IS, never to how to contact them off-platform.
  SELECT NULLIF(btrim(COALESCE(full_name, '')), '') INTO v_name
    FROM public.profiles WHERE id = v_actor;
  -- Belt and braces: a full_name that is itself an address (people paste one into a name
  -- field) must not slip through the gap the COALESCE no longer leaves.
  IF v_name IS NULL OR v_name LIKE '%@%' THEN
    v_name := CASE WHEN v_admin THEN 'Admin' ELSE 'Member' END;
  END IF;

  INSERT INTO public.project_messages
    (project_id, conversation_id, sender_id, sender_name, content, direction, channel, attachments)
  VALUES
    (v_conv.project_id, p_conversation, v_actor, v_name, p_content, v_dir, 'jalla', p_attachments)
  RETURNING id INTO v_id;

  IF v_dir = 'internal' THEN
    PERFORM public.log_activity(v_conv.project_id, 'message.internal_note', 'conversation', p_conversation, v_conv.person_id,
      jsonb_build_object('message_id', v_id));
  END IF;
  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.send_message(uuid, text, text, jsonb) IS
  'Writes a message as the caller (122), with the display name fixed in 127: never the '
  'author''s email address. An unfilled full_name falls back to Admin or Member, because '
  'a staff address in a client-readable thread invites the conversation off Groundwork.';

-- ── The history ────────────────────────────────────────────
-- Scoped to rows that actually carry an address. `LIKE '%@%'` is deliberately narrow:
-- a name is not an email because it has a dot in it, and a loose pattern here would
-- rewrite real names.
UPDATE public.project_messages m
   SET sender_name = COALESCE(
         -- The name they have since filled in, if it is a name.
         (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p
           WHERE p.id = m.sender_id AND btrim(COALESCE(p.full_name, '')) <> ''
             AND p.full_name NOT LIKE '%@%'),
         -- Otherwise the same labels the function now writes.
         CASE WHEN EXISTS (SELECT 1 FROM public.user_roles r
                            WHERE r.user_id = m.sender_id AND r.role = 'admin')
              THEN 'Admin' ELSE 'Member' END)
 WHERE m.sender_name LIKE '%@%'
   -- Only our own people. An inbound message from the provider (077) carries whatever
   -- the contact is called there and is not ours to rewrite.
   AND m.sender_id IS NOT NULL;

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   -- should be 0: no address is anybody's name any more
--   SELECT count(*) FROM public.project_messages
--    WHERE sender_name LIKE '%@%' AND sender_id IS NOT NULL;
--
--   -- what the labels now look like
--   SELECT sender_name, count(*) FROM public.project_messages
--    GROUP BY sender_name ORDER BY 2 DESC LIMIT 20;
