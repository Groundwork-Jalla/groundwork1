-- Direct Meta channel. Replay-safe, disabled by default; no GHL credentials or email cursor reuse.
BEGIN;
CREATE TABLE IF NOT EXISTS public.communication_whatsapp_settings(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false,
 mode text NOT NULL DEFAULT 'test' CHECK(mode IN('test','live')),
 phone_number_id text NOT NULL DEFAULT '',business_account_id text NOT NULL DEFAULT '',
 display_phone text NOT NULL DEFAULT '',messaging_account_id text NOT NULL DEFAULT '',
 api_version text NOT NULL DEFAULT 'v27.0' CHECK(api_version ~ '^v[0-9]+\.[0-9]+$'),
 test_recipients text[] NOT NULL DEFAULT '{}',
 template_checked_at timestamptz,
 webhook_verified_at timestamptz,signed_event_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES auth.users ON DELETE SET NULL
);
INSERT INTO public.communication_whatsapp_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.communication_whatsapp_contacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone_number_id text NOT NULL,
 phone text CHECK(phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),bsuid text,
 user_id uuid REFERENCES auth.users ON DELETE SET NULL,name text NOT NULL DEFAULT '',
 consent_at timestamptz,opted_out_at timestamptz,automation_paused boolean NOT NULL DEFAULT false,
 needs_attention boolean NOT NULL DEFAULT false,owner_id uuid REFERENCES auth.users ON DELETE SET NULL,
 last_inbound_at timestamptz,last_message_at timestamptz NOT NULL DEFAULT now(),last_lifecycle_check_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(phone IS NOT NULL OR bsuid IS NOT NULL),UNIQUE(phone_number_id,phone),UNIQUE(phone_number_id,bsuid)
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contact_user ON public.communication_whatsapp_contacts(phone_number_id,user_id) WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.communication_whatsapp_challenges(
 user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,phone_number_id text NOT NULL,
 phone text NOT NULL,code_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.communication_whatsapp_templates(
 name text NOT NULL,language text NOT NULL,definition jsonb NOT NULL,status text NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(name,language)
);
CREATE TABLE IF NOT EXISTS public.communication_whatsapp_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid NOT NULL REFERENCES public.communication_whatsapp_contacts ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN('inbound','outbound')),kind text NOT NULL CHECK(kind IN('lifecycle','staff','test','inbound')),
 enrollment_id uuid REFERENCES public.lifecycle_enrollments ON DELETE SET NULL,position int,step_code text,
 body text NOT NULL DEFAULT '' CHECK(length(body)<=30000),payload jsonb,
 provider_id text UNIQUE,client_ref uuid UNIQUE,actor_id uuid REFERENCES auth.users ON DELETE SET NULL,
 status text NOT NULL CHECK(status IN('queued','sending','sent','delivered','read','failed','blocked','uncertain','received')),
 error text,worker_token uuid,processing_until timestamptz,started_at timestamptz,sent_at timestamptz,
 delivered_at timestamptz,read_at timestamptz,event_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,reviewed_by uuid REFERENCES auth.users ON DELETE SET NULL,review_note text,
 UNIQUE(enrollment_id,position)
);
CREATE INDEX IF NOT EXISTS whatsapp_message_contact ON public.communication_whatsapp_messages(contact_id,created_at);
CREATE INDEX IF NOT EXISTS whatsapp_message_outbox ON public.communication_whatsapp_messages(created_at) WHERE direction='outbound' AND status IN('queued','sending');
ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email' CHECK(channel IN('email','whatsapp'));

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['communication_whatsapp_settings','communication_whatsapp_contacts','communication_whatsapp_templates','communication_whatsapp_messages','communication_whatsapp_challenges'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  IF t<>'communication_whatsapp_challenges' THEN
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
   EXECUTE format('DROP POLICY IF EXISTS whatsapp_admin_read ON public.%I',t);
   EXECUTE format('CREATE POLICY whatsapp_admin_read ON public.%I FOR SELECT TO authenticated USING(public.is_admin())',t);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_lifecycle_state(p_enrollment uuid,p_contact uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE;c public.communication_whatsapp_contacts%ROWTYPE;s public.communication_whatsapp_settings%ROWTYPE;a jsonb;v_email text;
BEGIN
 SELECT * INTO s FROM public.communication_whatsapp_settings WHERE id;
 IF NOT s.enabled THEN RETURN jsonb_build_object('kind','hold','reason','connection_disabled'); END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=p_contact;
 IF NOT FOUND OR c.phone_number_id<>s.phone_number_id THEN RETURN jsonb_build_object('kind','suppress','reason','contact_unavailable'); END IF;
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
 IF NOT FOUND OR e.status NOT IN('active','completed') THEN RETURN jsonb_build_object('kind','suppress','reason','enrollment_inactive'); END IF;
 SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=c.user_id;
 IF v_email IS NULL OR v_email IS DISTINCT FROM lower(btrim(e.email)) THEN RETURN jsonb_build_object('kind','suppress','reason','account_mismatch'); END IF;
 IF c.consent_at IS NULL OR c.opted_out_at IS NOT NULL THEN RETURN jsonb_build_object('kind','suppress','reason','consent_required'); END IF;
 IF c.automation_paused THEN RETURN jsonb_build_object('kind','hold','reason','reply_pending'); END IF;
 IF s.mode='test' AND (c.phone IS NULL OR NOT c.phone=ANY(s.test_recipients)) THEN RETURN jsonb_build_object('kind','hold','reason','test_recipient_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key=e.sequence_key AND enabled) THEN RETURN jsonb_build_object('kind','hold','reason','sequence_disabled'); END IF;
 IF e.sequence_key IN('cs_signup','cs_onboarded','cl_signup') AND (
  EXISTS(SELECT 1 FROM public.contractor_invites WHERE lower(btrim(email))=v_email AND status IN('pending','accepted'))
  OR EXISTS(SELECT 1 FROM public.project_viewers WHERE lower(btrim(email))=v_email AND is_client AND revoked_at IS NULL)
 ) THEN RETURN jsonb_build_object('kind','suppress','reason','invitation_context'); END IF;
 IF EXISTS(SELECT 1 FROM public.communication_preferences WHERE email=v_email AND (activation_unsubscribed OR (project_creation_paused AND e.sequence_key IN('cs_onboarded','cl_signup')))) THEN RETURN jsonb_build_object('kind','suppress','reason','unsubscribed'); END IF;
 IF EXISTS(SELECT 1 FROM public.communication_threads WHERE enrollment_id=e.id AND automation_paused) THEN RETURN jsonb_build_object('kind','hold','reason','reply_pending'); END IF;
 a:=public.lifecycle_action_state(e.id);
 RETURN coalesce(a,jsonb_build_object('kind','suppress','reason','enrollment_unavailable'));
END $$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_consent(p_user uuid,p_phone text,p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.communication_whatsapp_settings%ROWTYPE;
BEGIN
 IF p_phone !~ '^\+[1-9][0-9]{7,14}$' OR p_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user) THEN RAISE EXCEPTION 'invalid_consent_request'; END IF;
 SELECT * INTO s FROM public.communication_whatsapp_settings WHERE id;
 IF s.display_phone='' OR s.phone_number_id='' THEN RAISE EXCEPTION 'not_configured'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wa_consent:'||p_user::text,0));
 IF EXISTS(SELECT 1 FROM public.communication_whatsapp_challenges WHERE user_id=p_user AND created_at>now()-interval '30 seconds') THEN RAISE EXCEPTION 'consent_request_wait'; END IF;
 INSERT INTO public.communication_whatsapp_challenges(user_id,phone_number_id,phone,code_hash,expires_at)
 VALUES(p_user,s.phone_number_id,p_phone,p_hash,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE
 SET phone_number_id=EXCLUDED.phone_number_id,phone=EXCLUDED.phone,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_inbound(p_phone_number text,p_provider text,p_phone text,p_bsuid text,p_name text,p_body text,p_at timestamptz,p_code_hash text DEFAULT NULL,p_stop boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.communication_whatsapp_contacts%ROWTYPE;ch public.communication_whatsapp_challenges%ROWTYPE;
 v_at timestamptz;v_id uuid;v_other uuid;v_email text;e record;t jsonb;v_verified boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.communication_whatsapp_settings WHERE id AND phone_number_id=p_phone_number) THEN RETURN jsonb_build_object('ignored',true); END IF;
 IF p_provider IS NULL OR length(p_provider)>500 OR (p_phone IS NULL AND p_bsuid IS NULL) OR length(coalesce(p_body,''))>30000 OR p_at IS NULL OR p_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid_whatsapp_event'; END IF;
 -- Serialize number/BSUID linking as well as duplicate callbacks.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wa_inbound:'||p_phone_number,0));
 IF EXISTS(SELECT 1 FROM public.communication_whatsapp_messages WHERE provider_id=p_provider) THEN RETURN jsonb_build_object('duplicate',true); END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE phone_number_id=p_phone_number AND ((p_phone IS NOT NULL AND phone=p_phone) OR (p_bsuid IS NOT NULL AND bsuid=p_bsuid)) ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF c.id IS NOT NULL AND ((c.phone IS NOT NULL AND p_phone IS NOT NULL AND c.phone<>p_phone) OR (c.bsuid IS NOT NULL AND p_bsuid IS NOT NULL AND c.bsuid<>p_bsuid)) THEN RAISE EXCEPTION 'whatsapp_identity_conflict'; END IF;
 IF c.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.communication_whatsapp_contacts WHERE phone_number_id=p_phone_number AND id<>c.id AND ((p_phone IS NOT NULL AND phone=p_phone) OR (p_bsuid IS NOT NULL AND bsuid=p_bsuid))) THEN RAISE EXCEPTION 'whatsapp_identity_conflict'; END IF;
 IF c.id IS NULL THEN
  INSERT INTO public.communication_whatsapp_contacts(phone_number_id,phone,bsuid,name,owner_id)
  SELECT p_phone_number,p_phone,p_bsuid,left(coalesce(p_name,''),200),default_owner_id FROM public.communication_settings WHERE id RETURNING * INTO c;
 END IF;
 v_at:=least(p_at,now());
 IF p_code_hash IS NOT NULL AND p_phone IS NOT NULL THEN
  SELECT * INTO ch FROM public.communication_whatsapp_challenges WHERE code_hash=p_code_hash AND phone=p_phone AND phone_number_id=p_phone_number AND expires_at>now() AND created_at<=v_at+interval '1 second' FOR UPDATE;
  IF FOUND AND (c.user_id IS NULL OR c.user_id=ch.user_id) AND (c.opted_out_at IS NULL OR v_at+interval '1 second'>=c.opted_out_at) THEN
   -- Only a proof from the requested phone may connect an account. A new phone retires its former connection.
   UPDATE public.communication_whatsapp_contacts SET user_id=NULL,consent_at=NULL,automation_paused=true WHERE phone_number_id=p_phone_number AND user_id=ch.user_id AND id<>c.id;
   UPDATE public.communication_whatsapp_contacts SET user_id=ch.user_id,consent_at=v_at,opted_out_at=NULL,automation_paused=false,needs_attention=false WHERE id=c.id;
   DELETE FROM public.communication_whatsapp_challenges WHERE user_id=ch.user_id;
   v_verified:=true;
  END IF;
 END IF;
 INSERT INTO public.communication_whatsapp_messages(contact_id,direction,kind,provider_id,body,status,created_at)
 VALUES(c.id,'inbound','inbound',p_provider,coalesce(p_body,''),'received',v_at) RETURNING id INTO v_id;
 UPDATE public.communication_whatsapp_contacts SET phone=coalesce(phone,p_phone),bsuid=coalesce(bsuid,p_bsuid),
  last_inbound_at=greatest(last_inbound_at,v_at),last_message_at=greatest(last_message_at,v_at),
  opted_out_at=CASE WHEN p_stop AND (consent_at IS NULL OR v_at>=consent_at) THEN greatest(opted_out_at,v_at) ELSE opted_out_at END,
  automation_paused=CASE WHEN v_verified THEN false ELSE true END,
  needs_attention=NOT v_verified AND NOT p_stop WHERE id=c.id RETURNING * INTO c;
 UPDATE public.communication_whatsapp_messages SET status='blocked',error=CASE WHEN p_stop THEN 'recipient_opted_out' ELSE 'reply_pending' END WHERE contact_id=c.id AND direction='outbound' AND status='queued' AND kind='lifecycle';
 IF NOT v_verified AND NOT p_stop THEN
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=c.user_id;
  FOR e IN SELECT id FROM public.lifecycle_enrollments WHERE lower(btrim(email))=v_email AND status IN('active','completed') LOOP
   t:=public.ensure_lifecycle_communication(e.id);
   PERFORM public.record_communication_inbound('meta:'||md5(p_provider)||':'||(t->>'thread_id'),(t->>'thread_id')::uuid,v_email,'WhatsApp reply',p_body,p_provider,true,v_at,0);
   UPDATE public.communication_messages SET channel='whatsapp' WHERE provider_id='meta:'||md5(p_provider)||':'||(t->>'thread_id');
  END LOOP;
  INSERT INTO public.notifications(user_id,type,title,body,data)
  SELECT DISTINCT user_id,'communication_whatsapp','WhatsApp reply needs attention',left(coalesce(p_body,''),180),jsonb_build_object('whatsapp_contact_id',c.id)
  FROM public.user_roles WHERE role='admin';
 END IF;
 UPDATE public.communication_whatsapp_settings SET signed_event_at=now() WHERE id;
 RETURN jsonb_build_object('received',true,'contact_id',c.id,'consent_verified',v_verified);
END $$;

CREATE OR REPLACE FUNCTION public.queue_whatsapp_message(p_contact uuid,p_kind text,p_body text,p_payload jsonb,p_enrollment uuid DEFAULT NULL,p_position int DEFAULT NULL,p_step text DEFAULT NULL,p_client_ref uuid DEFAULT NULL,p_actor uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.communication_whatsapp_contacts%ROWTYPE;s public.communication_whatsapp_settings%ROWTYPE;v_id uuid;v_state jsonb;
BEGIN
 IF p_kind NOT IN('lifecycle','staff','test') OR p_payload IS NULL OR length(coalesce(p_body,''))>30000 THEN RAISE EXCEPTION 'invalid_whatsapp_message'; END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=p_contact FOR UPDATE;
 SELECT * INTO s FROM public.communication_whatsapp_settings WHERE id;
 IF c.id IS NULL OR c.phone_number_id<>s.phone_number_id THEN RAISE EXCEPTION 'contact_unavailable'; END IF;
 IF NOT s.enabled THEN RAISE EXCEPTION 'connection_disabled'; END IF;
 IF c.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'recipient_opted_out'; END IF;
 IF s.mode='test' AND (c.phone IS NULL OR NOT c.phone=ANY(s.test_recipients)) THEN RAISE EXCEPTION 'test_recipient_required'; END IF;
 IF p_kind='lifecycle' THEN
  IF p_enrollment IS NULL OR p_position IS NULL THEN RAISE EXCEPTION 'enrollment_required'; END IF;
  v_state:=public.whatsapp_lifecycle_state(p_enrollment,c.id);
  IF v_state->>'kind'<>'ready' THEN RAISE EXCEPTION 'whatsapp_action_unavailable'; END IF;
 ELSE
  IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='admin') THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'client_ref_required'; END IF;
  IF p_kind='staff' AND (c.last_inbound_at IS NULL OR c.last_inbound_at<=now()-interval '24 hours') THEN RAISE EXCEPTION 'outside_24h_window'; END IF;
  IF p_kind='test' AND (s.mode<>'test' OR c.consent_at IS NULL) THEN RAISE EXCEPTION 'consent_required'; END IF;
 END IF;
 INSERT INTO public.communication_whatsapp_messages(contact_id,direction,kind,body,payload,enrollment_id,position,step_code,client_ref,actor_id,status)
 VALUES(c.id,'outbound',p_kind,p_body,p_payload,p_enrollment,p_position,p_step,p_client_ref,p_actor,'queued')
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.communication_whatsapp_messages WHERE (client_ref=p_client_ref AND contact_id=p_contact) OR (enrollment_id=p_enrollment AND position=p_position); END IF;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_message(p_message uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_whatsapp_messages%ROWTYPE;c public.communication_whatsapp_contacts%ROWTYPE;s public.communication_whatsapp_settings%ROWTYPE;a jsonb;v_error text;
BEGIN
 SELECT * INTO m FROM public.communication_whatsapp_messages WHERE id=p_message FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR m.direction<>'outbound' OR m.status NOT IN('queued','sending') THEN RETURN NULL; END IF;
 IF m.status='sending' THEN
  IF m.processing_until<=now() THEN UPDATE public.communication_whatsapp_messages SET status='uncertain',error='uncertain_send',worker_token=NULL,processing_until=NULL WHERE id=m.id; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=m.contact_id FOR UPDATE;
 SELECT * INTO s FROM public.communication_whatsapp_settings WHERE id;
 IF NOT s.enabled OR s.phone_number_id<>c.phone_number_id THEN v_error:='connection_disabled';
 ELSIF c.opted_out_at IS NOT NULL THEN v_error:='recipient_opted_out';
 ELSIF s.mode='test' AND (c.phone IS NULL OR NOT c.phone=ANY(s.test_recipients)) THEN v_error:='test_recipient_required';
 ELSIF m.kind='lifecycle' THEN
  a:=public.whatsapp_lifecycle_state(m.enrollment_id,c.id);
  IF a->>'kind'<>'ready' THEN v_error:=a->>'reason'; END IF;
  IF EXISTS(SELECT 1 FROM public.communication_whatsapp_messages WHERE enrollment_id=m.enrollment_id AND status='uncertain') THEN v_error:='uncertain_send'; END IF;
 ELSIF m.kind='staff' AND (c.last_inbound_at IS NULL OR c.last_inbound_at<=now()-interval '24 hours') THEN v_error:='outside_24h_window';
 ELSIF m.kind='test' AND (s.mode<>'test' OR c.consent_at IS NULL) THEN v_error:='consent_required';
 END IF;
 IF v_error IS NOT NULL THEN UPDATE public.communication_whatsapp_messages SET status='blocked',error=v_error WHERE id=m.id; RETURN NULL; END IF;
 UPDATE public.communication_whatsapp_messages SET status='sending',started_at=now(),worker_token=gen_random_uuid(),processing_until=now()+interval '2 minutes' WHERE id=m.id RETURNING * INTO m;
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.finish_whatsapp_message(p_message uuid,p_token uuid,p_status text,p_provider text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_whatsapp_messages%ROWTYPE;c public.communication_whatsapp_contacts%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;t jsonb;v_status text;
BEGIN
 IF p_status NOT IN('sent','failed','uncertain') OR (p_status='sent' AND coalesce(p_provider,'')='') THEN RAISE EXCEPTION 'invalid_whatsapp_result'; END IF;
 SELECT * INTO m FROM public.communication_whatsapp_messages WHERE id=p_message FOR UPDATE;
 IF NOT FOUND OR m.worker_token IS DISTINCT FROM p_token OR p_token IS NULL THEN RETURN false; END IF;
 -- A signed callback may have arrived before the HTTP response; never downgrade it.
 v_status:=CASE WHEN m.status IN('sent','delivered','read','failed') THEN m.status ELSE p_status END;
 UPDATE public.communication_whatsapp_messages SET status=v_status,provider_id=coalesce(provider_id,p_provider),
  sent_at=CASE WHEN v_status IN('sent','delivered','read') THEN coalesce(sent_at,now()) ELSE sent_at END,
  error=CASE WHEN v_status IN('sent','delivered','read') THEN NULL ELSE coalesce(error,p_error) END,
  worker_token=NULL,processing_until=NULL WHERE id=m.id RETURNING * INTO m;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=m.contact_id;
 IF v_status IN('sent','delivered','read') THEN
  UPDATE public.communication_whatsapp_contacts SET last_message_at=greatest(last_message_at,now()) WHERE id=c.id;
  IF m.kind='staff' AND c.user_id IS NOT NULL THEN
   SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN auth.users u ON lower(btrim(u.email))=lower(btrim(e0.email)) WHERE u.id=c.user_id ORDER BY e0.enrolled_at DESC LIMIT 1;
   IF e.id IS NOT NULL THEN
    t:=public.ensure_lifecycle_communication(e.id);
    INSERT INTO public.communication_messages(thread_id,direction,channel,provider_id,body,actor_id,client_ref,status,sent_at)
    VALUES((t->>'thread_id')::uuid,'outbound','whatsapp','meta:'||md5(m.id::text),m.body,m.actor_id,m.client_ref,'sent',m.sent_at) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_status(p_phone_number text,p_provider text,p_status text,p_at timestamptz,p_message uuid DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_whatsapp_messages%ROWTYPE;
BEGIN
 IF p_status NOT IN('sent','delivered','read','failed') OR p_provider IS NULL OR p_at IS NULL THEN RETURN; END IF;
 SELECT m0.* INTO m FROM public.communication_whatsapp_messages m0 JOIN public.communication_whatsapp_contacts c ON c.id=m0.contact_id
 WHERE c.phone_number_id=p_phone_number AND m0.direction='outbound' AND (m0.provider_id=p_provider OR (m0.id=p_message AND m0.started_at IS NOT NULL AND (m0.provider_id IS NULL OR m0.provider_id=p_provider))) FOR UPDATE OF m0;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.communication_whatsapp_messages SET provider_id=p_provider,
  status=CASE WHEN status='read' THEN 'read' WHEN p_status='read' THEN 'read' WHEN status='delivered' THEN 'delivered' WHEN p_status='delivered' THEN 'delivered' WHEN status='failed' THEN 'failed' ELSE p_status END,
  sent_at=CASE WHEN p_status<>'failed' THEN coalesce(sent_at,least(p_at,now())) ELSE sent_at END,
  delivered_at=CASE WHEN p_status IN('delivered','read') THEN coalesce(delivered_at,least(p_at,now())) ELSE delivered_at END,
  read_at=CASE WHEN p_status='read' THEN coalesce(read_at,least(p_at,now())) ELSE read_at END,
  error=CASE WHEN status IN('delivered','read') OR p_status IN('delivered','read') THEN NULL WHEN p_status='failed' THEN left(p_error,200) ELSE error END,
  event_at=greatest(event_at,least(p_at,now())) WHERE id=m.id;
 UPDATE public.communication_whatsapp_settings SET signed_event_at=now() WHERE id;
END $$;

CREATE OR REPLACE FUNCTION public.review_whatsapp_followup(p_enrollment uuid,p_contact uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb;e public.lifecycle_enrollments%ROWTYPE;s public.lifecycle_sequences%ROWTYPE;c public.communication_whatsapp_contacts%ROWTYPE;v_progress jsonb;v_qualified boolean;
BEGIN
 a:=public.whatsapp_lifecycle_state(p_enrollment,p_contact);
 IF a->>'kind'<>'ready' THEN RETURN false; END IF;
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
 SELECT * INTO s FROM public.lifecycle_sequences WHERE key=e.sequence_key;
 IF s.followup_after_days IS NULL OR e.enrolled_at+s.followup_after_days*interval '1 day'>now() THEN RETURN false; END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=p_contact;
 IF e.sequence_key IN('cs_signup','ci_onboarding') THEN SELECT public.contractor_onboarding_status(c.user_id) INTO v_progress; END IF;
 v_qualified:=coalesce((a->>'qualified')::boolean,false)
  OR EXISTS(SELECT 1 FROM public.communication_whatsapp_messages WHERE enrollment_id=e.id AND read_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.communication_threads t JOIN public.communication_messages m ON m.thread_id=t.id WHERE t.enrollment_id=e.id AND m.direction='inbound' AND m.authenticated)
  OR (SELECT count(*)>=3 FROM jsonb_each(coalesce(v_progress->'steps','{}')) WHERE key IN('identity','professional','payout','emergency','agreements') AND value='true'::jsonb);
 IF NOT v_qualified THEN RETURN false; END IF;
 INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,reason,priority,context,due_at)
 VALUES(e.id,e.sequence_key,e.email,e.full_name,c.phone,'No action after Day '||s.followup_after_days||': '||s.awaiting_action,
  CASE WHEN e.context->>'project_id' IS NOT NULL OR e.context->>'entry_source' IN('referral','direct_outreach') THEN 'high' ELSE 'normal' END,e.context,now())
 ON CONFLICT(enrollment_id) DO NOTHING;
 UPDATE public.lifecycle_enrollments SET followup_queued=true WHERE id=e.id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.review_whatsapp_send(p_message uuid,p_actor uuid,p_sent boolean,p_provider text,p_note text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='admin') THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 10 AND 1000 OR p_sent IS NULL OR (p_sent AND (coalesce(p_provider,'')='' OR length(p_provider)>500)) THEN RAISE EXCEPTION 'review_details_required'; END IF;
 UPDATE public.communication_whatsapp_messages SET status=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
  provider_id=CASE WHEN p_sent THEN p_provider ELSE provider_id END,
  sent_at=CASE WHEN p_sent THEN coalesce(sent_at,now()) ELSE sent_at END,
  error=CASE WHEN p_sent THEN NULL ELSE 'manually_confirmed_not_sent' END,
  reviewed_at=now(),reviewed_by=p_actor,review_note=btrim(p_note),worker_token=NULL,processing_until=NULL
 WHERE id=p_message AND direction='outbound' AND status='uncertain';
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.resume_whatsapp_contact(p_contact uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.communication_whatsapp_contacts%ROWTYPE;v_email text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='admin') THEN RAISE EXCEPTION 'not_admin'; END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=p_contact FOR UPDATE;
 IF NOT FOUND OR c.consent_at IS NULL THEN RAISE EXCEPTION 'consent_required'; END IF;
 IF c.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'recipient_opted_out'; END IF;
 UPDATE public.communication_whatsapp_contacts SET automation_paused=false,needs_attention=false WHERE id=c.id;
 SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id=c.user_id;
 -- Clear only holds created by WhatsApp. A later email reply remains awaiting review.
 UPDATE public.communication_threads t SET automation_paused=false WHERE t.email=v_email AND t.automation_paused
  AND t.last_inbound_at<=c.last_inbound_at
  AND EXISTS(SELECT 1 FROM public.communication_messages m WHERE m.thread_id=t.id AND m.direction='inbound' AND m.channel='whatsapp' AND m.created_at=t.last_inbound_at)
  AND NOT EXISTS(SELECT 1 FROM public.communication_messages m WHERE m.thread_id=t.id AND m.direction='inbound' AND m.channel='email' AND m.created_at>=t.last_inbound_at);
 UPDATE public.communication_whatsapp_messages SET status='queued',error=NULL WHERE contact_id=c.id AND direction='outbound' AND kind='lifecycle' AND status='blocked' AND started_at IS NULL AND error IN('reply_pending','awaiting_staff_response');
END $$;
CREATE OR REPLACE FUNCTION public.track_whatsapp_staff_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.communication_whatsapp_contacts%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;t jsonb;
BEGIN
 IF NEW.direction<>'outbound' OR NEW.kind<>'staff' OR NEW.status NOT IN('sent','delivered','read') OR NEW.sent_at IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM public.communication_whatsapp_contacts WHERE id=NEW.contact_id;
 SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN auth.users u ON lower(btrim(u.email))=lower(btrim(e0.email)) WHERE u.id=c.user_id ORDER BY e0.enrolled_at DESC LIMIT 1;
 IF e.id IS NOT NULL THEN
  t:=public.ensure_lifecycle_communication(e.id);
  INSERT INTO public.communication_messages(thread_id,direction,channel,provider_id,body,actor_id,client_ref,status,sent_at)
  VALUES((t->>'thread_id')::uuid,'outbound','whatsapp','meta:'||md5(NEW.id::text),NEW.body,NEW.actor_id,NEW.client_ref,'sent',NEW.sent_at) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS whatsapp_staff_contact_history ON public.communication_whatsapp_messages;
CREATE TRIGGER whatsapp_staff_contact_history AFTER INSERT OR UPDATE OF status ON public.communication_whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.track_whatsapp_staff_contact();
REVOKE ALL ON FUNCTION public.review_whatsapp_send(uuid,uuid,boolean,text,text),public.resume_whatsapp_contact(uuid,uuid),public.track_whatsapp_staff_contact() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_whatsapp_send(uuid,uuid,boolean,text,text),public.resume_whatsapp_contact(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.review_whatsapp_followup(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_whatsapp_followup(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_lifecycle_state(uuid,uuid),public.begin_whatsapp_consent(uuid,text,text),public.record_whatsapp_inbound(text,text,text,text,text,text,timestamptz,text,boolean),public.queue_whatsapp_message(uuid,text,text,jsonb,uuid,int,text,uuid,uuid),public.claim_whatsapp_message(uuid),public.finish_whatsapp_message(uuid,uuid,text,text,text),public.record_whatsapp_status(text,text,text,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_lifecycle_state(uuid,uuid),public.begin_whatsapp_consent(uuid,text,text),public.record_whatsapp_inbound(text,text,text,text,text,text,timestamptz,text,boolean),public.queue_whatsapp_message(uuid,text,text,jsonb,uuid,int,text,uuid,uuid),public.claim_whatsapp_message(uuid),public.finish_whatsapp_message(uuid,uuid,text,text,text),public.record_whatsapp_status(text,text,text,timestamptz,uuid,text) TO service_role;
COMMIT;
