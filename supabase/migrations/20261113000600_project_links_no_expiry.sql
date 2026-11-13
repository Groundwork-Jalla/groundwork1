-- Project invitations remain usable until claimed or explicitly revoked.
-- Keep historical expiry columns for schema compatibility; do not restore removed
-- participants or rejected invitations.
BEGIN;
ALTER TABLE public.project_viewers DROP CONSTRAINT IF EXISTS viewer_invitation_identity;
ALTER TABLE public.project_viewers ADD CONSTRAINT viewer_invitation_identity CHECK(email IS NOT NULL OR (is_share_link AND accepted_at IS NULL));
ALTER TABLE public.contractor_invites DROP CONSTRAINT IF EXISTS contractor_invitation_identity;
ALTER TABLE public.contractor_invites ADD CONSTRAINT contractor_invitation_identity CHECK(email IS NOT NULL OR (is_share_link AND status<>'accepted'));
UPDATE public.project_viewers SET expires_at=NULL WHERE is_share_link AND revoked_at IS NULL;
UPDATE public.contractor_invites SET expires_at=NULL WHERE is_share_link AND status IN('pending','accepted');
CREATE OR REPLACE FUNCTION public.expire_project_invitation_links(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN; END $$;


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
    'has_client_invitation',v_named_client,'has_contractor',v_contractor,'has_pending_contractor',v_pending,
    'can_change_roles',public.is_admin(),
    'needs_primary_review',v_contractor AND NOT EXISTS(SELECT 1 FROM public.contractor_invites
      WHERE project_id=p_project AND status='accepted' AND is_primary));
END $$;

CREATE OR REPLACE FUNCTION public.create_project_invitation_link(p_project uuid,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_access jsonb; v_token uuid; v_id uuid; v_expires timestamptz; v_created boolean:=false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND OR NOT public.can_invite_project_people(p_project) THEN RAISE EXCEPTION 'not_permitted'; END IF;
  IF p_role IS NULL OR p_role NOT IN('client','contractor','observer') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  PERFORM public.expire_project_invitation_links(p_project);
  v_access:=public.project_team_access(p_project);
  IF p_role='contractor' THEN
    IF NOT coalesce((v_access->>'primary_client')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
    SELECT id,token,expires_at INTO v_id,v_token,v_expires FROM public.contractor_invites
      WHERE project_id=p_project AND is_share_link AND status='pending' LIMIT 1;
    IF v_id IS NULL THEN
      IF NOT coalesce((v_access->>'can_invite_contractor')::boolean,false) THEN RAISE EXCEPTION 'contractor_invitation_pending'; END IF;
      v_created:=true;
      INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,primary_on_acceptance,is_share_link,expires_at)
        VALUES(p_project,auth.uid(),NULL,'contractor','pending',true,true,NULL)
        RETURNING id,token,expires_at INTO v_id,v_token,v_expires;
    END IF;
  ELSE
    IF p_role='client' AND NOT coalesce((v_access->>'primary_contractor')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
    SELECT id,token,expires_at INTO v_id,v_token,v_expires FROM public.project_viewers
      WHERE project_id=p_project AND is_share_link AND is_client=(p_role='client')
        AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY invited_at DESC LIMIT 1;
    IF v_id IS NULL THEN
      IF p_role='client' AND NOT coalesce((v_access->>'can_invite_client')::boolean,false) THEN RAISE EXCEPTION 'role_change_requires_admin'; END IF;
      v_created:=true;
      INSERT INTO public.project_viewers(project_id,email,invited_by,is_client,is_share_link,expires_at)
        VALUES(p_project,NULL,auth.uid(),p_role='client',true,NULL)
        RETURNING id,token,expires_at INTO v_id,v_token,v_expires;
    END IF;
  END IF;
  IF v_created THEN
    PERFORM public.log_activity(p_project,'project.link_created',NULL,NULL,auth.uid(),jsonb_build_object('invitation_id',v_id,'role',p_role,'expires_at',v_expires));
  END IF;
  RETURN jsonb_build_object('id',v_id,'token',v_token,'role',p_role,'expires_at',v_expires);
END $$;

CREATE OR REPLACE FUNCTION public.accept_project_viewer(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_project uuid; v_email text; v public.project_viewers%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.project_viewers WHERE token=p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.project_viewers WHERE token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF v.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v.accepted_at IS NOT NULL THEN
    IF v.user_id=v_actor THEN RETURN v.project_id; END IF;
    RAISE EXCEPTION 'already_accepted';
  END IF;
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=v_actor AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    IF v.is_share_link THEN RAISE EXCEPTION 'invitation_email_unverified'; END IF;
    RAISE EXCEPTION 'invite_email_mismatch';
  END IF;
  IF v.is_share_link THEN
    IF public.project_member(v_project) THEN RAISE EXCEPTION 'already_member'; END IF;
    IF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND id<>v.id AND revoked_at IS NULL AND lower(email)=v_email) THEN
      RAISE EXCEPTION 'invitation_pending';
    END IF;
  ELSIF v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
  UPDATE public.project_viewers SET user_id=v_actor,accepted_at=now(),email=CASE WHEN v.is_share_link THEN v_email ELSE email END WHERE id=v.id;
  PERFORM public.log_activity(v.project_id,'project.viewer_accepted',NULL,NULL,v_actor,jsonb_build_object('email',v_email,'is_client',v.is_client,'is_share_link',v.is_share_link));
  RETURN v.project_id;
END $$;

CREATE OR REPLACE FUNCTION public.accept_contractor_invite(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_project uuid; v_email text; v public.contractor_invites%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.contractor_invites WHERE token=p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_invalid'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.contractor_invites WHERE token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_invalid'; END IF;
  IF v.status='accepted' THEN
    IF v.contractor_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'invite_invalid: another account accepted'; END IF;
  ELSE
    IF v.status<>'pending' THEN RAISE EXCEPTION 'invite_invalid'; END IF;
    SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=v_actor AND email_confirmed_at IS NOT NULL;
    IF v_email IS NULL THEN
      IF v.is_share_link THEN RAISE EXCEPTION 'invitation_email_unverified'; END IF;
      RAISE EXCEPTION 'invite_email_mismatch';
    END IF;
    IF v.is_share_link THEN
      IF public.project_member(v_project) THEN RAISE EXCEPTION 'already_member'; END IF;
      IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND id<>v.id AND lower(email)=v_email) THEN
        RAISE EXCEPTION 'invitation_pending';
      END IF;
    ELSIF v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
    IF v.primary_on_acceptance AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND is_primary AND id<>v.id) THEN
      RAISE EXCEPTION 'assignment_changed: ask Groundwork to review this invitation';
    END IF;
    UPDATE public.contractor_invites SET status='accepted',accepted_at=now(),contractor_user_id=v_actor,
      email=CASE WHEN v.is_share_link THEN v_email ELSE email END,
      is_primary=CASE WHEN v.primary_on_acceptance THEN true ELSE is_primary END WHERE id=v.id;
  END IF;
  INSERT INTO public.user_roles(user_id,role) VALUES(v_actor,'contractor') ON CONFLICT(user_id,role) DO NOTHING;
  RETURN v_project;
END $$;

-- A claimed link can only be reopened by its claimant. Anonymous previews show
-- the project, inviter and intended role, without claiming access or financial data.
CREATE OR REPLACE FUNCTION public.project_viewer_preview(p_token uuid)
RETURNS TABLE(project_name text,invited_by_name text,accepted boolean,is_client boolean,is_share_link boolean,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.name,coalesce(nullif(btrim(o.full_name),''),'Someone on Groundwork'),
    v.accepted_at IS NOT NULL,v.is_client,v.is_share_link,v.expires_at
  FROM public.project_viewers v JOIN public.projects p ON p.id=v.project_id
  LEFT JOIN public.profiles o ON o.id=v.invited_by
  WHERE v.token=p_token AND v.revoked_at IS NULL
    AND (v.accepted_at IS NULL OR v.user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.project_viewer_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_viewer_preview(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token uuid)
RETURNS TABLE(project_id uuid,invite_email text,status text,project_name text,inviter_name text,is_share_link boolean,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.id,ci.email,ci.status,p.name,coalesce(nullif(btrim(o.full_name),''),'Someone on Groundwork'),ci.is_share_link,ci.expires_at
  FROM public.contractor_invites ci JOIN public.projects p ON p.id=ci.project_id
  LEFT JOIN public.profiles o ON o.id=ci.invited_by
  WHERE ci.token=p_token AND ci.status IN('pending','accepted')
    AND (ci.status='pending' OR ci.contractor_user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon,authenticated;



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

REVOKE ALL ON FUNCTION public.lifecycle_enrollment_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_enrollment_state(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
