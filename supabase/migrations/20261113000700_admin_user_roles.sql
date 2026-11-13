-- Explicit account roles control dashboards; project memberships remain independent.
BEGIN;
CREATE OR REPLACE FUNCTION public.my_account_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_roles text[]; v_legacy boolean; v_role text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT coalesce(array_agg(role ORDER BY role),'{}') INTO v_roles FROM public.user_roles WHERE user_id=auth.uid();
 v_legacy:=cardinality(v_roles)=0 AND EXISTS(SELECT 1 FROM public.contractor_invites WHERE contractor_user_id=auth.uid() AND status='accepted');
 v_role:=CASE WHEN 'admin'=ANY(v_roles) THEN 'admin' WHEN 'verifier'=ANY(v_roles) THEN 'verifier'
   WHEN 'contractor'=ANY(v_roles) OR v_legacy THEN 'contractor' ELSE 'client' END;
 RETURN jsonb_build_object('user_id',auth.uid(),'role',v_role,'roles',array_to_string(v_roles,','),
   'is_admin','admin'=ANY(v_roles),'is_verifier','verifier'=ANY(v_roles),
   'is_contractor','contractor'=ANY(v_roles) OR v_legacy);
END $$;
REVOKE ALL ON FUNCTION public.my_account_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_account_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user uuid,p_role text,p_expected_roles text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before text; v_expected text; v_target text; v_actor uuid:=auth.uid(); v_changed boolean;
BEGIN
 IF v_actor IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF p_role IS NULL OR p_role NOT IN('client','contractor','verifier','admin') OR p_expected_roles IS NULL THEN RAISE EXCEPTION 'invalid_account_role'; END IF;
 -- Serialize staff demotions as well as edits to the same account.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('groundwork.admin_user_roles',0));
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 PERFORM 1 FROM auth.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
 SELECT coalesce(string_agg(role,',' ORDER BY role),'') INTO v_before FROM public.user_roles WHERE user_id=p_user;
 SELECT coalesce(string_agg(value,',' ORDER BY value),'') INTO v_expected
 FROM (SELECT DISTINCT btrim(value) AS value FROM unnest(string_to_array(p_expected_roles,',')) value WHERE btrim(value)<>'') normal;
 IF v_before<>v_expected THEN RAISE EXCEPTION 'stale_account_role'; END IF;
 v_target:=CASE WHEN p_role='client' THEN 'homeowner' ELSE p_role END;
 v_changed:=v_before<>v_target;
 IF v_changed THEN
   IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role='admin') AND p_role<>'admin'
     AND (SELECT count(*) FROM public.user_roles WHERE role='admin')<=1 THEN RAISE EXCEPTION 'last_admin'; END IF;
   DELETE FROM public.user_roles WHERE user_id=p_user;
   INSERT INTO public.user_roles(user_id,role) VALUES(p_user,v_target);
   UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}'::jsonb)-'signup_intent')
     ||jsonb_build_object('role',p_role,'onboarding_complete',true) WHERE id=p_user;
   PERFORM public.log_activity(NULL,'account.role_changed','profile',p_user,p_user,
     jsonb_build_object('from_roles',v_before,'to_role',p_role));
 END IF;
 RETURN jsonb_build_object('user_id',p_user,'role',p_role,'roles',v_target,'changed',v_changed);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text,text) TO authenticated;

-- Users can always read their own profile, including after their final role row is
-- removed. This notification therefore works for revocations as well as grants.
CREATE OR REPLACE FUNCTION public.notify_account_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE public.profiles SET updated_at=clock_timestamp() WHERE id=OLD.user_id;
 ELSE UPDATE public.profiles SET updated_at=clock_timestamp() WHERE id=NEW.user_id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.notify_account_role_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS account_role_change ON public.user_roles;
CREATE TRIGGER account_role_change AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
 FOR EACH ROW EXECUTE FUNCTION public.notify_account_role_change();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_roles') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
   END IF;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
