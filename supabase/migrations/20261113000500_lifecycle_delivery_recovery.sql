-- Incremental recovery for databases that already have the earlier delivery RPCs.
-- Keep existing snapshots, add worker ownership, and install the final progress /
-- language / role checks. This does not enable sequences or send messages.
BEGIN;
ALTER TABLE public.lifecycle_deliveries ADD COLUMN IF NOT EXISTS worker_token uuid;

CREATE OR REPLACE FUNCTION public.lifecycle_enrollment_state(p_enrollment uuid)
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
    IF v_status='paused' THEN RETURN jsonb_build_object('kind','hold','reason','project_paused'); END IF;
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
  IF v_seq='cl_signup' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text='contractor') THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_role_changed');
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT client_intent INTO v_intent FROM public.contractor_onboarding WHERE user_id=v_uid;
  END IF;
  IF v_seq IN('cs_signup','ci_onboarding') THEN
    IF v_uid IS NULL THEN v_kind:='suppress'; v_reason:='account_unavailable';
    ELSIF v_intent IS NOT NULL THEN v_kind:='complete'; v_reason:='onboarding_completed'; END IF;
  ELSIF v_seq='cs_onboarded' THEN
    IF v_intent='no_client' THEN v_kind:='suppress'; v_reason:='no_active_project_selected';
    ELSIF EXISTS(SELECT 1 FROM public.projects WHERE user_id=v_uid) THEN v_kind:='complete'; v_reason:='project_created'; END IF;
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
      ELSIF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL AND (accepted_at IS NOT NULL OR NOT is_share_link OR expires_at>now())) THEN
        v_kind:='complete'; v_reason:='client_invited';
      END IF;
    ELSE
      IF NOT ((v_owner=v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted') AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL))
        OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)) THEN
        v_kind:='suppress'; v_reason:='project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND (status='accepted' OR (status='pending' AND (NOT is_share_link OR expires_at>now())))) THEN
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
        is_share_link AND expires_at<=now() AS expired,email_status::text AS delivery,
        contractor_user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.contractor_invites
        WHERE project_id=v_project AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY created_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked OR (NOT v_invite.accepted AND v_invite.expired) THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN('failed','bounced','complained') THEN v_kind:='suppress'; v_reason:='invitation_delivery_failed';
      ELSIF v_seq IN('ci_invited','cl_contractor_pending') AND v_invite.accepted THEN v_kind:='complete'; v_reason:='invitation_accepted';
      ELSIF v_seq='cl_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      ELSIF v_seq NOT IN('ci_invited','cl_contractor_pending','cl_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      END IF;
    ELSE
      SELECT accepted_at IS NOT NULL AS accepted,revoked_at IS NOT NULL AS revoked,
        is_share_link AND expires_at<=now() AS expired,email_status::text AS delivery,
        user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.project_viewers
        WHERE project_id=v_project AND is_client AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY invited_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked OR (NOT v_invite.accepted AND v_invite.expired) THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
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

CREATE OR REPLACE FUNCTION public.reconcile_lifecycle_enrollment(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state jsonb; e public.lifecycle_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment FOR UPDATE;
  v_state:=public.lifecycle_enrollment_state(p_enrollment);
  IF v_state->>'kind' IN('complete','suppress') THEN
    UPDATE public.lifecycle_enrollments SET status=CASE WHEN v_state->>'kind'='complete' THEN 'exited' ELSE 'suppressed' END,
      exit_reason=v_state->>'reason',next_send_at=NULL,processing_token=NULL,processing_until=NULL WHERE id=e.id;
    UPDATE public.followup_queue SET status='done',resolved_at=now(),note='Auto-closed: '||(v_state->>'reason') WHERE enrollment_id=e.id AND status='open';
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

CREATE OR REPLACE FUNCTION public.claim_lifecycle_enrollment(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE; v_state jsonb;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment AND status='active' AND next_send_at<=now()
    AND (processing_until IS NULL OR processing_until<=now()) FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key=e.sequence_key AND enabled) THEN RETURN NULL; END IF;
  v_state:=public.reconcile_lifecycle_enrollment(e.id);
  IF v_state->>'kind'<>'ready' THEN RETURN NULL; END IF;
  UPDATE public.lifecycle_enrollments SET processing_token=gen_random_uuid(),processing_until=now()+interval '5 minutes',
    lang=coalesce((SELECT p.preferred_lang FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE lower(btrim(u.email))=lower(btrim(e.email)) LIMIT 1),lang)
    WHERE id=e.id RETURNING * INTO e;
  RETURN to_jsonb(e);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_lifecycle_delivery(p_enrollment uuid,p_token uuid,p_position int,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE; d public.lifecycle_deliveries%ROWTYPE; v_state jsonb;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment AND status='active' AND processing_token=p_token AND processing_until>now() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key=e.sequence_key AND enabled) THEN RETURN NULL; END IF;
  v_state:=public.reconcile_lifecycle_enrollment(e.id);
  IF v_state->>'kind'<>'ready' OR p_position<e.next_position THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.lifecycle_sends WHERE enrollment_id=e.id AND position=p_position AND status='sent') THEN RETURN jsonb_build_object('status','sent'); END IF;
  INSERT INTO public.lifecycle_deliveries(enrollment_id,position,payload) VALUES(e.id,p_position,p_payload) ON CONFLICT DO NOTHING;
  SELECT * INTO d FROM public.lifecycle_deliveries WHERE enrollment_id=e.id AND position=p_position FOR UPDATE;
  -- Provider idempotency lasts 24h. Never resend an unconfirmed delivery after that
  -- protection could lapse, or change the body associated with a prior attempt.
  IF d.status<>'sent' AND d.started_at<now()-interval '23 hours' THEN
    UPDATE public.lifecycle_deliveries SET status='blocked',last_error='delivery_needs_review' WHERE enrollment_id=e.id AND position=p_position;
    UPDATE public.lifecycle_enrollments SET status='suppressed',exit_reason='delivery_needs_review',next_send_at=NULL,processing_token=NULL,processing_until=NULL WHERE id=e.id;
    INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,reason,priority,context,due_at)
      VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'Delivery review: outcome unconfirmed; check provider before retry','high',e.context,now())
      ON CONFLICT(enrollment_id) DO NOTHING;
    RETURN jsonb_build_object('status','blocked');
  END IF;
  UPDATE public.lifecycle_deliveries SET worker_token=p_token WHERE enrollment_id=e.id AND position=p_position RETURNING * INTO d;
  RETURN to_jsonb(d);
END $$;

CREATE OR REPLACE FUNCTION public.finish_lifecycle_delivery(p_enrollment uuid,p_token uuid,p_position int,p_outcome text,p_error text DEFAULT NULL,p_provider_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE; s public.lifecycle_sequences%ROWTYPE;
  v_step public.lifecycle_sequence_steps%ROWTYPE; v_next int; v_hours int; v_state jsonb; v_sent boolean:=false; v_current boolean;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_current:=e.status='active' AND e.processing_token IS NOT DISTINCT FROM p_token AND e.processing_until>now() AND p_position>=e.next_position;
  -- A completed action can cancel the enrollment while the provider is answering.
  -- Retain that real send in history without reopening or advancing the enrollment.
  IF NOT coalesce(v_current,false) AND (p_outcome<>'sent' OR NOT EXISTS(
    SELECT 1 FROM public.lifecycle_deliveries WHERE enrollment_id=e.id AND position=p_position AND worker_token=p_token
  )) THEN RETURN false; END IF;
  SELECT * INTO s FROM public.lifecycle_sequences WHERE key=e.sequence_key;
  IF p_outcome NOT IN('sent','failed','skipped','complete') THEN RAISE EXCEPTION 'invalid_delivery_outcome'; END IF;
  SELECT * INTO v_step FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position=p_position;
  IF p_outcome<>'complete' THEN
    IF v_step.id IS NULL THEN RAISE EXCEPTION 'invalid_delivery_step'; END IF;
    IF p_outcome IN('sent','failed','skipped') THEN
      UPDATE public.lifecycle_deliveries SET status=p_outcome,provider_id=coalesce(p_provider_id,provider_id),last_error=p_error WHERE enrollment_id=e.id AND position=p_position;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.lifecycle_sends WHERE enrollment_id=e.id AND position=p_position AND status='sent') THEN
      INSERT INTO public.lifecycle_sends(enrollment_id,sequence_key,position,email,channel,status,error,step_code,subject)
        SELECT e.id,e.sequence_key,p_position,e.email,v_step.channel,p_outcome,p_error,v_step.code,d.payload->>'subject'
        FROM (SELECT 1) stub LEFT JOIN public.lifecycle_deliveries d ON d.enrollment_id=e.id AND d.position=p_position;
      v_sent:=p_outcome='sent';
    END IF;
  END IF;
  IF NOT coalesce(v_current,false) THEN
    IF v_sent THEN
      UPDATE public.lifecycle_enrollments SET last_sent_at=now(),last_step_code=v_step.code,
        emails_sent=emails_sent+CASE WHEN v_step.channel='email' THEN 1 ELSE 0 END WHERE id=e.id;
    END IF;
    RETURN v_sent;
  END IF;
  IF p_outcome='failed' THEN
    UPDATE public.lifecycle_enrollments SET processing_token=NULL,processing_until=NULL,next_send_at=now()+interval '1 hour' WHERE id=e.id;
    RETURN true;
  END IF;
  IF p_outcome='complete' THEN
    SELECT min(position) INTO v_next FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position>=e.next_position;
    IF v_next IS NOT NULL THEN
      SELECT sum(delay_hours) INTO v_hours FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position<=v_next;
      UPDATE public.lifecycle_enrollments SET next_send_at=e.enrolled_at+v_hours*interval '1 hour',processing_token=NULL,processing_until=NULL WHERE id=e.id;
      RETURN false;
    END IF;
    v_state:=public.reconcile_lifecycle_enrollment(e.id);
    IF v_state->>'kind'<>'ready' THEN RETURN true; END IF;
    IF s.followup_after_days IS NOT NULL AND e.enrolled_at+s.followup_after_days*interval '1 day'>now() THEN
      UPDATE public.lifecycle_enrollments SET next_send_at=e.enrolled_at+s.followup_after_days*interval '1 day',processing_token=NULL,processing_until=NULL WHERE id=e.id;
      RETURN false;
    END IF;
    IF s.followup_after_days IS NOT NULL AND coalesce((v_state->>'qualified')::boolean,false) THEN
      INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,reason,priority,context,due_at)
        VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'No action after Day '||s.followup_after_days||': '||s.awaiting_action,
          CASE WHEN e.context->>'project_id' IS NOT NULL OR e.context->>'entry_source' IN('referral','direct_outreach') THEN 'high' ELSE 'normal' END,e.context,now()+interval '1 day')
        ON CONFLICT(enrollment_id) DO NOTHING;
    END IF;
    UPDATE public.lifecycle_enrollments SET status='completed',next_send_at=NULL,processing_token=NULL,processing_until=NULL,
      followup_queued=s.followup_after_days IS NOT NULL AND coalesce((v_state->>'qualified')::boolean,false) WHERE id=e.id;
    RETURN true;
  END IF;
  SELECT min(position) INTO v_next FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position>p_position;
  SELECT coalesce(sum(delay_hours),0) INTO v_hours FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position<=v_next;
  UPDATE public.lifecycle_enrollments SET
    processing_token=NULL,processing_until=NULL,
    last_sent_at=CASE WHEN v_sent THEN now() ELSE last_sent_at END,
    last_step_code=CASE WHEN v_sent THEN v_step.code ELSE last_step_code END,
    emails_sent=emails_sent+CASE WHEN v_sent AND v_step.channel='email' THEN 1 ELSE 0 END,
    status=CASE WHEN v_next IS NULL AND s.followup_after_days IS NULL THEN 'completed' ELSE 'active' END,
    next_position=coalesce(v_next,p_position+1),
    next_send_at=CASE WHEN v_next IS NOT NULL THEN e.enrolled_at+v_hours*interval '1 hour'
      WHEN s.followup_after_days IS NOT NULL THEN greatest(e.enrolled_at+s.followup_after_days*interval '1 day',now()) ELSE NULL END
    WHERE id=e.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.lifecycle_enrollment_state(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_lifecycle_enrollment(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_lifecycle_enrollment(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_lifecycle_delivery(uuid,uuid,int,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_lifecycle_delivery(uuid,uuid,int,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_enrollment_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_lifecycle_enrollment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_lifecycle_delivery(uuid,uuid,int,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_lifecycle_delivery(uuid,uuid,int,text,text,text) TO service_role;
COMMIT;
