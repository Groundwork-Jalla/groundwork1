-- A real, idempotent request in the existing admin support queue, tied to this project.
BEGIN;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS request_topic text
 CHECK(request_topic IS NULL OR request_topic='contractor_matching');
CREATE UNIQUE INDEX IF NOT EXISTS contractor_matching_open_request ON public.support_tickets(project_id)
 WHERE request_topic='contractor_matching' AND status IN('open','in_progress');
CREATE OR REPLACE FUNCTION public.guard_contractor_matching_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  NEW.request_topic:=OLD.request_topic;
  IF OLD.request_topic='contractor_matching' AND NEW.project_id IS NOT NULL THEN NEW.project_id:=OLD.project_id; END IF;
 ELSIF NEW.request_topic='contractor_matching' THEN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.project_id IS NULL
    OR NOT public.is_project_client(NEW.project_id) OR public.is_primary_project_contractor(NEW.project_id) THEN
   RAISE EXCEPTION 'not_client';
  END IF;
  PERFORM public.lock_project_stage_progression(NEW.project_id);
  IF public.project_has_primary_contractor(NEW.project_id) THEN RAISE EXCEPTION 'contractor_already_connected'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=NEW.project_id AND status='active') THEN RAISE EXCEPTION 'project_not_active'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contractor_matching_request() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS contractor_matching_guard ON public.support_tickets;
CREATE TRIGGER contractor_matching_guard BEFORE INSERT OR UPDATE ON public.support_tickets
 FOR EACH ROW EXECUTE FUNCTION public.guard_contractor_matching_request();

CREATE OR REPLACE FUNCTION public.request_project_contractor(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.support_tickets%ROWTYPE; v_name text; v_email text; v_project_name text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_project_client(p_project) OR public.is_primary_project_contractor(p_project) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(p_project);
 SELECT name INTO v_project_name FROM public.projects WHERE id=p_project AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'project_not_active'; END IF;
 IF public.project_has_primary_contractor(p_project) THEN RAISE EXCEPTION 'contractor_already_connected'; END IF;
 SELECT * INTO v FROM public.support_tickets WHERE project_id=p_project AND request_topic='contractor_matching'
   AND status IN('open','in_progress') ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v.id IS NOT NULL THEN RETURN jsonb_build_object('id',v.id,'status',v.status); END IF;
 SELECT u.email,p.full_name INTO v_email,v_name FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=auth.uid();
 IF nullif(btrim(v_email),'') IS NULL THEN RAISE EXCEPTION 'support_email_required'; END IF;
 INSERT INTO public.support_tickets(user_id,kind,name,email,subject,message,project_id,request_topic)
 VALUES(auth.uid(),'support',v_name,v_email,'Contractor matching: '||v_project_name,
  'Please help me find a contractor for '||v_project_name||'. Project: https://www.tryjalla.com/projects/'||p_project,
  p_project,'contractor_matching') RETURNING * INTO v;
 PERFORM public.log_activity(p_project,'project.contractor_requested','support_ticket',v.id,auth.uid(),jsonb_build_object('ticket_id',v.id));
 RETURN jsonb_build_object('id',v.id,'status',v.status);
END $$;
REVOKE ALL ON FUNCTION public.request_project_contractor(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_project_contractor(uuid) TO authenticated;

-- Keep the native communication journey consistent even if the browser closes.
-- The normal worker still obeys the existing delivery pause and test audience.
CREATE OR REPLACE FUNCTION public.contractor_matching_communication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_name text;v_lang text;v_email text;v_project_name text;v_position int;v_delay int;
BEGIN
 IF NEW.request_topic IS DISTINCT FROM 'contractor_matching' THEN RETURN NULL; END IF;
 SELECT lower(btrim(u.email)),p.full_name,CASE WHEN p.preferred_lang='fr' THEN 'fr' ELSE 'en' END
  INTO v_email,v_name,v_lang FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=NEW.user_id;
 SELECT name INTO v_project_name FROM public.projects WHERE id=NEW.project_id;
 WITH closed AS (
  UPDATE public.lifecycle_enrollments SET status='exited',exit_reason='contractor_support_requested',next_send_at=NULL,processing_token=NULL,processing_until=NULL
  WHERE lower(btrim(email))=v_email AND context->>'project_id'=NEW.project_id::text AND sequence_key='cl_project'
    AND status IN('active','completed') RETURNING id
 ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Contractor matching requested; see support ticket '||NEW.id)
   WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
 IF v_email IS NULL OR NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key='cl_support' AND enabled) THEN RETURN NULL; END IF;
 SELECT position,delay_hours INTO v_position,v_delay FROM public.lifecycle_sequence_steps WHERE sequence_key='cl_support' ORDER BY position LIMIT 1;
 IF v_position IS NOT NULL THEN
  INSERT INTO public.lifecycle_enrollments(sequence_key,email,full_name,lang,user_role,ref,context,next_position,next_send_at)
  VALUES('cl_support',v_email,v_name,v_lang,'client',NEW.project_id::text,
   jsonb_build_object('project_id',NEW.project_id,'project_name',v_project_name,'user_id',NEW.user_id,'first_name',split_part(coalesce(v_name,''),' ',1),'recipient_role','client','support_ticket_id',NEW.id),
   v_position,now()+make_interval(hours=>v_delay)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.contractor_matching_communication() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS contractor_matching_journey ON public.support_tickets;
CREATE TRIGGER contractor_matching_journey AFTER INSERT ON public.support_tickets
 FOR EACH ROW EXECUTE FUNCTION public.contractor_matching_communication();

CREATE OR REPLACE FUNCTION public.project_team_access(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_owner uuid; v_primary boolean; v_client boolean; v_owner_contractor boolean;
  v_named_client boolean; v_contractor boolean; v_pending boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT user_id INTO v_owner FROM public.projects WHERE id=p_project;
  IF NOT FOUND OR NOT (public.is_admin() OR public.project_member(p_project)) THEN
    RAISE EXCEPTION 'not_permitted: this project is not available';
  END IF;
  v_primary:=public.is_primary_project_contractor(p_project);
  v_client:=public.is_project_client(p_project);
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project
    AND status='accepted' AND is_primary AND contractor_user_id=v_owner) INTO v_owner_contractor;
  SELECT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND is_client AND revoked_at IS NULL) INTO v_named_client;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted') INTO v_contractor;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='pending') INTO v_pending;
  RETURN jsonb_build_object('project_role',CASE
    WHEN v_primary THEN 'primary_contractor' WHEN v_client THEN 'primary_client'
    WHEN public.is_contractor_on(p_project,auth.uid()) THEN 'contractor'
    WHEN EXISTS(SELECT 1 FROM public.project_verifiers WHERE project_id=p_project AND user_id=auth.uid() AND status='active') THEN 'verifier'
    WHEN EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND user_id=auth.uid() AND accepted_at IS NOT NULL AND revoked_at IS NULL) THEN 'observer'
    WHEN public.is_admin() THEN 'staff' ELSE NULL END, 'can_invite',v_primary OR v_client,
    'can_edit_boq',public.can_edit_project_boq(p_project),
    'assigned_contractor',public.is_contractor_on(p_project,auth.uid()),
    'primary_client',v_client AND NOT v_primary,'primary_contractor',v_primary,
    'can_invite_client',v_primary AND v_owner_contractor AND NOT v_named_client,
    'can_invite_contractor',v_client AND NOT v_primary AND NOT v_contractor AND NOT v_pending,
    'can_invite_additional_contractor',(v_primary OR v_client) AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted' AND is_primary),
    'has_client_invitation',v_named_client,'has_contractor',v_contractor,'has_pending_contractor',v_pending,
    'has_primary_contractor',public.project_has_primary_contractor(p_project),
    'contractor_request_status',CASE WHEN v_client AND NOT v_primary THEN (
      SELECT status FROM public.support_tickets WHERE project_id=p_project AND request_topic='contractor_matching'
      ORDER BY created_at DESC,id DESC LIMIT 1) END,
    'can_change_roles',public.is_admin(),
    'needs_primary_review',v_contractor AND NOT EXISTS(SELECT 1 FROM public.contractor_invites
      WHERE project_id=p_project AND status='accepted' AND is_primary));
END $$;
COMMIT;
