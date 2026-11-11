-- Invitation authority follows the primary project roles, not row creation.
BEGIN;

ALTER TABLE public.contractor_invites
  ADD COLUMN IF NOT EXISTS primary_on_acceptance boolean NOT NULL DEFAULT false;

-- A sole accepted contractor is unambiguous. Leave multi-contractor legacy
-- projects without a primary for staff to review rather than picking a person.
UPDATE public.contractor_invites ci SET is_primary = true
 WHERE ci.status = 'accepted' AND ci.contractor_user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.contractor_invites c WHERE c.project_id=ci.project_id AND c.is_primary)
   AND (SELECT count(*) FROM public.contractor_invites c WHERE c.project_id=ci.project_id AND c.status='accepted')=1;
UPDATE public.contractor_invites ci SET primary_on_acceptance=true
 WHERE ci.status='pending'
   AND NOT EXISTS (SELECT 1 FROM public.contractor_invites c WHERE c.project_id=ci.project_id AND c.status='accepted')
   AND (SELECT count(*) FROM public.contractor_invites c WHERE c.project_id=ci.project_id AND c.status='pending')=1;
CREATE UNIQUE INDEX IF NOT EXISTS contractor_invites_one_pending_primary
  ON public.contractor_invites(project_id) WHERE status='pending' AND primary_on_acceptance;

CREATE OR REPLACE FUNCTION public.is_primary_project_contractor(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.contractor_invites ci WHERE ci.project_id=p_project
    AND ci.contractor_user_id=auth.uid() AND ci.status='accepted' AND ci.is_primary);
$$;
-- A contractor-created project is awaiting its client until one joins. Ownership
-- alone must not let the primary contractor approve their own work in that gap.
CREATE OR REPLACE FUNCTION public.is_project_client(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT public.is_primary_project_contractor(p_project) AND (
    EXISTS(SELECT 1 FROM public.project_viewers v WHERE v.project_id=p_project
      AND v.user_id=auth.uid() AND v.is_client AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL)
    OR (EXISTS(SELECT 1 FROM public.projects p WHERE p.id=p_project AND p.user_id=auth.uid())
      AND NOT public.is_contractor_on(p_project,auth.uid())
      AND NOT EXISTS(SELECT 1 FROM public.project_viewers v WHERE v.project_id=p_project AND v.is_client AND v.revoked_at IS NULL))
  );
$$;
CREATE OR REPLACE FUNCTION public.can_invite_project_people(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_project_client(p_project)
    OR public.is_primary_project_contractor(p_project));
$$;
REVOKE ALL ON FUNCTION public.is_primary_project_contractor(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.can_invite_project_people(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_primary_project_contractor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_invite_project_people(uuid) TO authenticated;

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
  RETURN jsonb_build_object('can_invite',v_primary OR v_client,
    'assigned_contractor',public.is_contractor_on(p_project,auth.uid()),
    'primary_client',v_client AND NOT v_primary,'primary_contractor',v_primary,
    'can_invite_client',v_primary AND v_owner_contractor AND NOT v_named_client,
    'can_invite_contractor',v_client AND NOT v_primary AND NOT v_contractor AND NOT v_pending,
    'has_client_invitation',v_named_client,'has_contractor',v_contractor,'has_pending_contractor',v_pending,
    'can_change_roles',public.is_admin(),
    'needs_primary_review',v_contractor AND NOT EXISTS(SELECT 1 FROM public.contractor_invites
      WHERE project_id=p_project AND status='accepted' AND is_primary));
END $$;
REVOKE ALL ON FUNCTION public.project_team_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_team_access(uuid) TO authenticated;

-- Managers can see their own project's participant list. Secondary invitees
-- keep their existing self-read; no general membership write policy is added.
DROP POLICY IF EXISTS "owner_reads_project_viewers" ON public.project_viewers;
CREATE POLICY "owner_reads_project_viewers" ON public.project_viewers FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.is_admin() OR public.can_invite_project_people(project_id));
DROP POLICY IF EXISTS "owner_all_invites" ON public.contractor_invites;
DROP POLICY IF EXISTS "project_managers_read_invites" ON public.contractor_invites;
CREATE POLICY "project_managers_read_invites" ON public.contractor_invites FOR SELECT TO authenticated
  USING (public.can_invite_project_people(project_id));

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

CREATE OR REPLACE FUNCTION public.revoke_project_viewer(p_viewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.project_viewers%ROWTYPE; v_project uuid; v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.project_viewers WHERE id=p_viewer;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.project_viewers WHERE id=p_viewer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (public.is_admin() OR public.can_invite_project_people(v_project) OR v.user_id IS NOT DISTINCT FROM v_actor) THEN
    RAISE EXCEPTION 'not_permitted';
  END IF;
  IF v.is_client AND v.accepted_at IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'role_change_requires_admin: ask Groundwork to change the primary client';
  END IF;
  IF v.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.project_viewers SET revoked_at=now(),revoked_by=v_actor WHERE id=p_viewer;
  PERFORM public.log_activity(v_project,'project.viewer_removed',NULL,NULL,v_actor,jsonb_build_object('email',v.email));
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
    UPDATE public.contractor_invites SET status='pending',accepted_at=NULL,contractor_user_id=NULL,
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

CREATE OR REPLACE FUNCTION public.cancel_project_contractor_invite(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.contractor_invites%ROWTYPE; v_project uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project FROM public.contractor_invites WHERE id=p_invite;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  IF NOT (public.is_admin() OR (public.is_project_client(v_project) AND NOT public.is_primary_project_contractor(v_project))) THEN RAISE EXCEPTION 'not_permitted'; END IF;
  SELECT * INTO v FROM public.contractor_invites WHERE id=p_invite FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status<>'pending' THEN RAISE EXCEPTION 'role_change_requires_admin: accepted assignments are managed by Groundwork'; END IF;
  DELETE FROM public.contractor_invites WHERE id=p_invite;
  PERFORM public.log_activity(v_project,'contractor.invitation_cancelled','contractor_invite',p_invite,auth.uid(),jsonb_build_object('email',v.email));
END $$;

-- Preview only the role and existing project/inviter labels; never financial data.
DROP FUNCTION IF EXISTS public.project_viewer_preview(uuid);
CREATE FUNCTION public.project_viewer_preview(p_token uuid)
RETURNS TABLE(project_name text,invited_by_name text,accepted boolean,is_client boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.name,coalesce(nullif(btrim(o.full_name),''),'Someone on Groundwork'),
    v.accepted_at IS NOT NULL,v.is_client
  FROM public.project_viewers v JOIN public.projects p ON p.id=v.project_id
  LEFT JOIN public.profiles o ON o.id=v.invited_by
  WHERE v.token=p_token AND v.revoked_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.project_viewer_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_viewer_preview(uuid) TO anon,authenticated;

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
  IF v_email IS NULL OR v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
  UPDATE public.project_viewers SET user_id=v_actor,accepted_at=now() WHERE id=v.id;
  PERFORM public.log_activity(v.project_id,'project.viewer_accepted',NULL,NULL,v_actor,jsonb_build_object('email',v.email,'is_client',v.is_client));
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
    IF v_email IS NULL OR v_email<>lower(btrim(v.email)) THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;
    IF v.primary_on_acceptance AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND is_primary AND id<>v.id) THEN
      RAISE EXCEPTION 'assignment_changed: ask Groundwork to review this invitation';
    END IF;
    UPDATE public.contractor_invites SET status='accepted',accepted_at=now(),contractor_user_id=v_actor,
      is_primary=CASE WHEN v.primary_on_acceptance THEN true ELSE is_primary END WHERE id=v.id;
  END IF;
  INSERT INTO public.user_roles(user_id,role) VALUES(v_actor,'contractor') ON CONFLICT(user_id,role) DO NOTHING;
  RETURN v_project;
END $$;

-- Established primary roles are staff decisions, not a side effect of inviting
-- another observer or replaying project onboarding.
CREATE OR REPLACE FUNCTION public.set_primary_contractor(p_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.contractor_invites%ROWTYPE; v_project uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: Groundwork manages established project roles'; END IF;
  SELECT project_id INTO v_project FROM public.contractor_invites WHERE id=p_invite;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.contractor_invites WHERE id=p_invite FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status<>'accepted' THEN RAISE EXCEPTION 'not_accepted'; END IF;
  IF v.contractor_user_id IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  IF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL
    AND user_id=v.contractor_user_id AND accepted_at IS NOT NULL) THEN RAISE EXCEPTION 'role_conflict'; END IF;
  UPDATE public.contractor_invites SET is_primary=false WHERE project_id=v_project AND is_primary AND id<>p_invite;
  UPDATE public.contractor_invites SET is_primary=true WHERE id=p_invite;
  PERFORM public.log_activity(v_project,'contractor.primary_set','contractor_invite',p_invite,auth.uid(),jsonb_build_object('email',v.email));
END $$;

CREATE OR REPLACE FUNCTION public.set_project_client(p_viewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.project_viewers%ROWTYPE; v_project uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: Groundwork manages established project roles'; END IF;
  SELECT project_id INTO v_project FROM public.project_viewers WHERE id=p_viewer;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
  SELECT * INTO v FROM public.project_viewers WHERE id=p_viewer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.revoked_at IS NOT NULL OR v.accepted_at IS NULL OR v.user_id IS NULL THEN RAISE EXCEPTION 'not_accepted'; END IF;
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND status='accepted'
    AND is_primary AND contractor_user_id=v.user_id) THEN RAISE EXCEPTION 'role_conflict: the primary contractor cannot also be the named client'; END IF;
  UPDATE public.project_viewers SET is_client=false WHERE project_id=v_project AND is_client AND revoked_at IS NULL AND id<>p_viewer;
  UPDATE public.project_viewers SET is_client=true WHERE id=p_viewer;
  PERFORM public.log_activity(v_project,'project.client_set','project_viewer',p_viewer,auth.uid(),jsonb_build_object('email',v.email));
END $$;

CREATE OR REPLACE FUNCTION public.contractor_take_own_client_project(p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_email text; v public.contractor_invites%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_my_clients_project(p_project) OR EXISTS(SELECT 1 FROM public.projects WHERE id=p_project AND user_id=v_actor))
    OR NOT (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_actor AND role='contractor') OR public.is_contractor_on(p_project,v_actor)) THEN
    RAISE EXCEPTION 'not_mine: this project is neither yours nor your client''s';
  END IF;
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=v_actor;
  IF v_email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;
  SELECT * INTO v FROM public.contractor_invites WHERE project_id=p_project AND lower(email)=v_email FOR UPDATE;
  IF FOUND AND v.status='accepted' AND v.is_primary AND v.contractor_user_id=v_actor THEN RETURN v.id; END IF;
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND
    (status='accepted' OR (status='pending' AND id IS DISTINCT FROM v.id)))
    OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND is_client AND revoked_at IS NULL
      AND user_id=v_actor AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'role_change_requires_admin: this project already has its contractor';
  END IF;
  IF v.id IS NOT NULL THEN
    UPDATE public.contractor_invites SET status='accepted',accepted_at=coalesce(accepted_at,now()),contractor_user_id=v_actor,is_primary=true
      WHERE id=v.id RETURNING * INTO v;
  ELSE
    INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,accepted_at,contractor_user_id,is_primary)
      VALUES(p_project,v_actor,v_email,'contractor','accepted',now(),v_actor,true) RETURNING * INTO v;
  END IF;
  PERFORM public.log_activity(p_project,'contractor.took_own_client_project','contractor_invite',v.id,v_actor,jsonb_build_object('primary',true));
  RETURN v.id;
END $$;

REVOKE ALL ON FUNCTION public.invite_project_viewer(uuid,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.revoke_project_viewer(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.invite_project_contractor(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_project_contractor_invite(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.accept_contractor_invite(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.accept_project_viewer(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_primary_contractor(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_project_client(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.contractor_take_own_client_project(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invite_project_viewer(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_project_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_project_contractor(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_project_contractor_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_contractor_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_project_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_contractor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_take_own_client_project(uuid) TO authenticated;

DO $realtime$
DECLARE v_table text;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
    FOREACH v_table IN ARRAY ARRAY['project_viewers','contractor_invites'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
      END IF;
    END LOOP;
  END IF;
END $realtime$;
COMMIT;
