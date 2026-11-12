-- Shareable invitations are first-claim links. Existing email invitations stay
-- recipient-bound. A preview never consumes a link; a verified signed-in account
-- claims it atomically under the same project lock used by all invitation paths.
BEGIN;
ALTER TABLE public.project_viewers
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_share_link boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.contractor_invites
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_share_link boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.project_viewers DROP CONSTRAINT IF EXISTS viewer_invitation_identity;
ALTER TABLE public.project_viewers ADD CONSTRAINT viewer_invitation_identity CHECK (
  (email IS NOT NULL OR (is_share_link AND accepted_at IS NULL))
  AND (NOT is_share_link OR expires_at IS NOT NULL));
ALTER TABLE public.contractor_invites DROP CONSTRAINT IF EXISTS contractor_invitation_identity;
ALTER TABLE public.contractor_invites ADD CONSTRAINT contractor_invitation_identity CHECK (
  (email IS NOT NULL OR (is_share_link AND status<>'accepted'))
  AND (NOT is_share_link OR expires_at IS NOT NULL));

-- Only called from manager RPCs, after taking the project lock. An expired primary
-- link must release its reserved role without disturbing accepted participants.
CREATE OR REPLACE FUNCTION public.expire_project_invitation_links(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.project_viewers SET revoked_at=now(),revoked_by=invited_by
   WHERE project_id=p_project AND is_share_link AND accepted_at IS NULL
     AND revoked_at IS NULL AND expires_at<=now();
  UPDATE public.contractor_invites SET status='rejected'
   WHERE project_id=p_project AND is_share_link AND status='pending' AND expires_at<=now();
END $$;
REVOKE ALL ON FUNCTION public.expire_project_invitation_links(uuid) FROM PUBLIC,anon,authenticated;


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
  SELECT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND is_client AND revoked_at IS NULL AND (accepted_at IS NOT NULL OR NOT is_share_link OR expires_at>now())) INTO v_named_client;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted') INTO v_contractor;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='pending' AND (NOT is_share_link OR expires_at>now())) INTO v_pending;
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

CREATE OR REPLACE FUNCTION public.invite_project_viewer(
  p_project uuid,p_email text,p_relationship text DEFAULT NULL,p_is_client boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_owner uuid; v_email text:=lower(btrim(coalesce(p_email,'')));
  v_existing public.project_viewers%ROWTYPE; v_token uuid; v_access jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT user_id INTO v_owner FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND OR NOT public.can_invite_project_people(p_project) THEN
    RAISE EXCEPTION 'not_permitted: only the primary client or primary contractor may invite people';
  END IF;
  PERFORM public.expire_project_invitation_links(p_project);
  IF length(v_email)>320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=v_actor AND lower(btrim(email))=v_email) THEN RAISE EXCEPTION 'self_invite'; END IF;
  SELECT * INTO v_existing FROM public.project_viewers WHERE project_id=p_project AND lower(email)=v_email AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF coalesce(p_is_client,false) AND NOT v_existing.is_client THEN
      RAISE EXCEPTION 'role_change_requires_admin: ask Groundwork to change an existing participant role';
    END IF;
    IF v_existing.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'already_member'; END IF;
    RETURN v_existing.token;
  END IF;
  IF coalesce(p_is_client,false) THEN
    v_access:=public.project_team_access(p_project);
    IF NOT coalesce((v_access->>'can_invite_client')::boolean,false) THEN
      RAISE EXCEPTION 'not_permitted: this project already has its client';
    END IF;
  END IF;
  -- Primary people already have access; inviting them as observers is misleading.
  IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(btrim(u.email))=v_email AND (
       u.id=v_owner OR EXISTS(SELECT 1 FROM public.contractor_invites ci WHERE ci.project_id=p_project
         AND ci.contractor_user_id=u.id AND ci.status='accepted' AND ci.is_primary))) THEN
    RAISE EXCEPTION 'already_member: this person already has a primary role';
  END IF;
  INSERT INTO public.project_viewers(project_id,email,relationship,invited_by,is_client)
    VALUES(p_project,v_email,nullif(btrim(coalesce(p_relationship,'')),''),v_actor,coalesce(p_is_client,false))
    RETURNING token INTO v_token;
  PERFORM public.log_activity(p_project,'project.viewer_invited',NULL,NULL,v_actor,
    jsonb_build_object('email',v_email,'is_client',coalesce(p_is_client,false)));
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.invite_project_contractor(p_project uuid,p_email text)
RETURNS public.contractor_invites LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_email text:=lower(btrim(coalesce(p_email,''))); v public.contractor_invites%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND OR NOT public.is_project_client(p_project) OR public.is_primary_project_contractor(p_project) THEN
    RAISE EXCEPTION 'not_permitted: only the project client invites its initial contractor';
  END IF;
  PERFORM public.expire_project_invitation_links(p_project);
  IF length(v_email)>320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND lower(btrim(email))=v_email) THEN RAISE EXCEPTION 'self_invite'; END IF;
  SELECT * INTO v FROM public.contractor_invites WHERE project_id=p_project AND lower(email)=v_email FOR UPDATE;
  IF FOUND AND v.status='pending' AND v.primary_on_acceptance THEN RETURN v; END IF;
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted') THEN
    RAISE EXCEPTION 'role_change_requires_admin: the contractor role is already assigned';
  END IF;
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='pending') THEN
    RAISE EXCEPTION 'contractor_invitation_pending: withdraw the pending invitation before choosing another contractor';
  END IF;
  IF v.id IS NOT NULL THEN
    UPDATE public.contractor_invites SET status='pending',accepted_at=NULL,contractor_user_id=NULL,is_share_link=false,expires_at=NULL,
      invited_by=auth.uid(),token=gen_random_uuid(),primary_on_acceptance=true,
      email_status='queued',email_message_id=NULL,email_sent_at=NULL,email_delivered_at=NULL,email_error=NULL,email_attempts=0
      WHERE id=v.id RETURNING * INTO v;
  ELSE
    INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,primary_on_acceptance)
      VALUES(p_project,auth.uid(),v_email,'contractor','pending',true) RETURNING * INTO v;
  END IF;
  PERFORM public.log_activity(p_project,'contractor.invited','contractor_invite',v.id,auth.uid(),jsonb_build_object('email',v_email,'primary_on_acceptance',true));
  RETURN v;
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
        VALUES(p_project,auth.uid(),NULL,'contractor','pending',true,true,now()+interval '7 days')
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
        VALUES(p_project,NULL,auth.uid(),p_role='client',true,now()+interval '7 days')
        RETURNING id,token,expires_at INTO v_id,v_token,v_expires;
    END IF;
  END IF;
  IF v_created THEN
    PERFORM public.log_activity(p_project,'project.link_created',NULL,NULL,auth.uid(),jsonb_build_object('invitation_id',v_id,'role',p_role,'expires_at',v_expires));
  END IF;
  RETURN jsonb_build_object('id',v_id,'token',v_token,'role',p_role,'expires_at',v_expires);
END $$;
REVOKE ALL ON FUNCTION public.create_project_invitation_link(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_project_invitation_link(uuid,text) TO authenticated;


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
  IF v.is_share_link AND v.expires_at<=now() THEN RAISE EXCEPTION 'invitation_expired'; END IF;
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
    IF v.is_share_link AND v.expires_at<=now() THEN RAISE EXCEPTION 'invitation_expired'; END IF;
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
DROP FUNCTION IF EXISTS public.project_viewer_preview(uuid);
CREATE FUNCTION public.project_viewer_preview(p_token uuid)
RETURNS TABLE(project_name text,invited_by_name text,accepted boolean,is_client boolean,is_share_link boolean,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.name,coalesce(nullif(btrim(o.full_name),''),'Someone on Groundwork'),
    v.accepted_at IS NOT NULL,v.is_client,v.is_share_link,v.expires_at
  FROM public.project_viewers v JOIN public.projects p ON p.id=v.project_id
  LEFT JOIN public.profiles o ON o.id=v.invited_by
  WHERE v.token=p_token AND v.revoked_at IS NULL
    AND (v.accepted_at IS NULL OR v.user_id=auth.uid())
    AND (v.accepted_at IS NOT NULL OR NOT v.is_share_link OR v.expires_at>now());
$$;
REVOKE ALL ON FUNCTION public.project_viewer_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_viewer_preview(uuid) TO anon,authenticated;
DROP FUNCTION IF EXISTS public.get_invite_by_token(uuid);
CREATE FUNCTION public.get_invite_by_token(p_token uuid)
RETURNS TABLE(project_id uuid,invite_email text,status text,project_name text,inviter_name text,is_share_link boolean,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.id,ci.email,ci.status,p.name,coalesce(nullif(btrim(o.full_name),''),'Someone on Groundwork'),ci.is_share_link,ci.expires_at
  FROM public.contractor_invites ci JOIN public.projects p ON p.id=ci.project_id
  LEFT JOIN public.profiles o ON o.id=ci.invited_by
  WHERE ci.token=p_token AND ci.status IN('pending','accepted')
    AND (ci.status='pending' OR ci.contractor_user_id=auth.uid())
    AND (ci.status='accepted' OR NOT ci.is_share_link OR ci.expires_at>now());
$$;
REVOKE ALL ON FUNCTION public.get_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon,authenticated;

-- One actual project role per account. Observers and invited clients were missing
-- from the chat/notification roster, causing their messages to be labelled Jalla.
CREATE OR REPLACE FUNCTION public.project_participants(p_project uuid)
RETURNS TABLE(user_id uuid,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH people AS (
    SELECT ci.contractor_user_id AS uid,'contractor'::text AS label,CASE WHEN ci.is_primary THEN 1 ELSE 3 END AS priority
      FROM public.contractor_invites ci WHERE ci.project_id=p_project AND ci.status='accepted' AND ci.contractor_user_id IS NOT NULL
    UNION ALL
    SELECT v.user_id,'owner',2 FROM public.project_viewers v
      WHERE v.project_id=p_project AND v.is_client AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL
    UNION ALL
    SELECT p.user_id,'owner',4 FROM public.projects p WHERE p.id=p_project AND p.user_id IS NOT NULL
    UNION ALL
    SELECT pv.user_id,'verifier',5 FROM public.project_verifiers pv WHERE pv.project_id=p_project AND pv.status='active' AND pv.user_id IS NOT NULL
    UNION ALL
    SELECT v.user_id,'observer',6 FROM public.project_viewers v
      WHERE v.project_id=p_project AND NOT v.is_client AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL
  )
  SELECT DISTINCT ON(uid) uid,label FROM people
  WHERE public.is_admin() OR public.project_member(p_project)
     OR current_setting('request.jwt.claim.role',true)='service_role'
     OR coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'='service_role'
  ORDER BY uid,priority;
$$;
REVOKE ALL ON FUNCTION public.project_participants(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_participants(uuid) TO authenticated,service_role;
COMMIT;
