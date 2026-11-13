-- Project invitations grant membership without undoing an explicit account role.
-- An already accepted link is an idempotent membership retry, never another role grant.
BEGIN;
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
 IF v.is_share_link THEN
  IF public.project_member(v_project) THEN RAISE EXCEPTION 'already_member'; END IF;
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
REVOKE ALL ON FUNCTION public.accept_contractor_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_contractor_invite(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
