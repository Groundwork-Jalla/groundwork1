-- Authoritative actions, preferences, staff replies and durable provider events.
BEGIN;
CREATE OR REPLACE FUNCTION public.lifecycle_action_state(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE; v_uid uuid; v_project uuid;
  v_owner uuid; v_status text; v_intent text; v_token uuid; v_invite record;
   v_reason text:='ready'; v_kind text:='ready';
  v_qualified boolean:=false; v_path text; v_seq text;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','suppress','reason','enrollment_missing'); END IF;
  v_seq:=e.sequence_key;
  SELECT id INTO v_uid FROM auth.users WHERE lower(btrim(email))=lower(btrim(e.email)) LIMIT 1;
  IF coalesce(e.context->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_project:=(e.context->>'project_id')::uuid;
    SELECT user_id,status::text INTO v_owner,v_status FROM public.projects WHERE id=v_project;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','suppress','reason','project_unavailable','operational',true); END IF;
    IF v_status IN('paused','on_hold') THEN RETURN jsonb_build_object('kind','hold','reason','project_paused'); END IF;
    IF v_status NOT IN('active','draft') THEN RETURN jsonb_build_object('kind','suppress','reason','project_inactive'); END IF;
    v_qualified:=true;
  END IF;
  v_qualified:=v_qualified OR coalesce(e.context->>'entry_source','') IN('referral','direct_outreach');
  IF v_uid IS NULL AND v_seq IN('cs_signup','cs_onboarded','cl_signup','cs_project','cl_project','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected','cs_connected','iv_connected','cl_contractor_pending','cs_client_pending') THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_unavailable');
  END IF;
  IF v_seq IN('cs_signup','cs_onboarded') AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text='contractor') THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_role_changed');
  END IF;
  IF v_seq='cl_signup' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text IN('contractor','admin','verifier')) THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_role_changed');
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT client_intent INTO v_intent FROM public.contractor_onboarding WHERE user_id=v_uid;
  END IF;
  IF v_seq IN('cs_signup','ci_onboarding') THEN
    IF v_uid IS NULL THEN v_kind:='suppress'; v_reason:='account_unavailable';
    ELSIF v_intent IS NOT NULL THEN v_kind:='complete'; v_reason:='onboarding_completed'; END IF;
  ELSIF v_seq='cs_onboarded' THEN
    IF EXISTS(SELECT 1 FROM public.projects WHERE user_id=v_uid) THEN v_kind:='complete'; v_reason:='project_created';
    ELSIF v_intent='no_client' THEN v_kind:='suppress'; v_reason:='no_active_project_selected'; END IF;
  ELSIF v_seq='cl_signup' THEN
    IF EXISTS(SELECT 1 FROM public.projects WHERE user_id=v_uid)
      OR EXISTS(SELECT 1 FROM public.project_viewers WHERE user_id=v_uid AND accepted_at IS NOT NULL AND revoked_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.contractor_invites WHERE contractor_user_id=v_uid AND status='accepted') THEN
      v_kind:='complete'; v_reason:='project_available';
    END IF;
  ELSIF v_seq IN('cs_project','cl_project') THEN
    IF v_project IS NULL THEN v_kind:='suppress'; v_reason:='project_missing';
    ELSIF v_seq='cs_project' THEN
      IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted' AND is_primary) THEN
        v_kind:='suppress'; v_reason:='project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL) THEN
        v_kind:='complete'; v_reason:='client_invited';
      END IF;
    ELSE
      IF NOT ((v_owner=v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted') AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL))
        OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)) THEN
        v_kind:='suppress'; v_reason:='project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND (status='accepted' OR (status='pending'))) THEN
        v_kind:='complete'; v_reason:='contractor_invited';
      ELSIF EXISTS(SELECT 1 FROM public.lifecycle_enrollments WHERE sequence_key='cl_support' AND email=e.email AND ref=e.ref AND status NOT IN('exited','suppressed')) THEN
        v_kind:='complete'; v_reason:='contractor_support_requested';
      END IF;
    END IF;
  END IF;

  IF v_seq IN('ci_invited','cl_contractor_pending','iv_invited','cs_client_pending','ci_onboarding','ci_connected_existing','ci_connected_new','iv_connected','cl_connected','cs_connected') THEN
    v_path:=coalesce(e.context->>'invite_path','');
    IF v_path ~* '^/(invite|share)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_token:=split_part(v_path,'/',3)::uuid; END IF;
    IF v_project IS NULL THEN v_kind:='suppress'; v_reason:='project_missing';
    ELSIF v_seq IN('ci_invited','cl_contractor_pending','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected') THEN
      SELECT status='accepted' AS accepted,status='rejected' AS revoked,
        email_status::text AS delivery,
        contractor_user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.contractor_invites
        WHERE project_id=v_project AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY created_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN('failed','bounced','complained') THEN v_kind:='suppress'; v_reason:='invitation_delivery_failed';
      ELSIF v_seq IN('ci_invited','cl_contractor_pending') AND v_invite.accepted THEN v_kind:='complete'; v_reason:='invitation_accepted';
      ELSIF v_seq='cl_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      ELSIF v_seq NOT IN('ci_invited','cl_contractor_pending','cl_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      END IF;
    ELSE
      SELECT accepted_at IS NOT NULL AS accepted,revoked_at IS NOT NULL AS revoked,
        email_status::text AS delivery,
        user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.project_viewers
        WHERE project_id=v_project AND is_client AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY invited_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN('failed','bounced','complained') THEN v_kind:='suppress'; v_reason:='invitation_delivery_failed';
      ELSIF v_seq IN('iv_invited','cs_client_pending') AND v_invite.accepted THEN v_kind:='complete'; v_reason:='invitation_accepted';
      ELSIF v_seq='cs_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      ELSIF v_seq NOT IN('iv_invited','cs_client_pending','cs_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      END IF;
    END IF;
  END IF;
  IF v_kind='ready' AND v_seq IN('cl_contractor_pending','cl_connected') AND NOT (
    (v_owner=v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted')
      AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)
  ) THEN v_kind:='suppress'; v_reason:='project_role_changed'; END IF;
  IF v_kind='ready' AND v_seq IN('cs_client_pending','cs_connected') AND NOT EXISTS(
    SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND is_primary AND status='accepted'
  ) THEN v_kind:='suppress'; v_reason:='project_role_changed'; END IF;
  RETURN jsonb_build_object('kind',v_kind,'reason',v_reason,'qualified',v_qualified,
    'operational',v_kind='suppress' AND v_reason IN('invitation_unavailable','invitation_delivery_failed','membership_unavailable'));
END $$;
REVOKE ALL ON FUNCTION public.lifecycle_action_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_action_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lifecycle_enrollment_state(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;e public.lifecycle_enrollments%ROWTYPE;s public.communication_settings%ROWTYPE;p public.communication_preferences%ROWTYPE;v_progress jsonb;
BEGIN
 v_state:=public.lifecycle_action_state(p_enrollment);
 IF v_state->>'kind'<>'ready' THEN RETURN v_state; END IF;
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
 IF e.sequence_key IN('cs_signup','ci_onboarding') THEN
  SELECT public.contractor_onboarding_status(id) INTO v_progress FROM auth.users WHERE lower(btrim(email))=lower(btrim(e.email));
 END IF;
 v_state:=v_state||jsonb_build_object('qualified',coalesce((v_state->>'qualified')::boolean,false)
  OR EXISTS(SELECT 1 FROM public.lifecycle_deliveries WHERE enrollment_id=e.id AND (opened_at IS NOT NULL OR clicked_at IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.communication_threads t JOIN public.communication_messages m ON m.thread_id=t.id WHERE t.enrollment_id=e.id AND m.direction='inbound' AND m.authenticated)
  OR (SELECT count(*)>=3 FROM jsonb_each(coalesce(v_progress->'steps','{}')) WHERE key IN('identity','professional','payout','emergency','agreements') AND value='true'::jsonb));
 SELECT * INTO p FROM public.communication_preferences WHERE email=lower(btrim(e.email));
 IF p.activation_unsubscribed OR p.blocked_reason IS NOT NULL THEN
  RETURN jsonb_build_object('kind','suppress','reason',coalesce(p.blocked_reason,'unsubscribed'));
 END IF;
 IF e.sequence_key='cs_onboarded' AND p.project_creation_paused THEN RETURN jsonb_build_object('kind','suppress','reason','no_active_project_selected'); END IF;
 -- An existing invitation outranks generic signup/project creation even if its
 -- email sequence is disabled, or its browser enrollment event was interrupted.
 IF e.sequence_key IN('cs_signup','cs_onboarded','cl_signup') AND (
  EXISTS(SELECT 1 FROM public.contractor_invites WHERE lower(btrim(email))=lower(btrim(e.email)) AND status IN('pending','accepted'))
  OR EXISTS(SELECT 1 FROM public.project_viewers WHERE lower(btrim(email))=lower(btrim(e.email)) AND is_client AND revoked_at IS NULL)
 ) THEN RETURN jsonb_build_object('kind','suppress','reason','invitation_context'); END IF;
 IF EXISTS(SELECT 1 FROM public.communication_threads WHERE enrollment_id=e.id AND automation_paused) THEN
  RETURN jsonb_build_object('kind','hold','reason','awaiting_staff_response');
 END IF;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT coalesce(s.delivery_enabled,false) THEN RETURN jsonb_build_object('kind','hold','reason','communications_paused'); END IF;
 IF cardinality(s.test_recipients)>0 AND NOT lower(btrim(e.email))=ANY(s.test_recipients) THEN
  RETURN jsonb_build_object('kind','hold','reason','outside_test_group');
 END IF;
 RETURN v_state;
END $$;
CREATE OR REPLACE FUNCTION public.reconcile_lifecycle_enrollment(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state jsonb; e public.lifecycle_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment FOR UPDATE;
  v_state:=public.lifecycle_enrollment_state(p_enrollment);
  IF v_state->>'kind' IN('complete','suppress') THEN
    UPDATE public.lifecycle_enrollments SET status=CASE WHEN v_state->>'kind'='complete' THEN 'exited' ELSE 'suppressed' END,
      exit_reason=v_state->>'reason',next_send_at=NULL,processing_token=NULL,processing_until=NULL WHERE id=e.id;
    UPDATE public.followup_queue SET status='done',resolved_at=now(),note='Auto-closed: '||(v_state->>'reason') WHERE enrollment_id=e.id AND status='open' AND kind='activation';
    IF coalesce((v_state->>'operational')::boolean,false) THEN
      INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,reason,priority,context,due_at)
        VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'Delivery review: '||(v_state->>'reason'),'high',e.context,now())
        ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,reason=EXCLUDED.reason,due_at=EXCLUDED.due_at;
    END IF;
  ELSIF v_state->>'kind'='hold' THEN
    UPDATE public.lifecycle_enrollments SET next_send_at=now()+interval '1 day',processing_token=NULL,processing_until=NULL WHERE id=e.id;
  END IF;
  RETURN v_state;
END $$;
REVOKE ALL ON FUNCTION public.lifecycle_enrollment_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_enrollment_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_communication_reply(p_thread uuid,p_body text,p_client_ref uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.communication_threads%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;s public.communication_settings%ROWTYPE;
 p public.communication_preferences%ROWTYPE;m public.communication_messages%ROWTYPE;v_parent public.communication_messages%ROWTYPE;v_id uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF p_client_ref IS NULL OR length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_message'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('communication_reply:'||p_client_ref::text,0));
 SELECT * INTO m FROM public.communication_messages WHERE client_ref=p_client_ref;
 IF FOUND THEN
  IF m.thread_id<>p_thread OR m.body<>btrim(p_body) OR m.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'message_reference_conflict'; END IF;
  RETURN m.id;
 END IF;
 SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t0 ON t0.enrollment_id=e0.id WHERE t0.id=p_thread FOR UPDATE OF e0;
 SELECT * INTO t FROM public.communication_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'thread_unavailable'; END IF;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT s.delivery_enabled OR s.sender_email IS NULL OR s.reply_domain IS NULL THEN RAISE EXCEPTION 'communications_paused'; END IF;
 IF cardinality(s.test_recipients)>0 AND NOT t.email=ANY(s.test_recipients) THEN RAISE EXCEPTION 'outside_test_group'; END IF;
 SELECT * INTO p FROM public.communication_preferences WHERE email=t.email;
 SELECT * INTO v_parent FROM public.communication_messages WHERE thread_id=t.id AND direction='inbound' AND authenticated ORDER BY created_at DESC LIMIT 1;
 IF p.blocked_reason IS NOT NULL OR (p.activation_unsubscribed AND v_parent.id IS NULL) THEN RAISE EXCEPTION 'recipient_unavailable'; END IF;
 INSERT INTO public.communication_messages(thread_id,direction,subject,body,actor_id,client_ref,status,in_reply_to,payload)
 VALUES(t.id,'outbound',left(regexp_replace(CASE WHEN v_parent.subject IS NULL OR v_parent.subject='' THEN 'Groundwork: '||coalesce(e.context->>'project_name','your account')
  WHEN v_parent.subject~*'^re:' THEN v_parent.subject ELSE 'Re: '||v_parent.subject END,E'[\r\n]',' ','g'),300),btrim(p_body),auth.uid(),p_client_ref,'queued',v_parent.provider_message_id,
  jsonb_build_object('to',t.email,'sender_name',s.sender_name,'sender_email',s.followup_sender_email,'reply_domain',s.reply_domain,'lang',e.lang,'preference_token',p.token)) RETURNING id INTO v_id;
 UPDATE public.communication_threads SET automation_paused=true,reply_domains=CASE WHEN s.reply_domain=ANY(reply_domains) THEN reply_domains ELSE array_append(reply_domains,s.reply_domain) END WHERE id=t.id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.queue_communication_reply(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_communication_reply(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.communication_delivery_attention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE;
BEGIN
 IF NEW.status='blocked' AND OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t ON t.enrollment_id=e0.id WHERE t.id=NEW.thread_id;
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at)
   VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'delivery','Delivery review: '||coalesce(NEW.last_error,'staff_reply_blocked'),'high',e.context,now())
   ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,kind='delivery',reason=EXCLUDED.reason,contact_status='needs_attention',due_at=now(),escalated_at=NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_blocked_delivery ON public.communication_messages;
CREATE TRIGGER communication_blocked_delivery AFTER UPDATE OF status ON public.communication_messages FOR EACH ROW EXECUTE FUNCTION public.communication_delivery_attention();
REVOKE ALL ON FUNCTION public.communication_delivery_attention() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_communication_reply(p_message uuid,p_payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_messages%ROWTYPE;p public.communication_preferences%ROWTYPE;s public.communication_settings%ROWTYPE;t public.communication_threads%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.communication_messages WHERE id=p_message AND direction='outbound' AND client_ref IS NOT NULL
  AND status IN('queued','failed','sending') AND next_attempt_at<=now() AND (processing_until IS NULL OR processing_until<=now()) FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.communication_threads WHERE id=m.thread_id;
 SELECT * INTO p FROM public.communication_preferences WHERE email=t.email;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT s.delivery_enabled OR (cardinality(s.test_recipients)>0 AND NOT t.email=ANY(s.test_recipients)) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=m.actor_id AND role='admin') THEN
  UPDATE public.communication_messages SET status='blocked',last_error='staff_role_changed' WHERE id=m.id;RETURN NULL;
 END IF;
 IF p.blocked_reason IS NOT NULL OR (p.activation_unsubscribed AND m.in_reply_to IS NULL) THEN
  UPDATE public.communication_messages SET status='blocked',last_error='recipient_unavailable' WHERE id=m.id;RETURN NULL;
 END IF;
 IF m.started_at<now()-interval '23 hours' THEN
  UPDATE public.communication_messages SET status='blocked',last_error='delivery_needs_review' WHERE id=m.id;RETURN NULL;
 END IF;
 -- The first call provides the frozen queued configuration to the worker. The
 -- second installs its exact wire payload before making any provider request.
 IF p_payload IS NULL THEN RETURN to_jsonb(m); END IF;
 IF m.started_at IS NULL THEN
  IF p_payload->>'to' IS DISTINCT FROM t.email OR p_payload->>'text' IS NULL OR p_payload->>'subject' IS DISTINCT FROM m.subject THEN RAISE EXCEPTION 'invalid_message_payload'; END IF;
  UPDATE public.communication_messages SET payload=p_payload,started_at=now() WHERE id=m.id;
 END IF;
 UPDATE public.communication_messages SET status='sending',worker_token=gen_random_uuid(),processing_until=now()+interval '5 minutes' WHERE id=m.id RETURNING * INTO m;
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.finish_communication_reply(p_message uuid,p_token uuid,p_ok boolean,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_messages%ROWTYPE;s public.communication_settings%ROWTYPE;t public.communication_threads%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.communication_messages WHERE id=p_message AND worker_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO t FROM public.communication_threads WHERE id=m.thread_id;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 UPDATE public.communication_messages SET status=CASE WHEN status IN('sent','delivered','bounced','complained') THEN status WHEN p_ok THEN 'sent' ELSE 'failed' END,provider_id=coalesce(p_provider_id,provider_id),
  last_error=CASE WHEN p_ok OR status IN('sent','delivered','bounced','complained') THEN NULL ELSE p_error END,processing_until=NULL,worker_token=NULL,next_attempt_at=now()+interval '15 minutes' WHERE id=m.id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.communication_staff_send_recorded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enrollment uuid;v_hours int;
BEGIN
 IF NEW.direction='outbound' AND NEW.client_ref IS NOT NULL AND NEW.actor_id IS NOT NULL AND NEW.status IN('sent','delivered') AND OLD.sent_at IS NULL THEN
  NEW.sent_at:=now();
  UPDATE public.communication_threads SET last_message_at=now(),last_outbound_at=now() WHERE id=NEW.thread_id RETURNING enrollment_id INTO v_enrollment;
  SELECT next_contact_hours INTO v_hours FROM public.communication_settings WHERE id;
  UPDATE public.followup_queue SET contact_status='awaiting_reply',last_contacted_at=now(),attempt_count=attempt_count+1,
   due_at=now()+v_hours*interval '1 hour',escalated_at=NULL WHERE enrollment_id=v_enrollment AND status='open';
  INSERT INTO public.communication_followup_events(followup_id,actor_id,kind,note,due_at)
   SELECT id,NEW.actor_id,'email_sent','Staff reply sent',due_at FROM public.followup_queue WHERE enrollment_id=v_enrollment AND status='open';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_staff_send_history ON public.communication_messages;
CREATE TRIGGER communication_staff_send_history BEFORE UPDATE OF status ON public.communication_messages FOR EACH ROW EXECUTE FUNCTION public.communication_staff_send_recorded();
REVOKE ALL ON FUNCTION public.communication_staff_send_recorded() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_communication_inbound(p_provider_id text,p_thread uuid,p_sender text,p_subject text,p_body text,p_message_id text,p_authenticated boolean,p_received_at timestamptz,p_attachments int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.communication_threads%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;v_id uuid;v_at timestamptz;
BEGIN
 IF EXISTS(SELECT 1 FROM public.communication_messages WHERE provider_id=p_provider_id) THEN RETURN jsonb_build_object('duplicate',true); END IF;
 IF p_provider_id IS NULL OR length(p_provider_id)>200 OR length(coalesce(p_body,''))>30000 OR length(coalesce(p_subject,''))>300 THEN RAISE EXCEPTION 'invalid_inbound'; END IF;
 SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t0 ON t0.enrollment_id=e0.id WHERE t0.id=p_thread FOR UPDATE OF e0;
 SELECT * INTO t FROM public.communication_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.email IS DISTINCT FROM lower(btrim(p_sender)) THEN RETURN jsonb_build_object('ignored',true,'reason','sender_or_thread_mismatch'); END IF;
 v_at:=least(coalesce(p_received_at,now()),now());
 INSERT INTO public.communication_messages(thread_id,direction,provider_id,provider_message_id,subject,body,authenticated,status,attachment_count,created_at)
 VALUES(t.id,'inbound',p_provider_id,left(p_message_id,500),coalesce(p_subject,''),coalesce(p_body,''),coalesce(p_authenticated,false),'received',greatest(0,p_attachments),v_at)
 ON CONFLICT(provider_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN jsonb_build_object('duplicate',true); END IF;
 UPDATE public.communication_threads SET last_message_at=greatest(last_message_at,v_at),last_inbound_at=greatest(last_inbound_at,v_at),
  automation_paused=automation_paused OR coalesce(p_authenticated,false) WHERE id=t.id;
 IF p_authenticated THEN
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at,contact_status)
  VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'reply','User replied and needs assistance','high',e.context,now(),'needs_attention')
  ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,
   kind=CASE WHEN followup_queue.status='open' THEN followup_queue.kind ELSE 'reply' END,
   reason='User replied and needs assistance',priority='high',contact_status='needs_attention',due_at=now(),escalated_at=NULL;
 END IF;
 RETURN jsonb_build_object('received',true,'authenticated',coalesce(p_authenticated,false));
END $$;

CREATE OR REPLACE FUNCTION public.record_communication_email_event(p_provider_id text,p_event text,p_at timestamptz,p_enrollment uuid DEFAULT NULL,p_position int DEFAULT NULL,p_message uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;v_enrollment uuid;v_status text;v_at timestamptz:=least(coalesce(p_at,now()),now());e public.lifecycle_enrollments%ROWTYPE;
BEGIN
 IF p_event NOT IN('sent','delivered','bounced','complained','failed','opened','clicked') THEN RETURN; END IF;
 -- Correlate signed provider tags when a webhook wins the race with the send's
 -- HTTP response. A later worker finish retains the already-received verdict.
 IF p_message IS NOT NULL THEN
  UPDATE public.communication_messages SET provider_id=p_provider_id WHERE id=p_message AND direction='outbound' AND started_at IS NOT NULL AND provider_id IS NULL;
 ELSIF p_enrollment IS NOT NULL AND p_position IS NOT NULL THEN
  UPDATE public.lifecycle_deliveries SET provider_id=p_provider_id WHERE enrollment_id=p_enrollment AND position=p_position AND provider_id IS NULL;
 END IF;
 SELECT t.email,t.enrollment_id INTO v_email,v_enrollment FROM public.communication_messages m JOIN public.communication_threads t ON t.id=m.thread_id WHERE m.provider_id=p_provider_id;
 IF v_email IS NULL THEN SELECT e0.email,e0.id INTO v_email,v_enrollment FROM public.lifecycle_deliveries d JOIN public.lifecycle_enrollments e0 ON e0.id=d.enrollment_id WHERE d.provider_id=p_provider_id; END IF;
 IF v_email IS NULL THEN RETURN; END IF;
 v_status:=CASE WHEN p_event='failed' THEN 'failed' ELSE p_event END;
 IF p_event IN('sent','delivered','bounced','complained','failed') THEN
  UPDATE public.communication_messages SET status=v_status,provider_event_at=v_at
   WHERE provider_id=p_provider_id AND (provider_event_at IS NULL OR provider_event_at<=v_at)
   AND (status NOT IN('bounced','complained') OR p_event IN('bounced','complained')) AND (status<>'delivered' OR p_event<>'sent');
  UPDATE public.lifecycle_deliveries SET delivery_status=v_status,delivery_updated_at=v_at
   WHERE provider_id=p_provider_id AND (delivery_updated_at IS NULL OR delivery_updated_at<=v_at)
   AND (coalesce(delivery_status,'') NOT IN('bounced','complained') OR p_event IN('bounced','complained')) AND (coalesce(delivery_status,'')<>'delivered' OR p_event<>'sent');
 ELSE
  UPDATE public.lifecycle_deliveries SET opened_at=CASE WHEN p_event='opened' THEN coalesce(opened_at,v_at) ELSE opened_at END,
   clicked_at=CASE WHEN p_event='clicked' THEN coalesce(clicked_at,v_at) ELSE clicked_at END WHERE provider_id=p_provider_id;
 END IF;
 IF p_event IN('bounced','complained','failed') THEN
  INSERT INTO public.communication_preferences(email,blocked_reason) VALUES(lower(btrim(v_email)),CASE WHEN p_event='failed' THEN 'delivery_failed' ELSE p_event END)
  ON CONFLICT(email) DO UPDATE SET blocked_reason=CASE WHEN communication_preferences.blocked_reason='complained' THEN 'complained' ELSE EXCLUDED.blocked_reason END,updated_at=now();
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=v_enrollment;
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at)
   VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'delivery','Delivery review: '||p_event,'high',e.context,now())
   ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,kind='delivery',reason=EXCLUDED.reason,contact_status='needs_attention',due_at=now();
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.review_communication_followups()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.followup_queue%ROWTYPE;v_state jsonb;v_closed int:=0;v_overdue int:=0;
BEGIN
 FOR f IN SELECT * FROM public.followup_queue WHERE status='open' ORDER BY last_reviewed_at NULLS FIRST,created_at FOR UPDATE SKIP LOCKED LIMIT 200 LOOP
  UPDATE public.followup_queue SET last_reviewed_at=now() WHERE id=f.id;
  IF f.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=f.owner_id AND role='admin') THEN
   UPDATE public.followup_queue SET owner_id=(SELECT s.default_owner_id FROM public.communication_settings s WHERE s.id AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=s.default_owner_id AND role='admin'))
    WHERE id=f.id;
  END IF;
  v_state:=public.lifecycle_enrollment_state(f.enrollment_id);
  IF f.kind='activation' AND v_state->>'kind' IN('complete','suppress') THEN
   UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Action reconciled: '||(v_state->>'reason')) WHERE id=f.id;
   v_closed:=v_closed+1;
  ELSIF f.due_at<=now() AND f.escalated_at IS NULL THEN
   UPDATE public.followup_queue SET contact_status='needs_attention',escalated_at=now() WHERE id=f.id;
   INSERT INTO public.communication_followup_events(followup_id,kind,note,due_at) VALUES(f.id,'overdue','Next contact is due',f.due_at) ON CONFLICT DO NOTHING;
   v_overdue:=v_overdue+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('resolved',v_closed,'overdue',v_overdue);
END $$;

CREATE OR REPLACE FUNCTION public.mirror_lifecycle_communication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread uuid;v_status text;
BEGIN
 IF NEW.status<>'sent' OR NEW.provider_id IS NULL THEN RETURN NULL; END IF;
 SELECT id INTO v_thread FROM public.communication_threads WHERE enrollment_id=NEW.enrollment_id;
 IF v_thread IS NULL THEN RETURN NULL; END IF;
 v_status:=CASE WHEN NEW.delivery_status IN('delivered','bounced','complained','failed') THEN NEW.delivery_status ELSE 'sent' END;
 INSERT INTO public.communication_messages(thread_id,direction,provider_id,subject,body,status,provider_event_at,created_at)
 VALUES(v_thread,'outbound',NEW.provider_id,left(coalesce(NEW.payload->>'subject',''),300),left(coalesce(NEW.payload->>'text',''),30000),v_status,NEW.delivery_updated_at,NEW.started_at)
 ON CONFLICT(provider_id) DO UPDATE SET status=CASE WHEN communication_messages.status IN('bounced','complained') THEN communication_messages.status ELSE EXCLUDED.status END,
  provider_event_at=greatest(communication_messages.provider_event_at,EXCLUDED.provider_event_at);
 UPDATE public.communication_threads SET last_message_at=greatest(last_message_at,NEW.started_at),last_outbound_at=greatest(last_outbound_at,NEW.started_at) WHERE id=v_thread;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS lifecycle_communication_history ON public.lifecycle_deliveries;
CREATE TRIGGER lifecycle_communication_history AFTER UPDATE OF status,provider_id,delivery_status ON public.lifecycle_deliveries FOR EACH ROW EXECUTE FUNCTION public.mirror_lifecycle_communication();
REVOKE ALL ON FUNCTION public.mirror_lifecycle_communication() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_communication_followup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient record;
BEGIN
 IF NEW.status<>'open' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id AND NEW.escalated_at IS NOT DISTINCT FROM OLD.escalated_at
  AND NOT (NEW.contact_status='needs_attention' AND NEW.contact_status IS DISTINCT FROM OLD.contact_status) THEN RETURN NULL; END IF;
 FOR recipient IN SELECT DISTINCT r.user_id,p.preferred_lang FROM public.user_roles r LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.role='admin' AND (NEW.owner_id IS NULL OR r.user_id=NEW.owner_id) LOOP
  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(recipient.user_id,'communication_followup',
   CASE WHEN recipient.preferred_lang='fr' THEN 'Suivi Groundwork à effectuer' ELSE 'Groundwork follow-up needs attention' END,
   CASE WHEN recipient.preferred_lang='fr' THEN 'Une tâche de suivi vous attend dans Communications.' ELSE 'A follow-up task is waiting in Communications.' END,
   jsonb_build_object('communication_followup_id',NEW.id));
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS communication_followup_notification ON public.followup_queue;
CREATE TRIGGER communication_followup_notification AFTER INSERT OR UPDATE OF owner_id,contact_status,escalated_at ON public.followup_queue FOR EACH ROW EXECUTE FUNCTION public.notify_communication_followup();
REVOKE ALL ON FUNCTION public.notify_communication_followup() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.prepare_communication_reply(uuid,jsonb),public.finish_communication_reply(uuid,uuid,boolean,text,text),public.record_communication_inbound(text,uuid,text,text,text,text,boolean,timestamptz,int),public.record_communication_email_event(text,text,timestamptz,uuid,int,uuid),public.review_communication_followups() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_communication_reply(uuid,jsonb),public.finish_communication_reply(uuid,uuid,boolean,text,text),public.record_communication_inbound(text,uuid,text,text,text,text,boolean,timestamptz,int),public.record_communication_email_event(text,text,timestamptz,uuid,int,uuid),public.review_communication_followups() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
