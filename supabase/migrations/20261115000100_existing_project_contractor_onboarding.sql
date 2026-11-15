-- Finish the required contractor form without asking an existing project member
-- to create another project or to opt out of project reminders.
BEGIN;

ALTER TABLE public.contractor_onboarding DROP CONSTRAINT IF EXISTS contractor_onboarding_client_intent_check;
ALTER TABLE public.contractor_onboarding ADD CONSTRAINT contractor_onboarding_client_intent_check
 CHECK(client_intent IN('onboard_client','create_project','no_client','existing_project'));

CREATE OR REPLACE FUNCTION public.contractor_existing_project_context(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=coalesce(p_user,auth.uid()); v_count int; v_path text;
 v_service boolean:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role';
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 IF NOT v_service AND (auth.uid() IS NULL OR (v_user<>auth.uid() AND NOT public.is_admin())) THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT count(*),min(CASE WHEN EXISTS(SELECT 1 FROM public.contractor_invites c
   WHERE c.project_id=p.id AND c.contractor_user_id=v_user AND c.status='accepted')
   THEN '/work/projects/'||p.id ELSE '/projects/'||p.id END)
 INTO v_count,v_path FROM public.projects p WHERE p.status::text<>'archived' AND (
   p.user_id=v_user
   OR EXISTS(SELECT 1 FROM public.contractor_invites c WHERE c.project_id=p.id AND c.contractor_user_id=v_user AND c.status='accepted')
   OR EXISTS(SELECT 1 FROM public.project_viewers v WHERE v.project_id=p.id AND v.user_id=v_user AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL)
 );
 RETURN jsonb_build_object('existing_project_count',v_count,
   'existing_project_path',CASE WHEN v_count=1 THEN v_path WHEN v_count>1 THEN '/work/projects' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.contractor_existing_project_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contractor_existing_project_context(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.contractor_onboarding_status(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=coalesce(p_user,auth.uid()); r public.contractor_onboarding%ROWTYPE;
 v_context jsonb; v_identity boolean; v_professional boolean; v_payout boolean;
 v_emergency boolean; v_documents boolean; v_agreements boolean; v_registered boolean;
BEGIN
 -- This reader enforces self/admin/service access before returning personal data.
 v_context:=public.contractor_existing_project_context(v_user);
 SELECT * INTO r FROM public.contractor_onboarding WHERE user_id=v_user;
 v_identity:=r.date_of_birth IS NOT NULL AND coalesce(btrim(r.residential_address),'')<>'';
 v_registered:=coalesce(r.business_status='registered',false);
 v_professional:=coalesce(btrim(r.specialty),'')<>'' AND (
   NOT public.specialty_needs_licence(r.specialty) OR coalesce(btrim(r.license_number),'')<>'');
 v_payout:=EXISTS(SELECT 1 FROM public.payout_destinations WHERE owner_id=v_user AND status<>'retired');
 v_emergency:=(SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id=v_user)>=1;
 v_documents:=EXISTS(SELECT 1 FROM public.contractor_documents WHERE user_id=v_user AND kind='professional_license')
   AND (NOT v_registered OR EXISTS(SELECT 1 FROM public.contractor_documents WHERE user_id=v_user AND kind='business_registration'));
 v_agreements:=EXISTS(SELECT 1 FROM public.agreement_acceptances a WHERE a.user_id=v_user
   AND a.document='terms_of_service' AND a.version=public.current_agreement_version('terms_of_service'));
 RETURN v_context||jsonb_build_object('user_id',v_user,
   'steps',jsonb_build_object('identity',v_identity,'professional',coalesce(v_professional,false),
     'payout',v_payout,'emergency',v_emergency,'documents',v_documents,'agreements',v_agreements),
   'specialty',r.specialty,'specialty_other',r.specialty_other,
   'needs_licence',coalesce(public.specialty_needs_licence(r.specialty),false),
   'business_status',r.business_status,'business_registered',v_registered,'needs_business_doc',v_registered,
   'emergency_count',(SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id=v_user),
   'client_intent',r.client_intent,
   'complete',coalesce(v_agreements AND v_identity AND v_professional AND v_payout AND v_emergency,false));
END $$;
REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.set_contractor_client_intent(p_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=public.assert_own_onboarding(); v_status jsonb;
BEGIN
 IF p_intent IS NULL OR p_intent NOT IN('onboard_client','create_project','no_client','existing_project') THEN RAISE EXCEPTION 'bad_intent'; END IF;
 IF p_intent='existing_project' THEN
   v_status:=public.contractor_onboarding_status(v_user);
   IF NOT coalesce((v_status->>'complete')::boolean,false) THEN RAISE EXCEPTION 'onboarding_incomplete'; END IF;
   IF coalesce((v_status->>'existing_project_count')::int,0)=0 THEN RAISE EXCEPTION 'existing_project_unavailable'; END IF;
 END IF;
 INSERT INTO public.contractor_onboarding(user_id,client_intent,client_intent_at) VALUES(v_user,p_intent,now())
 ON CONFLICT(user_id) DO UPDATE SET client_intent=EXCLUDED.client_intent,client_intent_at=now(),updated_at=now();
 IF p_intent='create_project' THEN
   UPDATE public.communication_preferences SET project_creation_paused=false,updated_at=now()
     WHERE email=(SELECT lower(btrim(email)) FROM auth.users WHERE id=v_user);
 ELSIF p_intent IN('no_client','existing_project') THEN
   UPDATE public.lifecycle_enrollments SET status=CASE WHEN p_intent='existing_project' THEN 'exited' ELSE 'suppressed' END,
     exit_reason=CASE WHEN p_intent='existing_project' THEN 'project_available' ELSE 'no_active_project_selected' END,
     next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE sequence_key='cs_onboarded' AND status='active'
     AND lower(btrim(email))=(SELECT lower(btrim(email)) FROM auth.users WHERE id=v_user);
 END IF;
 RETURN public.contractor_onboarding_status(v_user);
END $$;
REVOKE ALL ON FUNCTION public.set_contractor_client_intent(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_contractor_client_intent(text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
