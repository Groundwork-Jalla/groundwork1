-- Correct client/contractor signup mistakes without changing project roles.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_set_account_type(p_user uuid,p_type text,p_expected_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before text; v_roles text; v_changed boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF p_type IS NULL OR p_type NOT IN('client','contractor') OR p_expected_type IS NULL OR p_expected_type NOT IN('client','contractor') THEN
   RAISE EXCEPTION 'invalid_account_type';
 END IF;
 PERFORM 1 FROM auth.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
 v_before:=CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role='contractor') THEN 'contractor' ELSE 'client' END;
 IF v_before<>p_expected_type THEN RAISE EXCEPTION 'stale_account_type'; END IF;
 IF p_type='client' AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE contractor_user_id=p_user AND status='accepted') THEN
   RAISE EXCEPTION 'contractor_assignments_exist: reassign project contractor responsibilities first';
 END IF;
 v_changed:=v_before<>p_type;
 IF v_changed THEN
   DELETE FROM public.user_roles WHERE user_id=p_user AND role IN('homeowner','contractor');
   IF p_type='contractor' THEN
     INSERT INTO public.user_roles(user_id,role) VALUES(p_user,'contractor') ON CONFLICT(user_id,role) DO NOTHING;
   END IF;
   -- A leftover signup intent must not re-grant the contractor role on next login.
   IF p_type='client' THEN
     UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data-'signup_intent'
       WHERE id=p_user AND raw_user_meta_data->>'signup_intent'='contractor';
   END IF;
   PERFORM public.log_activity(NULL,'account.type_changed','profile',p_user,p_user,
     jsonb_build_object('from',v_before,'to',p_type));
 END IF;
 SELECT string_agg(role,',' ORDER BY role) INTO v_roles FROM public.user_roles WHERE user_id=p_user;
 RETURN jsonb_build_object('user_id',p_user,'account_type',p_type,'roles',coalesce(v_roles,''),'changed',v_changed);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_account_type(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_type(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
