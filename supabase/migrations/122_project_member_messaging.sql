-- Let every active project participant use the project's Jalla thread.
-- 091 allowed owners and contractors; verifiers have been project members since 086.

CREATE OR REPLACE FUNCTION public.project_messaging_member(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = p_project AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.contractor_invites ci
                WHERE ci.project_id = p_project
                  AND ci.contractor_user_id = auth.uid()
                  AND ci.status = 'accepted')
    OR EXISTS (SELECT 1 FROM public.project_verifiers pv
                WHERE pv.project_id = p_project
                  AND pv.user_id = auth.uid()
                  AND pv.status = 'active');
$$;

REVOKE ALL ON FUNCTION public.project_messaging_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_messaging_member(uuid) TO authenticated;

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

  SELECT COALESCE(NULLIF(full_name, ''), email, 'Member') INTO v_name FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.project_messages
    (project_id, conversation_id, sender_id, sender_name, content, direction, channel, attachments)
  VALUES
    (v_conv.project_id, p_conversation, v_actor, COALESCE(v_name, 'Member'), p_content, v_dir, 'jalla', p_attachments)
  RETURNING id INTO v_id;

  IF v_dir = 'internal' THEN
    PERFORM public.log_activity(v_conv.project_id, 'message.internal_note', 'conversation', p_conversation, v_conv.person_id,
      jsonb_build_object('message_id', v_id));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_project_conversation(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (public.is_admin()
          OR public.project_messaging_member(p_project)) THEN
    RAISE EXCEPTION 'not_member: not a member of this project';
  END IF;
  RETURN public.project_conversation(p_project);
END $$;

DROP POLICY IF EXISTS "member_read_conversations" ON public.conversations;
CREATE POLICY "member_read_conversations" ON public.conversations FOR SELECT TO authenticated
  USING (project_id IS NOT NULL AND public.project_messaging_member(project_id));

DROP POLICY IF EXISTS "member_read_messages" ON public.project_messages;
CREATE POLICY "member_read_messages" ON public.project_messages FOR SELECT TO authenticated
  USING (direction <> 'internal' AND (
           (project_id IS NOT NULL AND public.project_messaging_member(project_id))
           OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.person_id = auth.uid())));

DROP POLICY IF EXISTS "member_send_messages" ON public.project_messages;
CREATE POLICY "member_send_messages" ON public.project_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND direction <> 'internal' AND (
           (project_id IS NOT NULL AND public.project_messaging_member(project_id))
           OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.person_id = auth.uid())));
