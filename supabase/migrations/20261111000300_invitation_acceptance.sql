-- An emailed invitation belongs to its recipient. Retrying an acceptance from the
-- same account is successful, including when the first response was lost in transit.
BEGIN;

CREATE OR REPLACE FUNCTION public.accept_project_viewer(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v public.project_viewers%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in: create an account first'; END IF;
  SELECT * INTO v FROM public.project_viewers WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token: no invitation matches that link'; END IF;
  IF v.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked: that invitation has been withdrawn'; END IF;

  IF v.accepted_at IS NOT NULL THEN
    IF v.user_id = v_actor THEN RETURN v.project_id; END IF;
    RAISE EXCEPTION 'already_accepted: another account has accepted this invitation';
  END IF;

  SELECT lower(btrim(email)) INTO v_email FROM auth.users
   WHERE id = v_actor AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email <> lower(btrim(v.email)) THEN
    RAISE EXCEPTION 'invite_email_mismatch: sign in with the address this invitation was sent to';
  END IF;

  UPDATE public.project_viewers SET user_id = v_actor, accepted_at = now() WHERE id = v.id;
  PERFORM public.log_activity(v.project_id, 'project.viewer_accepted', NULL, NULL, v_actor,
    jsonb_build_object('email', v.email));
  RETURN v.project_id;
END $$;

CREATE OR REPLACE FUNCTION public.accept_contractor_invite(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v public.contractor_invites%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in: sign in before accepting'; END IF;
  SELECT * INTO v FROM public.contractor_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_invalid: invite not found'; END IF;

  IF v.status = 'accepted' THEN
    IF v.contractor_user_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'invite_invalid: another account has accepted this invitation';
    END IF;
  ELSE
    IF v.status <> 'pending' THEN RAISE EXCEPTION 'invite_invalid: invitation is no longer pending'; END IF;
    SELECT lower(btrim(email)) INTO v_email FROM auth.users
     WHERE id = v_actor AND email_confirmed_at IS NOT NULL;
    IF v_email IS NULL OR v_email <> lower(btrim(v.email)) THEN
      RAISE EXCEPTION 'invite_email_mismatch: sign in with the address this invitation was sent to';
    END IF;
    UPDATE public.contractor_invites
       SET status = 'accepted', accepted_at = now(), contractor_user_id = v_actor
     WHERE id = v.id;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'contractor')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN v.project_id;
END $$;

REVOKE ALL ON FUNCTION public.accept_project_viewer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_contractor_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_project_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_contractor_invite(uuid) TO authenticated;
COMMIT;
