-- Account corrections notify the user and repair unambiguous owned projects.
-- No migration sends email or changes existing accounts automatically.
BEGIN;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_event ON public.notifications(user_id,event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.account_role_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users ON DELETE SET NULL,from_roles text NOT NULL,to_role text NOT NULL CHECK(to_role IN('client','contractor','verifier','admin')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','failed','held','superseded')),
 payload jsonb,worker_token uuid,processing_until timestamptz,first_attempt_at timestamptz,
 attempts int NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 provider_id text, sent_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_role_notifications_due ON public.account_role_notifications(next_attempt_at)
 WHERE status IN('queued','sending','failed');
ALTER TABLE public.account_role_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_role_notifications_admin_read ON public.account_role_notifications;
CREATE POLICY account_role_notifications_admin_read ON public.account_role_notifications FOR SELECT TO authenticated USING(public.is_admin());
REVOKE ALL ON public.account_role_notifications FROM anon,authenticated;
GRANT SELECT ON public.account_role_notifications TO authenticated;
GRANT ALL ON public.account_role_notifications TO service_role;

-- Only the guarded correction below can change a recorded origin. A browser
-- update, even by the project owner, cannot turn a client into its own contractor.
CREATE OR REPLACE FUNCTION public.guard_project_workflow_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.workflow_origin IS DISTINCT FROM OLD.workflow_origin AND NOT coalesce((
     public.is_admin() AND current_setting('groundwork.correct_project_origin',true)=NEW.id::text
     AND OLD.workflow_origin='client' AND NEW.workflow_origin='contractor' AND NEW.user_id=OLD.user_id
     AND EXISTS(SELECT 1 FROM public.contractor_invites c WHERE c.project_id=NEW.id
       AND c.contractor_user_id=NEW.user_id AND c.status='accepted' AND c.is_primary)
     AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.user_id AND role='contractor')
   ),false) THEN RAISE EXCEPTION 'workflow_origin_fixed: project origin is recorded at creation'; END IF;
 ELSE
   NEW.workflow_origin:=CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.user_id AND role='contractor') THEN 'contractor' ELSE 'client' END;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.correct_contractor_owned_projects(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p record;c public.contractor_invites%ROWTYPE;v_email text;v_changed boolean;
 v_corrected jsonb:='[]';v_review jsonb:='[]';v_flag text:=coalesce(current_setting('groundwork.correct_project_origin',true),'');
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role='contractor') THEN RAISE EXCEPTION 'not_contractor'; END IF;
 SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=p_user;
 IF coalesce(v_email,'')='' THEN RAISE EXCEPTION 'account_email_required'; END IF;
 FOR p IN SELECT id,workflow_origin FROM public.projects WHERE user_id=p_user ORDER BY id FOR UPDATE LOOP
   -- Another contractor's existing or pending assignment needs a human decision.
   IF EXISTS(SELECT 1 FROM public.contractor_invites i WHERE i.project_id=p.id AND (
     (i.status='accepted' AND i.contractor_user_id IS DISTINCT FROM p_user)
     OR (i.status='pending' AND (i.contractor_user_id IS DISTINCT FROM p_user AND lower(btrim(coalesce(i.email,'')))<>v_email))
   )) THEN
     v_review:=v_review||jsonb_build_array(p.id);
     INSERT INTO public.notifications(user_id,type,title,body,data,event_key)
       SELECT r.user_id,'account_role_project_review','Project role correction needs review',
         'This account is now a contractor. Review the existing project contractor assignment.',
         jsonb_build_object('project_id',p.id,'person_id',p_user,'project_tab','people','event','account_role_project_review'),
         'account-role-review:'||p_user||':'||p.id FROM public.user_roles r WHERE r.role='admin' AND r.user_id<>p_user
       ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
     CONTINUE;
   END IF;
   SELECT * INTO c FROM public.contractor_invites WHERE project_id=p.id
     AND (contractor_user_id=p_user OR lower(btrim(email))=v_email) ORDER BY (status='accepted') DESC,created_at LIMIT 1 FOR UPDATE;
   v_changed:=p.workflow_origin<>'contractor' OR c.id IS NULL OR c.status<>'accepted' OR NOT c.is_primary
     OR c.contractor_user_id IS DISTINCT FROM p_user
     OR EXISTS(SELECT 1 FROM public.project_viewers v WHERE v.project_id=p.id AND v.is_client AND v.revoked_at IS NULL
       AND (v.user_id=p_user OR lower(btrim(v.email))=v_email));
   IF NOT v_changed THEN CONTINUE; END IF;
   IF c.id IS NULL THEN
     INSERT INTO public.contractor_invites(project_id,invited_by,email,role,status,accepted_at,contractor_user_id,is_primary,primary_on_acceptance)
       VALUES(p.id,p_user,v_email,'contractor','accepted',now(),p_user,true,true) RETURNING * INTO c;
   ELSE
     UPDATE public.contractor_invites SET status='accepted',accepted_at=coalesce(accepted_at,now()),
       contractor_user_id=p_user,is_primary=true,primary_on_acceptance=true WHERE id=c.id RETURNING * INTO c;
   END IF;
   -- Retire only this person's old client membership; keep it as history.
   UPDATE public.project_viewers SET revoked_at=now(),revoked_by=auth.uid() WHERE project_id=p.id AND is_client AND revoked_at IS NULL
     AND (user_id=p_user OR lower(btrim(email))=v_email);
   PERFORM set_config('groundwork.correct_project_origin',p.id::text,true);
   UPDATE public.projects SET workflow_origin='contractor' WHERE id=p.id AND workflow_origin<>'contractor';
   PERFORM set_config('groundwork.correct_project_origin',v_flag,true);
   PERFORM public.log_activity(p.id,'project.contractor_role_corrected','contractor_invite',c.id,p_user,
     jsonb_build_object('from_origin',p.workflow_origin,'to_origin','contractor','contractor_user_id',p_user));
   v_corrected:=v_corrected||jsonb_build_array(p.id);
 END LOOP;
 RETURN jsonb_build_object('corrected_projects',v_corrected,'review_projects',v_review);
END $$;
REVOKE ALL ON FUNCTION public.correct_contractor_owned_projects(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user uuid,p_role text,p_expected_roles text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before text;v_expected text;v_target text;v_actor uuid:=auth.uid();v_changed boolean;
 v_projects jsonb:=jsonb_build_object('corrected_projects','[]'::jsonb,'review_projects','[]'::jsonb);v_notification uuid;
BEGIN
 IF v_actor IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF p_role IS NULL OR p_role NOT IN('client','contractor','verifier','admin') OR p_expected_roles IS NULL THEN RAISE EXCEPTION 'invalid_account_role'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('groundwork.admin_user_roles',0));
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 PERFORM 1 FROM auth.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
 SELECT coalesce(string_agg(role,',' ORDER BY role),'') INTO v_before FROM public.user_roles WHERE user_id=p_user;
 SELECT coalesce(string_agg(value,',' ORDER BY value),'') INTO v_expected
   FROM(SELECT DISTINCT btrim(value) AS value FROM unnest(string_to_array(p_expected_roles,',')) value WHERE btrim(value)<>'') normal;
 IF v_before<>v_expected THEN RAISE EXCEPTION 'stale_account_role'; END IF;
 v_target:=CASE WHEN p_role='client' THEN 'homeowner' ELSE p_role END;
 v_changed:=v_before<>v_target;
 IF v_changed THEN
   IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role='admin') AND p_role<>'admin'
     AND (SELECT count(*) FROM public.user_roles WHERE role='admin')<=1 THEN RAISE EXCEPTION 'last_admin'; END IF;
   -- Keep the acting admin's authority until their own project correction has
   -- finished. Intermediate roles are visible only inside this transaction.
   INSERT INTO public.user_roles(user_id,role) VALUES(p_user,v_target) ON CONFLICT(user_id,role) DO NOTHING;
 END IF;
 IF p_role='contractor' THEN v_projects:=public.correct_contractor_owned_projects(p_user); END IF;
 IF v_changed THEN
   DELETE FROM public.user_roles WHERE user_id=p_user AND role<>v_target;
   UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}'::jsonb)-'signup_intent')
     ||jsonb_build_object('role',p_role,'onboarding_complete',true) WHERE id=p_user;
   PERFORM public.log_activity(NULL,'account.role_changed','profile',p_user,p_user,
     jsonb_build_object('from_roles',v_before,'to_role',p_role));
 END IF;
 IF v_changed OR jsonb_array_length(v_projects->'corrected_projects')>0 THEN
   INSERT INTO public.account_role_notifications(user_id,actor_id,from_roles,to_role)
     VALUES(p_user,v_actor,v_before,p_role) RETURNING id INTO v_notification;
   INSERT INTO public.notifications(user_id,type,title,body,data,event_key)
     VALUES(p_user,'account_role_changed','Your Groundwork account has been updated',
       CASE WHEN p_role='contractor' THEN 'Open your contractor account to complete setup and access your projects.' ELSE 'Open your account to continue with your updated role.' END,
       jsonb_build_object('account_role',p_role,'account_role_notification_id',v_notification),'account-role:'||v_notification);
 END IF;
 RETURN v_projects||jsonb_build_object('user_id',p_user,'role',p_role,'roles',v_target,'changed',v_changed,'notification_id',v_notification);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_account_role_notification(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.account_role_notifications%ROWTYPE;v_target text;v_email text;v_lang text;v_name text;v_token uuid:=gen_random_uuid();v_status jsonb;
BEGIN
 SELECT * INTO n FROM public.account_role_notifications WHERE id=p_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR n.status NOT IN('queued','failed','sending') OR n.next_attempt_at>now()
   OR n.processing_until>now() THEN RETURN NULL; END IF;
 v_target:=CASE WHEN n.to_role='client' THEN 'homeowner' ELSE n.to_role END;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=n.user_id AND role=v_target) THEN
   UPDATE public.account_role_notifications SET status='superseded',processing_until=NULL,worker_token=NULL WHERE id=n.id;RETURN NULL;
 END IF;
 IF n.first_attempt_at IS NOT NULL AND n.first_attempt_at<now()-interval '23 hours' THEN
   UPDATE public.account_role_notifications SET status='held',last_error='delivery_review_required',processing_until=NULL,worker_token=NULL WHERE id=n.id;RETURN NULL;
 END IF;
 SELECT email INTO v_email FROM auth.users WHERE id=n.user_id;
 SELECT CASE WHEN preferred_lang='fr' THEN 'fr' ELSE 'en' END,full_name INTO v_lang,v_name FROM public.profiles WHERE id=n.user_id;
 IF n.to_role='contractor' THEN v_status:=public.contractor_onboarding_status(n.user_id); END IF;
 UPDATE public.account_role_notifications SET status='sending',worker_token=v_token,processing_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=n.id;
 RETURN to_jsonb(n)||jsonb_build_object('worker_token',v_token,'email',v_email,'lang',coalesce(v_lang,'en'),'full_name',v_name,'onboarding',v_status);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_account_role_notification(p_id uuid,p_worker uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.account_role_notifications%ROWTYPE;v_target text;
BEGIN
 SELECT * INTO n FROM public.account_role_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR n.status<>'sending' OR n.worker_token IS DISTINCT FROM p_worker OR n.processing_until<=now() THEN RETURN NULL; END IF;
 v_target:=CASE WHEN n.to_role='client' THEN 'homeowner' ELSE n.to_role END;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=n.user_id AND role=v_target) THEN
   UPDATE public.account_role_notifications SET status='superseded',worker_token=NULL,processing_until=NULL WHERE id=n.id; RETURN NULL;
 END IF;
 IF n.payload IS NULL THEN
   IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(p_payload->>'to','')='' THEN RAISE EXCEPTION 'invalid_notification_payload'; END IF;
   UPDATE public.account_role_notifications SET payload=p_payload,first_attempt_at=now() WHERE id=n.id RETURNING payload INTO n.payload;
 END IF;
 RETURN n.payload;
END $$;

CREATE OR REPLACE FUNCTION public.finish_account_role_notification(p_id uuid,p_worker uuid,p_provider text,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.account_role_notifications SET status=CASE WHEN p_provider IS NOT NULL THEN 'sent' ELSE 'failed' END,
   provider_id=p_provider,sent_at=CASE WHEN p_provider IS NOT NULL THEN now() ELSE NULL END,
   last_error=CASE WHEN p_provider IS NOT NULL THEN NULL ELSE left(coalesce(p_error,'delivery_failed'),200) END,
   next_attempt_at=now()+least(60,greatest(1,attempts*5))*interval '1 minute',processing_until=NULL,worker_token=NULL
 WHERE id=p_id AND status='sending' AND worker_token=p_worker;
END $$;
REVOKE ALL ON FUNCTION public.claim_account_role_notification(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_role_notification(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_account_role_notification(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_role_notification(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_role_notification(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_account_role_notification(uuid,uuid,text,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
