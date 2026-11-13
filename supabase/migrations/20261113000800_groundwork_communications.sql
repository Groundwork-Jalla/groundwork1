-- Groundwork owns activation communications. Delivery remains off until configured
-- and explicitly enabled in Admin. No migration sends messages or enables journeys.
BEGIN;
-- The managed CS05 journey replaces the independent best-effort acknowledgement
-- from migration 161. Keep its historical log, but retire the duplicate sender.
DROP TRIGGER IF EXISTS trg_contractor_onboarding_complete_email ON public.contractor_onboarding;
ALTER TABLE public.contractor_onboarding DROP CONSTRAINT IF EXISTS contractor_onboarding_client_intent_check;
ALTER TABLE public.contractor_onboarding ADD CONSTRAINT contractor_onboarding_client_intent_check
 CHECK(client_intent IN('onboard_client','create_project','no_client'));
CREATE OR REPLACE FUNCTION public.set_contractor_client_intent(p_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=public.assert_own_onboarding();
BEGIN
 IF p_intent IS NULL OR p_intent NOT IN('onboard_client','create_project','no_client') THEN RAISE EXCEPTION 'bad_intent'; END IF;
 INSERT INTO public.contractor_onboarding(user_id,client_intent,client_intent_at) VALUES(v_user,p_intent,now())
 ON CONFLICT(user_id) DO UPDATE SET client_intent=EXCLUDED.client_intent,client_intent_at=now(),updated_at=now();
 IF p_intent='create_project' THEN
  UPDATE public.communication_preferences SET project_creation_paused=false,updated_at=now() WHERE email=(SELECT lower(btrim(email)) FROM auth.users WHERE id=v_user);
 ELSIF p_intent='no_client' THEN
  UPDATE public.lifecycle_enrollments SET status='suppressed',exit_reason='no_active_project_selected',next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE sequence_key='cs_onboarded' AND status='active' AND lower(btrim(email))=(SELECT lower(btrim(email)) FROM auth.users WHERE id=v_user);
 END IF;
 RETURN public.contractor_onboarding_status(v_user);
END $$;

CREATE TABLE IF NOT EXISTS public.communication_settings(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 delivery_enabled boolean NOT NULL DEFAULT false,
 sender_name text NOT NULL DEFAULT 'Groundwork by Jalla',sender_email text DEFAULT 'noreply@mail.tryjalla.com',
 followup_sender_email text NOT NULL DEFAULT 'contact@tryjalla.com',
 application_sender_email text NOT NULL DEFAULT 'partner@tryjalla.com',
 reply_domain text,
 test_recipients text[] NOT NULL DEFAULT '{}',
 default_owner_id uuid REFERENCES auth.users ON DELETE SET NULL,
 next_contact_hours int NOT NULL DEFAULT 48 CHECK(next_contact_hours BETWEEN 1 AND 720),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES auth.users ON DELETE SET NULL
);
-- Upgrade the early deployed copy as well as fresh installs. CREATE TABLE IF
-- NOT EXISTS leaves an existing table's columns untouched.
ALTER TABLE public.communication_settings
 ADD COLUMN IF NOT EXISTS followup_sender_email text NOT NULL DEFAULT 'contact@tryjalla.com',
 ADD COLUMN IF NOT EXISTS application_sender_email text NOT NULL DEFAULT 'partner@tryjalla.com';
ALTER TABLE public.communication_settings ALTER COLUMN sender_email SET DEFAULT 'noreply@mail.tryjalla.com';
INSERT INTO public.communication_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
UPDATE public.communication_settings SET sender_email='noreply@mail.tryjalla.com',updated_at=clock_timestamp()
 WHERE sender_email IS NULL;
CREATE TABLE IF NOT EXISTS public.communication_preferences(
 email text PRIMARY KEY CHECK(email=lower(btrim(email))),
 token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 lang text NOT NULL DEFAULT 'en' CHECK(lang IN('en','fr')),
 activation_unsubscribed boolean NOT NULL DEFAULT false,
 project_creation_paused boolean NOT NULL DEFAULT false,
 blocked_reason text CHECK(blocked_reason IN('bounced','complained','delivery_failed')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.communication_threads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL UNIQUE REFERENCES public.lifecycle_enrollments ON DELETE CASCADE,
 email text NOT NULL REFERENCES public.communication_preferences(email),
 reply_domains text[] NOT NULL DEFAULT '{}',
 automation_paused boolean NOT NULL DEFAULT false,
 last_message_at timestamptz NOT NULL DEFAULT now(),
 last_inbound_at timestamptz,last_outbound_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.communication_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL REFERENCES public.communication_threads ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN('inbound','outbound')),
 provider_id text UNIQUE,provider_message_id text,in_reply_to text,
 subject text NOT NULL DEFAULT '' CHECK(length(subject)<=300),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=30000),
 authenticated boolean NOT NULL DEFAULT true,attachment_count int NOT NULL DEFAULT 0 CHECK(attachment_count>=0),
 actor_id uuid REFERENCES auth.users ON DELETE SET NULL,
 client_ref uuid UNIQUE,
 status text NOT NULL CHECK(status IN('queued','sending','sent','received','delivered','bounced','complained','failed','blocked')),
 payload jsonb,worker_token uuid,processing_until timestamptz,
 started_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,provider_event_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_message_thread ON public.communication_messages(thread_id,created_at);
ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS sent_at timestamptz;
-- Preserve already recorded staff contacts when installing the one-time send
-- history trigger. Repeated provider callbacks must not count old replies again.
UPDATE public.communication_messages SET sent_at=coalesce(provider_event_at,started_at,created_at)
 WHERE direction='outbound' AND client_ref IS NOT NULL AND provider_id IS NOT NULL
 AND status IN('sent','delivered','bounced','complained') AND sent_at IS NULL;
CREATE INDEX IF NOT EXISTS communication_message_due ON public.communication_messages(next_attempt_at) WHERE direction='outbound' AND status IN('queued','failed','sending');
CREATE TABLE IF NOT EXISTS public.communication_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,status text NOT NULL DEFAULT 'running' CHECK(status IN('running','complete','failed')),
 counts jsonb NOT NULL DEFAULT '{}',error text
);
CREATE TABLE IF NOT EXISTS public.communication_issues(
 key text PRIMARY KEY,code text NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'activation' CHECK(kind IN('activation','reply','delivery'));
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users ON DELETE SET NULL;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'pending' CHECK(contact_status IN('pending','contacted','awaiting_reply','needs_attention'));
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;
CREATE INDEX IF NOT EXISTS communication_followup_review ON public.followup_queue(last_reviewed_at NULLS FIRST,created_at) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.communication_followup_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),followup_id uuid NOT NULL REFERENCES public.followup_queue ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users ON DELETE SET NULL,kind text NOT NULL,note text NOT NULL DEFAULT '',
 due_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS communication_followup_overdue_once ON public.communication_followup_events(followup_id,due_at) WHERE kind='overdue';
ALTER TABLE public.lifecycle_deliveries ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE public.lifecycle_deliveries ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz;
ALTER TABLE public.lifecycle_deliveries ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.lifecycle_deliveries ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['communication_settings','communication_preferences','communication_threads','communication_messages','communication_runs','communication_issues','communication_followup_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS communication_admin_read ON public.%I',t);
  EXECUTE format('CREATE POLICY communication_admin_read ON public.%I FOR SELECT TO authenticated USING(public.is_admin())',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS admin_all_followup_queue ON public.followup_queue;
DROP POLICY IF EXISTS communication_admin_read ON public.followup_queue;
CREATE POLICY communication_admin_read ON public.followup_queue FOR SELECT TO authenticated USING(public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_save_communication_settings(p_settings jsonb,p_expected_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.communication_settings%ROWTYPE; v_name text; v_email text; v_followup text; v_application text; v_domain text; v_owner uuid; v_test text[]; v_enabled boolean; v_hours int;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 SELECT * INTO s FROM public.communication_settings WHERE id FOR UPDATE;
 IF s.updated_at IS DISTINCT FROM p_expected_at THEN RAISE EXCEPTION 'stale_settings'; END IF;
 v_name:=btrim(p_settings->>'sender_name');v_email:=lower(btrim(p_settings->>'sender_email'));v_domain:=lower(btrim(p_settings->>'reply_domain'));
 v_followup:=lower(btrim(coalesce(p_settings->>'followup_sender_email',s.followup_sender_email)));
 v_application:=lower(btrim(coalesce(p_settings->>'application_sender_email',s.application_sender_email)));
 v_owner:=nullif(p_settings->>'default_owner_id','')::uuid;
 v_enabled:=coalesce((p_settings->>'delivery_enabled')::boolean,false);v_hours:=coalesce((p_settings->>'next_contact_hours')::int,48);
 SELECT coalesce(array_agg(DISTINCT lower(btrim(value))),'{}') INTO v_test FROM jsonb_array_elements_text(coalesce(p_settings->'test_recipients','[]')) value WHERE btrim(value)<>'';
 IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 100 OR v_name~'[<>\r\n]' OR v_hours NOT BETWEEN 1 AND 720 OR cardinality(v_test)>100 THEN RAISE EXCEPTION 'invalid_settings'; END IF;
 IF coalesce(v_email,'')<>'' AND v_email!~'^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN RAISE EXCEPTION 'invalid_sender'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[v_followup,v_application]) value WHERE coalesce(value,'')!~'^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') THEN RAISE EXCEPTION 'invalid_sender'; END IF;
 IF coalesce(v_domain,'')<>'' AND v_domain!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN RAISE EXCEPTION 'invalid_reply_domain'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_test) value WHERE value!~'^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$') THEN RAISE EXCEPTION 'invalid_test_recipient'; END IF;
 IF v_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_owner AND role='admin') THEN RAISE EXCEPTION 'owner_must_be_admin'; END IF;
 IF v_enabled AND (coalesce(v_email,'')='' OR coalesce(v_domain,'')='') THEN RAISE EXCEPTION 'configure_sender_and_replies'; END IF;
 UPDATE public.communication_settings SET sender_name=v_name,sender_email=nullif(v_email,''),reply_domain=nullif(v_domain,''),
  followup_sender_email=v_followup,application_sender_email=v_application,
  delivery_enabled=v_enabled,test_recipients=v_test,default_owner_id=v_owner,next_contact_hours=v_hours,updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id RETURNING * INTO s;
 RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.communication_preference_preview(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('lang',lang,'project_creation_paused',project_creation_paused,'activation_unsubscribed',activation_unsubscribed)
 FROM public.communication_preferences WHERE token=p_token;
$$;
CREATE OR REPLACE FUNCTION public.set_communication_preference(p_token uuid,p_choice text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.communication_preferences%ROWTYPE;
BEGIN
 IF p_choice IS NULL OR p_choice NOT IN('pause_project','unsubscribe','resume') THEN RAISE EXCEPTION 'invalid_preference'; END IF;
 SELECT * INTO p FROM public.communication_preferences WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'preference_link_unavailable'; END IF;
 UPDATE public.communication_preferences SET
  project_creation_paused=CASE WHEN p_choice='pause_project' THEN true WHEN p_choice='resume' THEN false ELSE project_creation_paused END,
  activation_unsubscribed=CASE WHEN p_choice='unsubscribe' THEN true WHEN p_choice='resume' THEN false ELSE activation_unsubscribed END,updated_at=now() WHERE email=p.email;
 -- Resuming preferences permits future journeys; it never replays old messages.
 IF p_choice IN('pause_project','unsubscribe') THEN
  UPDATE public.lifecycle_enrollments SET status='suppressed',exit_reason=CASE WHEN p_choice='pause_project' THEN 'no_active_project_selected' ELSE 'unsubscribed' END,
   next_send_at=NULL,processing_token=NULL,processing_until=NULL
  WHERE lower(btrim(email))=p.email AND status IN('active','completed') AND (p_choice='unsubscribe' OR sequence_key='cs_onboarded');
 END IF;
 RETURN public.communication_preference_preview(p_token);
END $$;

CREATE OR REPLACE FUNCTION public.ensure_lifecycle_communication(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE;p public.communication_preferences%ROWTYPE;t public.communication_threads%ROWTYPE;v_domain text;
BEGIN
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_missing'; END IF;
 INSERT INTO public.communication_preferences(email,lang) VALUES(lower(btrim(e.email)),CASE WHEN e.lang='fr' THEN 'fr' ELSE 'en' END) ON CONFLICT(email) DO UPDATE SET lang=EXCLUDED.lang;
 SELECT * INTO p FROM public.communication_preferences WHERE email=lower(btrim(e.email));
 INSERT INTO public.communication_threads(enrollment_id,email) VALUES(e.id,p.email) ON CONFLICT(enrollment_id) DO NOTHING;
 SELECT reply_domain INTO v_domain FROM public.communication_settings WHERE id;
 IF v_domain IS NOT NULL THEN UPDATE public.communication_threads SET reply_domains=array_append(reply_domains,v_domain) WHERE enrollment_id=e.id AND NOT v_domain=ANY(reply_domains); END IF;
 SELECT * INTO t FROM public.communication_threads WHERE enrollment_id=e.id;
 RETURN jsonb_build_object('thread_id',t.id,'preference_token',p.token);
END $$;

CREATE OR REPLACE FUNCTION public.assign_communication_followup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.owner_id IS NULL THEN SELECT default_owner_id INTO NEW.owner_id FROM public.communication_settings s WHERE id AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=s.default_owner_id AND role='admin'); END IF;
 IF NEW.reason LIKE 'Delivery review:%' THEN NEW.kind:='delivery'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_followup_assignment ON public.followup_queue;
CREATE TRIGGER communication_followup_assignment BEFORE INSERT ON public.followup_queue FOR EACH ROW EXECUTE FUNCTION public.assign_communication_followup();

CREATE OR REPLACE FUNCTION public.admin_followup_action(p_id uuid,p_action text,p_note text DEFAULT '',p_due_at timestamptz DEFAULT NULL,p_owner uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.followup_queue%ROWTYPE;v_state jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 SELECT * INTO f FROM public.followup_queue WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR f.status<>'open' THEN RAISE EXCEPTION 'followup_closed'; END IF;
 IF length(coalesce(p_note,''))>5000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
 IF p_action='assign' THEN
  IF p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_owner AND role='admin') THEN RAISE EXCEPTION 'owner_must_be_admin'; END IF;
  UPDATE public.followup_queue SET owner_id=p_owner WHERE id=f.id;
 ELSIF p_action IN('contacted','awaiting_reply','reschedule') THEN
  IF coalesce(btrim(p_note),'')='' THEN RAISE EXCEPTION 'contact_note_required'; END IF;
  IF p_due_at IS NULL OR p_due_at<=now() OR p_due_at>now()+interval '90 days' THEN RAISE EXCEPTION 'future_followup_required'; END IF;
  UPDATE public.followup_queue SET note=p_note,due_at=p_due_at,escalated_at=NULL,
   contact_status=CASE WHEN p_action='reschedule' THEN contact_status ELSE p_action END,
   attempt_count=attempt_count+CASE WHEN p_action='reschedule' THEN 0 ELSE 1 END,
   last_contacted_at=CASE WHEN p_action='reschedule' THEN last_contacted_at ELSE now() END WHERE id=f.id;
 ELSIF p_action='resolve' THEN
  v_state:=public.lifecycle_enrollment_state(f.enrollment_id);
  IF f.kind='activation' AND coalesce(v_state->>'kind','') NOT IN('complete','suppress') THEN RAISE EXCEPTION 'required_action_incomplete'; END IF;
  IF f.kind<>'activation' AND coalesce(btrim(p_note),'')='' THEN RAISE EXCEPTION 'resolution_note_required'; END IF;
  UPDATE public.followup_queue SET status='done',resolved_at=now(),note=CASE WHEN btrim(coalesce(p_note,''))<>'' THEN p_note ELSE note END WHERE id=f.id;
 ELSE RAISE EXCEPTION 'invalid_followup_action'; END IF;
 INSERT INTO public.communication_followup_events(followup_id,actor_id,kind,note,due_at) VALUES(f.id,auth.uid(),p_action,coalesce(p_note,''),p_due_at);
END $$;

CREATE OR REPLACE FUNCTION public.admin_resume_communication(p_thread uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 UPDATE public.communication_threads SET automation_paused=false WHERE id=p_thread;
END $$;

REVOKE ALL ON FUNCTION public.admin_save_communication_settings(jsonb,timestamptz),public.admin_followup_action(uuid,text,text,timestamptz,uuid),public.admin_resume_communication(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_communication_settings(jsonb,timestamptz),public.admin_followup_action(uuid,text,text,timestamptz,uuid),public.admin_resume_communication(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.communication_preference_preview(uuid),public.set_communication_preference(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_preference_preview(uuid),public.set_communication_preference(uuid,text) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ensure_lifecycle_communication(uuid),public.assign_communication_followup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_lifecycle_communication(uuid) TO service_role;
COMMIT;
