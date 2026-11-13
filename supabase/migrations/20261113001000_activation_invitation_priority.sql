-- Invitation context is authoritative even if a browser event is interrupted.
BEGIN;
CREATE OR REPLACE FUNCTION public.communication_invitation_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb:=to_jsonb(NEW);v_project uuid:=(j->>'project_id')::uuid;v_inviter uuid:=(j->>'invited_by')::uuid;
 v_token uuid:=(j->>'token')::uuid;v_email text:=lower(btrim(j->>'email'));v_accepted boolean;v_seq text;
 v_inviter_email text;v_name text;v_project_name text;v_lang text;v_position int;v_hours int;
BEGIN
 IF TG_TABLE_NAME='project_viewers' THEN
  IF NOT coalesce((j->>'is_client')::boolean,false) OR j->>'revoked_at' IS NOT NULL THEN RETURN NULL; END IF;
  v_accepted:=j->>'accepted_at' IS NOT NULL;v_seq:='cs_client_pending';
 ELSE
  IF j->>'status' NOT IN('pending','accepted') THEN RETURN NULL; END IF;
  v_accepted:=j->>'status'='accepted';v_seq:='cl_contractor_pending';
 END IF;
 IF v_email IS NOT NULL THEN
  WITH closed AS (
   UPDATE public.lifecycle_enrollments SET status='suppressed',exit_reason='invitation_context',next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE lower(btrim(email))=v_email AND sequence_key IN('cs_signup','cs_onboarded','cl_signup') AND status IN('active','completed') RETURNING id
  ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation takes priority')
    WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
 END IF;
 IF v_accepted THEN
  WITH closed AS (
   UPDATE public.lifecycle_enrollments SET status='exited',exit_reason='invitation_accepted',next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE context->>'project_id'=v_project::text AND context->>'invite_path' IN('/invite/'||v_token,'/share/'||v_token)
    AND sequence_key IN('ci_invited','iv_invited','cs_client_pending','cl_contractor_pending') AND status IN('active','completed') RETURNING id
  ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation accepted')
    WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
  RETURN NULL;
 END IF;
 IF NOT coalesce((j->>'is_share_link')::boolean,false) THEN RETURN NULL; END IF;
 -- A share link has no known recipient yet. Only remind its actual inviter;
 -- creating a link must never claim that an invitation email was delivered.
 IF v_seq='cs_client_pending' AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_inviter AND status='accepted' AND is_primary) THEN RETURN NULL; END IF;
 IF v_seq='cl_contractor_pending' AND NOT (
  EXISTS(SELECT 1 FROM public.projects WHERE id=v_project AND user_id=v_inviter)
  OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_inviter AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)
 ) THEN RETURN NULL; END IF;
 SELECT lower(btrim(u.email)),p.full_name,CASE WHEN p.preferred_lang='fr' THEN 'fr' ELSE 'en' END INTO v_inviter_email,v_name,v_lang
 FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=v_inviter;
 SELECT name INTO v_project_name FROM public.projects WHERE id=v_project;
 WITH closed AS (
  UPDATE public.lifecycle_enrollments SET status='exited',exit_reason='invitation_created',next_send_at=NULL,processing_token=NULL,processing_until=NULL
  WHERE lower(btrim(email))=v_inviter_email AND context->>'project_id'=v_project::text AND sequence_key IN('cs_project','cl_project') AND status IN('active','completed') RETURNING id
 ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation link created')
   WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
 IF v_inviter_email IS NULL OR NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key=v_seq AND enabled) THEN RETURN NULL; END IF;
 SELECT min(position) INTO v_position FROM public.lifecycle_sequence_steps WHERE sequence_key=v_seq AND position>1;
 IF v_position IS NULL THEN RETURN NULL; END IF;
 SELECT sum(delay_hours) INTO v_hours FROM public.lifecycle_sequence_steps WHERE sequence_key=v_seq AND position<=v_position;
 INSERT INTO public.lifecycle_enrollments(sequence_key,email,full_name,lang,user_role,ref,context,next_position,next_send_at)
 VALUES(v_seq,v_inviter_email,v_name,v_lang,CASE WHEN v_seq='cs_client_pending' THEN 'contractor' ELSE 'client' END,
  v_project||':link:'||v_token,jsonb_build_object('project_id',v_project,'project_name',v_project_name,'invite_path',CASE WHEN v_seq='cs_client_pending' THEN '/share/' ELSE '/invite/' END||v_token,
   'recipient_role',CASE WHEN v_seq='cs_client_pending' THEN 'contractor' ELSE 'client' END,'anonymous_invitation',true),v_position,now()+v_hours*interval '1 hour')
 ON CONFLICT(sequence_key,email,ref) DO NOTHING;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS communication_viewer_priority ON public.project_viewers;
CREATE TRIGGER communication_viewer_priority AFTER INSERT OR UPDATE ON public.project_viewers FOR EACH ROW EXECUTE FUNCTION public.communication_invitation_changed();
DROP TRIGGER IF EXISTS communication_contractor_priority ON public.contractor_invites;
CREATE TRIGGER communication_contractor_priority AFTER INSERT OR UPDATE ON public.contractor_invites FOR EACH ROW EXECUTE FUNCTION public.communication_invitation_changed();
REVOKE ALL ON FUNCTION public.communication_invitation_changed() FROM PUBLIC,anon,authenticated;

UPDATE public.lifecycle_sequence_steps SET cta_key='manage_invitation'
 WHERE code IN('CS14','CS15','CL11','CL12') AND cta_key='open_project';
NOTIFY pgrst,'reload schema';
COMMIT;
