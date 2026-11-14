-- Choose the project role before creating a link. Additional contractors never replace the primary contractor.
BEGIN;
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
    'can_change_roles',public.is_admin(),
    'needs_primary_review',v_contractor AND NOT EXISTS(SELECT 1 FROM public.contractor_invites
      WHERE project_id=p_project AND status='accepted' AND is_primary));
END $$;
CREATE OR REPLACE FUNCTION public.create_project_invitation_link(p_project uuid,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_access jsonb; v_token uuid; v_id uuid; v_expires timestamptz; v_created boolean:=false; v_initial boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND OR NOT public.can_invite_project_people(p_project) THEN RAISE EXCEPTION 'not_permitted'; END IF;
  IF p_role IS NULL OR p_role NOT IN('client','contractor','observer') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  PERFORM public.expire_project_invitation_links(p_project);
  v_access:=public.project_team_access(p_project);
  IF p_role='contractor' THEN
    v_initial:=NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted' AND is_primary);
    IF v_initial AND NOT coalesce((v_access->>'primary_client')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
    IF NOT v_initial AND NOT coalesce((v_access->>'can_invite_additional_contractor')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
    SELECT id,token,expires_at INTO v_id,v_token,v_expires FROM public.contractor_invites
      WHERE project_id=p_project AND is_share_link AND status='pending' AND primary_on_acceptance=v_initial ORDER BY created_at DESC,id LIMIT 1;
    IF v_id IS NULL THEN
      IF v_initial AND NOT coalesce((v_access->>'can_invite_contractor')::boolean,false) THEN RAISE EXCEPTION 'contractor_invitation_pending'; END IF;
      v_created:=true;
      INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,primary_on_acceptance,is_share_link,expires_at)
        VALUES(p_project,auth.uid(),NULL,'contractor','pending',v_initial,true,NULL)
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
CREATE OR REPLACE FUNCTION public.invite_project_contractor(p_project uuid,p_email text)
RETURNS public.contractor_invites LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_email text:=lower(btrim(coalesce(p_email,''))); v public.contractor_invites%ROWTYPE; v_initial boolean; v_access jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND OR NOT public.can_invite_project_people(p_project) THEN RAISE EXCEPTION 'not_permitted'; END IF;
 v_access:=public.project_team_access(p_project);
 v_initial:=NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted' AND is_primary);
 IF v_initial AND NOT coalesce((v_access->>'primary_client')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
 IF NOT v_initial AND NOT coalesce((v_access->>'can_invite_additional_contractor')::boolean,false) THEN RAISE EXCEPTION 'not_permitted'; END IF;
 IF length(v_email)>320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND lower(btrim(email))=v_email) THEN RAISE EXCEPTION 'self_invite'; END IF;
 SELECT * INTO v FROM public.contractor_invites WHERE project_id=p_project AND lower(email)=v_email FOR UPDATE;
 IF v.status='accepted' THEN RAISE EXCEPTION 'already_member'; END IF;
 IF v.id IS NOT NULL AND v.status='pending' THEN
  IF v.primary_on_acceptance IS DISTINCT FROM v_initial THEN RAISE EXCEPTION 'role_change_requires_admin'; END IF;
  RETURN v;
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(btrim(u.email))=v_email AND (EXISTS(SELECT 1 FROM public.projects WHERE id=p_project AND user_id=u.id) OR EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND contractor_user_id=u.id AND status='accepted') OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND user_id=u.id AND accepted_at IS NOT NULL AND revoked_at IS NULL) OR EXISTS(SELECT 1 FROM public.project_verifiers WHERE project_id=p_project AND user_id=u.id AND status='active'))) THEN
  RAISE EXCEPTION 'already_member';
 END IF;
 IF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND lower(email)=v_email AND revoked_at IS NULL AND accepted_at IS NULL) THEN RAISE EXCEPTION 'invitation_pending'; END IF;
 IF v_initial AND NOT coalesce((v_access->>'can_invite_contractor')::boolean,false) THEN RAISE EXCEPTION 'contractor_invitation_pending'; END IF;
 IF v.id IS NOT NULL THEN
  UPDATE public.contractor_invites SET status='pending',accepted_at=NULL,contractor_user_id=NULL,is_share_link=false,expires_at=NULL,
   invited_by=auth.uid(),token=gen_random_uuid(),primary_on_acceptance=v_initial,
   email_status='queued',email_message_id=NULL,email_sent_at=NULL,email_delivered_at=NULL,email_error=NULL,email_attempts=0
   WHERE id=v.id RETURNING * INTO v;
 ELSE
  INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,primary_on_acceptance)
   VALUES(p_project,auth.uid(),v_email,'contractor','pending',v_initial) RETURNING * INTO v;
 END IF;
 PERFORM public.log_activity(p_project,'contractor.invited','contractor_invite',v.id,auth.uid(),jsonb_build_object('email',v_email,'primary_on_acceptance',v_initial));
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_project_contractor_invite(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.contractor_invites%ROWTYPE; v_project uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.contractor_invites WHERE id=p_invite;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.contractor_invites WHERE id=p_invite FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (public.is_admin() OR (public.is_project_client(v_project) AND NOT public.is_primary_project_contractor(v_project))
    OR (public.is_primary_project_contractor(v_project) AND NOT v.primary_on_acceptance)) THEN RAISE EXCEPTION 'not_permitted'; END IF;
  IF v.status<>'pending' THEN RAISE EXCEPTION 'role_change_requires_admin: accepted assignments are managed by Groundwork'; END IF;
  DELETE FROM public.contractor_invites WHERE id=p_invite;
  PERFORM public.log_activity(v_project,'contractor.invitation_cancelled','contractor_invite',p_invite,auth.uid(),jsonb_build_object('email',v.email));
END $$;
CREATE OR REPLACE FUNCTION public.accept_contractor_invite(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_project uuid;v_email text;v public.contractor_invites%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 -- Match the admin role editor's lock so an invitation cannot race a correction.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('groundwork.admin_user_roles',0));
 SELECT project_id INTO v_project FROM public.contractor_invites WHERE token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'invite_invalid'; END IF;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
 SELECT * INTO v FROM public.contractor_invites WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invite_invalid'; END IF;
 IF v.status='accepted' THEN
  IF v.contractor_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'invite_invalid: another account accepted'; END IF;
  RETURN v_project;
 END IF;
 IF v.status<>'pending' THEN RAISE EXCEPTION 'invite_invalid'; END IF;
 SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=v_actor AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL THEN
  IF v.is_share_link THEN RAISE EXCEPTION 'invitation_email_unverified'; END IF;
  RAISE EXCEPTION 'invite_email_mismatch';
 END IF;
 IF public.project_member(v_project) THEN RAISE EXCEPTION 'already_member'; END IF;
 IF v.is_share_link THEN
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND id<>v.id AND lower(email)=v_email) THEN RAISE EXCEPTION 'invitation_pending'; END IF;
 ELSIF v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
 IF v.primary_on_acceptance AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND is_primary AND id<>v.id) THEN RAISE EXCEPTION 'assignment_changed: ask Groundwork to review this invitation'; END IF;
 UPDATE public.contractor_invites SET status='accepted',accepted_at=now(),contractor_user_id=v_actor,
  email=CASE WHEN v.is_share_link THEN v_email ELSE email END,
  is_primary=CASE WHEN v.primary_on_acceptance THEN true ELSE is_primary END WHERE id=v.id;
 -- New contractor accounts have no role rows yet. Existing explicit roles stay put.
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_actor) THEN
  INSERT INTO public.user_roles(user_id,role) VALUES(v_actor,'contractor') ON CONFLICT(user_id,role) DO NOTHING;
 END IF;
 RETURN v_project;
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
  IF public.project_member(v_project) THEN RAISE EXCEPTION 'already_member'; END IF;
  IF v.is_share_link THEN
    IF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND id<>v.id AND revoked_at IS NULL AND lower(email)=v_email) THEN
      RAISE EXCEPTION 'invitation_pending';
    END IF;
  ELSIF v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
  UPDATE public.project_viewers SET user_id=v_actor,accepted_at=now(),email=CASE WHEN v.is_share_link THEN v_email ELSE email END WHERE id=v.id;
  PERFORM public.log_activity(v.project_id,'project.viewer_accepted',NULL,NULL,v_actor,jsonb_build_object('email',v_email,'is_client',v.is_client,'is_share_link',v.is_share_link));
  RETURN v.project_id;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
