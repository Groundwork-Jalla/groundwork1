-- Incremental repair for the early deployed communication schema.
-- Adds missing fields and installs the final communication RPCs/triggers in one
-- transaction. Existing preferences, messages, owners, consent, delivery switches
-- and sequence enablement are preserved. No messages are sent by this migration.
-- Frozen recovery snapshot of the three source migrations listed below.
BEGIN;

-- Source: 20261113000800_groundwork_communications.sql
-- Groundwork owns activation communications. Delivery remains off until configured
-- and explicitly enabled in Admin. No migration sends messages or enables journeys.
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

-- Source: 20261113000900_communication_delivery_and_replies.sql
-- Authoritative actions, preferences, staff replies and durable provider events.
CREATE OR REPLACE FUNCTION public.lifecycle_action_state(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE; v_uid uuid; v_project uuid;
  v_owner uuid; v_status text; v_intent text; v_token uuid; v_invite record;
   v_reason text:='ready'; v_kind text:='ready';
  v_qualified boolean:=false; v_path text; v_seq text;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','suppress','reason','enrollment_missing'); END IF;
  v_seq:=e.sequence_key;
  SELECT id INTO v_uid FROM auth.users WHERE lower(btrim(email))=lower(btrim(e.email)) LIMIT 1;
  IF coalesce(e.context->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_project:=(e.context->>'project_id')::uuid;
    SELECT user_id,status::text INTO v_owner,v_status FROM public.projects WHERE id=v_project;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','suppress','reason','project_unavailable','operational',true); END IF;
    IF v_status IN('paused','on_hold') THEN RETURN jsonb_build_object('kind','hold','reason','project_paused'); END IF;
    IF v_status NOT IN('active','draft') THEN RETURN jsonb_build_object('kind','suppress','reason','project_inactive'); END IF;
    v_qualified:=true;
  END IF;
  v_qualified:=v_qualified OR coalesce(e.context->>'entry_source','') IN('referral','direct_outreach');
  IF v_uid IS NULL AND v_seq IN('cs_signup','cs_onboarded','cl_signup','cs_project','cl_project','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected','cs_connected','iv_connected','cl_contractor_pending','cs_client_pending') THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_unavailable');
  END IF;
  IF v_seq IN('cs_signup','cs_onboarded') AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text='contractor') THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_role_changed');
  END IF;
  IF v_seq='cl_signup' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role::text IN('contractor','admin','verifier')) THEN
    RETURN jsonb_build_object('kind','suppress','reason','account_role_changed');
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT client_intent INTO v_intent FROM public.contractor_onboarding WHERE user_id=v_uid;
  END IF;
  IF v_seq IN('cs_signup','ci_onboarding') THEN
    IF v_uid IS NULL THEN v_kind:='suppress'; v_reason:='account_unavailable';
    ELSIF v_intent IS NOT NULL THEN v_kind:='complete'; v_reason:='onboarding_completed'; END IF;
  ELSIF v_seq='cs_onboarded' THEN
    IF EXISTS(SELECT 1 FROM public.projects WHERE user_id=v_uid) THEN v_kind:='complete'; v_reason:='project_created';
    ELSIF v_intent='no_client' THEN v_kind:='suppress'; v_reason:='no_active_project_selected'; END IF;
  ELSIF v_seq='cl_signup' THEN
    IF EXISTS(SELECT 1 FROM public.projects WHERE user_id=v_uid)
      OR EXISTS(SELECT 1 FROM public.project_viewers WHERE user_id=v_uid AND accepted_at IS NOT NULL AND revoked_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.contractor_invites WHERE contractor_user_id=v_uid AND status='accepted') THEN
      v_kind:='complete'; v_reason:='project_available';
    END IF;
  ELSIF v_seq IN('cs_project','cl_project') THEN
    IF v_project IS NULL THEN v_kind:='suppress'; v_reason:='project_missing';
    ELSIF v_seq='cs_project' THEN
      IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted' AND is_primary) THEN
        v_kind:='suppress'; v_reason:='project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL) THEN
        v_kind:='complete'; v_reason:='client_invited';
      END IF;
    ELSE
      IF NOT ((v_owner=v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted') AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL))
        OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)) THEN
        v_kind:='suppress'; v_reason:='project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND (status='accepted' OR (status='pending'))) THEN
        v_kind:='complete'; v_reason:='contractor_invited';
      ELSIF EXISTS(SELECT 1 FROM public.lifecycle_enrollments WHERE sequence_key='cl_support' AND email=e.email AND ref=e.ref AND status NOT IN('exited','suppressed')) THEN
        v_kind:='complete'; v_reason:='contractor_support_requested';
      END IF;
    END IF;
  END IF;

  IF v_seq IN('ci_invited','cl_contractor_pending','iv_invited','cs_client_pending','ci_onboarding','ci_connected_existing','ci_connected_new','iv_connected','cl_connected','cs_connected') THEN
    v_path:=coalesce(e.context->>'invite_path','');
    IF v_path ~* '^/(invite|share)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_token:=split_part(v_path,'/',3)::uuid; END IF;
    IF v_project IS NULL THEN v_kind:='suppress'; v_reason:='project_missing';
    ELSIF v_seq IN('ci_invited','cl_contractor_pending','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected') THEN
      SELECT status='accepted' AS accepted,status='rejected' AS revoked,
        email_status::text AS delivery,
        contractor_user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.contractor_invites
        WHERE project_id=v_project AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY created_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN('failed','bounced','complained') THEN v_kind:='suppress'; v_reason:='invitation_delivery_failed';
      ELSIF v_seq IN('ci_invited','cl_contractor_pending') AND v_invite.accepted THEN v_kind:='complete'; v_reason:='invitation_accepted';
      ELSIF v_seq='cl_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      ELSIF v_seq NOT IN('ci_invited','cl_contractor_pending','cl_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      END IF;
    ELSE
      SELECT accepted_at IS NOT NULL AS accepted,revoked_at IS NOT NULL AS revoked,
        email_status::text AS delivery,
        user_id AS member,invited_by AS inviter,token
        INTO v_invite FROM public.project_viewers
        WHERE project_id=v_project AND is_client AND ((v_token IS NOT NULL AND token=v_token) OR (v_token IS NULL AND lower(email)=lower(coalesce(e.subject_email,e.email))))
        ORDER BY invited_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind:='suppress'; v_reason:='invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN('failed','bounced','complained') THEN v_kind:='suppress'; v_reason:='invitation_delivery_failed';
      ELSIF v_seq IN('iv_invited','cs_client_pending') AND v_invite.accepted THEN v_kind:='complete'; v_reason:='invitation_accepted';
      ELSIF v_seq='cs_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      ELSIF v_seq NOT IN('iv_invited','cs_client_pending','cs_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind:='suppress'; v_reason:='membership_unavailable';
      END IF;
    END IF;
  END IF;
  IF v_kind='ready' AND v_seq IN('cl_contractor_pending','cl_connected') AND NOT (
    (v_owner=v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND status='accepted')
      AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND is_client AND revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)
  ) THEN v_kind:='suppress'; v_reason:='project_role_changed'; END IF;
  IF v_kind='ready' AND v_seq IN('cs_client_pending','cs_connected') AND NOT EXISTS(
    SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_uid AND is_primary AND status='accepted'
  ) THEN v_kind:='suppress'; v_reason:='project_role_changed'; END IF;
  RETURN jsonb_build_object('kind',v_kind,'reason',v_reason,'qualified',v_qualified,
    'operational',v_kind='suppress' AND v_reason IN('invitation_unavailable','invitation_delivery_failed','membership_unavailable'));
END $$;
REVOKE ALL ON FUNCTION public.lifecycle_action_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_action_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lifecycle_enrollment_state(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;e public.lifecycle_enrollments%ROWTYPE;s public.communication_settings%ROWTYPE;p public.communication_preferences%ROWTYPE;v_progress jsonb;
BEGIN
 v_state:=public.lifecycle_action_state(p_enrollment);
 IF v_state->>'kind'<>'ready' THEN RETURN v_state; END IF;
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
 IF e.sequence_key IN('cs_signup','ci_onboarding') THEN
  SELECT public.contractor_onboarding_status(id) INTO v_progress FROM auth.users WHERE lower(btrim(email))=lower(btrim(e.email));
 END IF;
 v_state:=v_state||jsonb_build_object('qualified',coalesce((v_state->>'qualified')::boolean,false)
  OR EXISTS(SELECT 1 FROM public.lifecycle_deliveries WHERE enrollment_id=e.id AND (opened_at IS NOT NULL OR clicked_at IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.communication_threads t JOIN public.communication_messages m ON m.thread_id=t.id WHERE t.enrollment_id=e.id AND m.direction='inbound' AND m.authenticated)
  OR (SELECT count(*)>=3 FROM jsonb_each(coalesce(v_progress->'steps','{}')) WHERE key IN('identity','professional','payout','emergency','agreements') AND value='true'::jsonb));
 SELECT * INTO p FROM public.communication_preferences WHERE email=lower(btrim(e.email));
 IF p.activation_unsubscribed OR p.blocked_reason IS NOT NULL THEN
  RETURN jsonb_build_object('kind','suppress','reason',coalesce(p.blocked_reason,'unsubscribed'));
 END IF;
 IF e.sequence_key='cs_onboarded' AND p.project_creation_paused THEN RETURN jsonb_build_object('kind','suppress','reason','no_active_project_selected'); END IF;
 -- An existing invitation outranks generic signup/project creation even if its
 -- email sequence is disabled, or its browser enrollment event was interrupted.
 IF e.sequence_key IN('cs_signup','cs_onboarded','cl_signup') AND (
  EXISTS(SELECT 1 FROM public.contractor_invites WHERE lower(btrim(email))=lower(btrim(e.email)) AND status IN('pending','accepted'))
  OR EXISTS(SELECT 1 FROM public.project_viewers WHERE lower(btrim(email))=lower(btrim(e.email)) AND is_client AND revoked_at IS NULL)
 ) THEN RETURN jsonb_build_object('kind','suppress','reason','invitation_context'); END IF;
 IF EXISTS(SELECT 1 FROM public.communication_threads WHERE enrollment_id=e.id AND automation_paused) THEN
  RETURN jsonb_build_object('kind','hold','reason','awaiting_staff_response');
 END IF;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT coalesce(s.delivery_enabled,false) THEN RETURN jsonb_build_object('kind','hold','reason','communications_paused'); END IF;
 IF cardinality(s.test_recipients)>0 AND NOT lower(btrim(e.email))=ANY(s.test_recipients) THEN
  RETURN jsonb_build_object('kind','hold','reason','outside_test_group');
 END IF;
 RETURN v_state;
END $$;
CREATE OR REPLACE FUNCTION public.reconcile_lifecycle_enrollment(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state jsonb; e public.lifecycle_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment FOR UPDATE;
  v_state:=public.lifecycle_enrollment_state(p_enrollment);
  IF v_state->>'kind' IN('complete','suppress') THEN
    UPDATE public.lifecycle_enrollments SET status=CASE WHEN v_state->>'kind'='complete' THEN 'exited' ELSE 'suppressed' END,
      exit_reason=v_state->>'reason',next_send_at=NULL,processing_token=NULL,processing_until=NULL WHERE id=e.id;
    UPDATE public.followup_queue SET status='done',resolved_at=now(),note='Auto-closed: '||(v_state->>'reason') WHERE enrollment_id=e.id AND status='open' AND kind='activation';
    IF coalesce((v_state->>'operational')::boolean,false) THEN
      INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,reason,priority,context,due_at)
        VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'Delivery review: '||(v_state->>'reason'),'high',e.context,now())
        ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,reason=EXCLUDED.reason,due_at=EXCLUDED.due_at;
    END IF;
  ELSIF v_state->>'kind'='hold' THEN
    UPDATE public.lifecycle_enrollments SET next_send_at=now()+interval '1 day',processing_token=NULL,processing_until=NULL WHERE id=e.id;
  END IF;
  RETURN v_state;
END $$;
REVOKE ALL ON FUNCTION public.lifecycle_enrollment_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_enrollment_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_communication_reply(p_thread uuid,p_body text,p_client_ref uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.communication_threads%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;s public.communication_settings%ROWTYPE;
 p public.communication_preferences%ROWTYPE;m public.communication_messages%ROWTYPE;v_parent public.communication_messages%ROWTYPE;v_id uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF p_client_ref IS NULL OR length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_message'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('communication_reply:'||p_client_ref::text,0));
 SELECT * INTO m FROM public.communication_messages WHERE client_ref=p_client_ref;
 IF FOUND THEN
  IF m.thread_id<>p_thread OR m.body<>btrim(p_body) OR m.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'message_reference_conflict'; END IF;
  RETURN m.id;
 END IF;
 SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t0 ON t0.enrollment_id=e0.id WHERE t0.id=p_thread FOR UPDATE OF e0;
 SELECT * INTO t FROM public.communication_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'thread_unavailable'; END IF;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT s.delivery_enabled OR s.sender_email IS NULL OR s.reply_domain IS NULL THEN RAISE EXCEPTION 'communications_paused'; END IF;
 IF cardinality(s.test_recipients)>0 AND NOT t.email=ANY(s.test_recipients) THEN RAISE EXCEPTION 'outside_test_group'; END IF;
 SELECT * INTO p FROM public.communication_preferences WHERE email=t.email;
 SELECT * INTO v_parent FROM public.communication_messages WHERE thread_id=t.id AND direction='inbound' AND authenticated ORDER BY created_at DESC LIMIT 1;
 IF p.blocked_reason IS NOT NULL OR (p.activation_unsubscribed AND v_parent.id IS NULL) THEN RAISE EXCEPTION 'recipient_unavailable'; END IF;
 INSERT INTO public.communication_messages(thread_id,direction,subject,body,actor_id,client_ref,status,in_reply_to,payload)
 VALUES(t.id,'outbound',left(regexp_replace(CASE WHEN v_parent.subject IS NULL OR v_parent.subject='' THEN 'Groundwork: '||coalesce(e.context->>'project_name','your account')
  WHEN v_parent.subject~*'^re:' THEN v_parent.subject ELSE 'Re: '||v_parent.subject END,E'[\r\n]',' ','g'),300),btrim(p_body),auth.uid(),p_client_ref,'queued',v_parent.provider_message_id,
  jsonb_build_object('to',t.email,'sender_name',s.sender_name,'sender_email',s.followup_sender_email,'reply_domain',s.reply_domain,'lang',e.lang,'preference_token',p.token)) RETURNING id INTO v_id;
 UPDATE public.communication_threads SET automation_paused=true,reply_domains=CASE WHEN s.reply_domain=ANY(reply_domains) THEN reply_domains ELSE array_append(reply_domains,s.reply_domain) END WHERE id=t.id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.queue_communication_reply(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_communication_reply(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.communication_delivery_attention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE;
BEGIN
 IF NEW.status='blocked' AND OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t ON t.enrollment_id=e0.id WHERE t.id=NEW.thread_id;
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at)
   VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'delivery','Delivery review: '||coalesce(NEW.last_error,'staff_reply_blocked'),'high',e.context,now())
   ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,kind='delivery',reason=EXCLUDED.reason,contact_status='needs_attention',due_at=now(),escalated_at=NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_blocked_delivery ON public.communication_messages;
CREATE TRIGGER communication_blocked_delivery AFTER UPDATE OF status ON public.communication_messages FOR EACH ROW EXECUTE FUNCTION public.communication_delivery_attention();
REVOKE ALL ON FUNCTION public.communication_delivery_attention() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_communication_reply(p_message uuid,p_payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_messages%ROWTYPE;p public.communication_preferences%ROWTYPE;s public.communication_settings%ROWTYPE;t public.communication_threads%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.communication_messages WHERE id=p_message AND direction='outbound' AND client_ref IS NOT NULL
  AND status IN('queued','failed','sending') AND next_attempt_at<=now() AND (processing_until IS NULL OR processing_until<=now()) FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.communication_threads WHERE id=m.thread_id;
 SELECT * INTO p FROM public.communication_preferences WHERE email=t.email;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 IF NOT s.delivery_enabled OR (cardinality(s.test_recipients)>0 AND NOT t.email=ANY(s.test_recipients)) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=m.actor_id AND role='admin') THEN
  UPDATE public.communication_messages SET status='blocked',last_error='staff_role_changed' WHERE id=m.id;RETURN NULL;
 END IF;
 IF p.blocked_reason IS NOT NULL OR (p.activation_unsubscribed AND m.in_reply_to IS NULL) THEN
  UPDATE public.communication_messages SET status='blocked',last_error='recipient_unavailable' WHERE id=m.id;RETURN NULL;
 END IF;
 IF m.started_at<now()-interval '23 hours' THEN
  UPDATE public.communication_messages SET status='blocked',last_error='delivery_needs_review' WHERE id=m.id;RETURN NULL;
 END IF;
 -- The first call provides the frozen queued configuration to the worker. The
 -- second installs its exact wire payload before making any provider request.
 IF p_payload IS NULL THEN RETURN to_jsonb(m); END IF;
 IF m.started_at IS NULL THEN
  IF p_payload->>'to' IS DISTINCT FROM t.email OR p_payload->>'text' IS NULL OR p_payload->>'subject' IS DISTINCT FROM m.subject THEN RAISE EXCEPTION 'invalid_message_payload'; END IF;
  UPDATE public.communication_messages SET payload=p_payload,started_at=now() WHERE id=m.id;
 END IF;
 UPDATE public.communication_messages SET status='sending',worker_token=gen_random_uuid(),processing_until=now()+interval '5 minutes' WHERE id=m.id RETURNING * INTO m;
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.finish_communication_reply(p_message uuid,p_token uuid,p_ok boolean,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.communication_messages%ROWTYPE;s public.communication_settings%ROWTYPE;t public.communication_threads%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.communication_messages WHERE id=p_message AND worker_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO t FROM public.communication_threads WHERE id=m.thread_id;
 SELECT * INTO s FROM public.communication_settings WHERE id;
 UPDATE public.communication_messages SET status=CASE WHEN status IN('sent','delivered','bounced','complained') THEN status WHEN p_ok THEN 'sent' ELSE 'failed' END,provider_id=coalesce(p_provider_id,provider_id),
  last_error=CASE WHEN p_ok OR status IN('sent','delivered','bounced','complained') THEN NULL ELSE p_error END,processing_until=NULL,worker_token=NULL,next_attempt_at=now()+interval '15 minutes' WHERE id=m.id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.communication_staff_send_recorded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enrollment uuid;v_hours int;
BEGIN
 IF NEW.direction='outbound' AND NEW.client_ref IS NOT NULL AND NEW.actor_id IS NOT NULL AND NEW.status IN('sent','delivered') AND OLD.sent_at IS NULL THEN
  NEW.sent_at:=now();
  UPDATE public.communication_threads SET last_message_at=now(),last_outbound_at=now() WHERE id=NEW.thread_id RETURNING enrollment_id INTO v_enrollment;
  SELECT next_contact_hours INTO v_hours FROM public.communication_settings WHERE id;
  UPDATE public.followup_queue SET contact_status='awaiting_reply',last_contacted_at=now(),attempt_count=attempt_count+1,
   due_at=now()+v_hours*interval '1 hour',escalated_at=NULL WHERE enrollment_id=v_enrollment AND status='open';
  INSERT INTO public.communication_followup_events(followup_id,actor_id,kind,note,due_at)
   SELECT id,NEW.actor_id,'email_sent','Staff reply sent',due_at FROM public.followup_queue WHERE enrollment_id=v_enrollment AND status='open';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_staff_send_history ON public.communication_messages;
CREATE TRIGGER communication_staff_send_history BEFORE UPDATE OF status ON public.communication_messages FOR EACH ROW EXECUTE FUNCTION public.communication_staff_send_recorded();
REVOKE ALL ON FUNCTION public.communication_staff_send_recorded() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_communication_inbound(p_provider_id text,p_thread uuid,p_sender text,p_subject text,p_body text,p_message_id text,p_authenticated boolean,p_received_at timestamptz,p_attachments int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.communication_threads%ROWTYPE;e public.lifecycle_enrollments%ROWTYPE;v_id uuid;v_at timestamptz;
BEGIN
 IF EXISTS(SELECT 1 FROM public.communication_messages WHERE provider_id=p_provider_id) THEN RETURN jsonb_build_object('duplicate',true); END IF;
 IF p_provider_id IS NULL OR length(p_provider_id)>200 OR length(coalesce(p_body,''))>30000 OR length(coalesce(p_subject,''))>300 THEN RAISE EXCEPTION 'invalid_inbound'; END IF;
 SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t0 ON t0.enrollment_id=e0.id WHERE t0.id=p_thread FOR UPDATE OF e0;
 SELECT * INTO t FROM public.communication_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.email IS DISTINCT FROM lower(btrim(p_sender)) THEN RETURN jsonb_build_object('ignored',true,'reason','sender_or_thread_mismatch'); END IF;
 v_at:=least(coalesce(p_received_at,now()),now());
 INSERT INTO public.communication_messages(thread_id,direction,provider_id,provider_message_id,subject,body,authenticated,status,attachment_count,created_at)
 VALUES(t.id,'inbound',p_provider_id,left(p_message_id,500),coalesce(p_subject,''),coalesce(p_body,''),coalesce(p_authenticated,false),'received',greatest(0,p_attachments),v_at)
 ON CONFLICT(provider_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN jsonb_build_object('duplicate',true); END IF;
 UPDATE public.communication_threads SET last_message_at=greatest(last_message_at,v_at),last_inbound_at=greatest(last_inbound_at,v_at),
  automation_paused=automation_paused OR coalesce(p_authenticated,false) WHERE id=t.id;
 IF p_authenticated THEN
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at,contact_status)
  VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'reply','User replied and needs assistance','high',e.context,now(),'needs_attention')
  ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,
   kind=CASE WHEN followup_queue.status='open' THEN followup_queue.kind ELSE 'reply' END,
   reason='User replied and needs assistance',priority='high',contact_status='needs_attention',due_at=now(),escalated_at=NULL;
 END IF;
 RETURN jsonb_build_object('received',true,'authenticated',coalesce(p_authenticated,false));
END $$;

CREATE OR REPLACE FUNCTION public.record_communication_email_event(p_provider_id text,p_event text,p_at timestamptz,p_enrollment uuid DEFAULT NULL,p_position int DEFAULT NULL,p_message uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;v_enrollment uuid;v_status text;v_at timestamptz:=least(coalesce(p_at,now()),now());e public.lifecycle_enrollments%ROWTYPE;
BEGIN
 IF p_event NOT IN('sent','delivered','bounced','complained','failed','opened','clicked') THEN RETURN; END IF;
 -- Correlate signed provider tags when a webhook wins the race with the send's
 -- HTTP response. A later worker finish retains the already-received verdict.
 IF p_message IS NOT NULL THEN
  UPDATE public.communication_messages SET provider_id=p_provider_id WHERE id=p_message AND direction='outbound' AND started_at IS NOT NULL AND provider_id IS NULL;
 ELSIF p_enrollment IS NOT NULL AND p_position IS NOT NULL THEN
  UPDATE public.lifecycle_deliveries SET provider_id=p_provider_id WHERE enrollment_id=p_enrollment AND position=p_position AND provider_id IS NULL;
 END IF;
 SELECT t.email,t.enrollment_id INTO v_email,v_enrollment FROM public.communication_messages m JOIN public.communication_threads t ON t.id=m.thread_id WHERE m.provider_id=p_provider_id;
 IF v_email IS NULL THEN SELECT e0.email,e0.id INTO v_email,v_enrollment FROM public.lifecycle_deliveries d JOIN public.lifecycle_enrollments e0 ON e0.id=d.enrollment_id WHERE d.provider_id=p_provider_id; END IF;
 IF v_email IS NULL THEN RETURN; END IF;
 v_status:=CASE WHEN p_event='failed' THEN 'failed' ELSE p_event END;
 IF p_event IN('sent','delivered','bounced','complained','failed') THEN
  UPDATE public.communication_messages SET status=v_status,provider_event_at=v_at
   WHERE provider_id=p_provider_id AND (provider_event_at IS NULL OR provider_event_at<=v_at)
   AND (status NOT IN('bounced','complained') OR p_event IN('bounced','complained')) AND (status<>'delivered' OR p_event<>'sent');
  UPDATE public.lifecycle_deliveries SET delivery_status=v_status,delivery_updated_at=v_at
   WHERE provider_id=p_provider_id AND (delivery_updated_at IS NULL OR delivery_updated_at<=v_at)
   AND (coalesce(delivery_status,'') NOT IN('bounced','complained') OR p_event IN('bounced','complained')) AND (coalesce(delivery_status,'')<>'delivered' OR p_event<>'sent');
 ELSE
  UPDATE public.lifecycle_deliveries SET opened_at=CASE WHEN p_event='opened' THEN coalesce(opened_at,v_at) ELSE opened_at END,
   clicked_at=CASE WHEN p_event='clicked' THEN coalesce(clicked_at,v_at) ELSE clicked_at END WHERE provider_id=p_provider_id;
 END IF;
 IF p_event IN('bounced','complained','failed') THEN
  INSERT INTO public.communication_preferences(email,blocked_reason) VALUES(lower(btrim(v_email)),CASE WHEN p_event='failed' THEN 'delivery_failed' ELSE p_event END)
  ON CONFLICT(email) DO UPDATE SET blocked_reason=CASE WHEN communication_preferences.blocked_reason='complained' THEN 'complained' ELSE EXCLUDED.blocked_reason END,updated_at=now();
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=v_enrollment;
  INSERT INTO public.followup_queue(enrollment_id,sequence_key,email,full_name,phone,kind,reason,priority,context,due_at)
   VALUES(e.id,e.sequence_key,e.email,e.full_name,e.phone,'delivery','Delivery review: '||p_event,'high',e.context,now())
   ON CONFLICT(enrollment_id) DO UPDATE SET status='open',resolved_at=NULL,kind='delivery',reason=EXCLUDED.reason,contact_status='needs_attention',due_at=now();
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.review_communication_followups()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.followup_queue%ROWTYPE;v_state jsonb;v_closed int:=0;v_overdue int:=0;
BEGIN
 FOR f IN SELECT * FROM public.followup_queue WHERE status='open' ORDER BY last_reviewed_at NULLS FIRST,created_at FOR UPDATE SKIP LOCKED LIMIT 200 LOOP
  UPDATE public.followup_queue SET last_reviewed_at=now() WHERE id=f.id;
  IF f.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=f.owner_id AND role='admin') THEN
   UPDATE public.followup_queue SET owner_id=(SELECT s.default_owner_id FROM public.communication_settings s WHERE s.id AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=s.default_owner_id AND role='admin'))
    WHERE id=f.id;
  END IF;
  v_state:=public.lifecycle_enrollment_state(f.enrollment_id);
  IF f.kind='activation' AND v_state->>'kind' IN('complete','suppress') THEN
   UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Action reconciled: '||(v_state->>'reason')) WHERE id=f.id;
   v_closed:=v_closed+1;
  ELSIF f.due_at<=now() AND f.escalated_at IS NULL THEN
   UPDATE public.followup_queue SET contact_status='needs_attention',escalated_at=now() WHERE id=f.id;
   INSERT INTO public.communication_followup_events(followup_id,kind,note,due_at) VALUES(f.id,'overdue','Next contact is due',f.due_at) ON CONFLICT DO NOTHING;
   v_overdue:=v_overdue+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('resolved',v_closed,'overdue',v_overdue);
END $$;

CREATE OR REPLACE FUNCTION public.mirror_lifecycle_communication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread uuid;v_status text;
BEGIN
 IF NEW.status<>'sent' OR NEW.provider_id IS NULL THEN RETURN NULL; END IF;
 SELECT id INTO v_thread FROM public.communication_threads WHERE enrollment_id=NEW.enrollment_id;
 IF v_thread IS NULL THEN RETURN NULL; END IF;
 v_status:=CASE WHEN NEW.delivery_status IN('delivered','bounced','complained','failed') THEN NEW.delivery_status ELSE 'sent' END;
 INSERT INTO public.communication_messages(thread_id,direction,provider_id,subject,body,status,provider_event_at,created_at)
 VALUES(v_thread,'outbound',NEW.provider_id,left(coalesce(NEW.payload->>'subject',''),300),left(coalesce(NEW.payload->>'text',''),30000),v_status,NEW.delivery_updated_at,NEW.started_at)
 ON CONFLICT(provider_id) DO UPDATE SET status=CASE WHEN communication_messages.status IN('bounced','complained') THEN communication_messages.status ELSE EXCLUDED.status END,
  provider_event_at=greatest(communication_messages.provider_event_at,EXCLUDED.provider_event_at);
 UPDATE public.communication_threads SET last_message_at=greatest(last_message_at,NEW.started_at),last_outbound_at=greatest(last_outbound_at,NEW.started_at) WHERE id=v_thread;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS lifecycle_communication_history ON public.lifecycle_deliveries;
CREATE TRIGGER lifecycle_communication_history AFTER UPDATE OF status,provider_id,delivery_status ON public.lifecycle_deliveries FOR EACH ROW EXECUTE FUNCTION public.mirror_lifecycle_communication();
REVOKE ALL ON FUNCTION public.mirror_lifecycle_communication() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_communication_followup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient record;
BEGIN
 IF NEW.status<>'open' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id AND NEW.escalated_at IS NOT DISTINCT FROM OLD.escalated_at
  AND NOT (NEW.contact_status='needs_attention' AND NEW.contact_status IS DISTINCT FROM OLD.contact_status) THEN RETURN NULL; END IF;
 FOR recipient IN SELECT DISTINCT r.user_id,p.preferred_lang FROM public.user_roles r LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.role='admin' AND (NEW.owner_id IS NULL OR r.user_id=NEW.owner_id) LOOP
  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(recipient.user_id,'communication_followup',
   CASE WHEN recipient.preferred_lang='fr' THEN 'Suivi Groundwork à effectuer' ELSE 'Groundwork follow-up needs attention' END,
   CASE WHEN recipient.preferred_lang='fr' THEN 'Une tâche de suivi vous attend dans Communications.' ELSE 'A follow-up task is waiting in Communications.' END,
   jsonb_build_object('communication_followup_id',NEW.id));
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS communication_followup_notification ON public.followup_queue;
CREATE TRIGGER communication_followup_notification AFTER INSERT OR UPDATE OF owner_id,contact_status,escalated_at ON public.followup_queue FOR EACH ROW EXECUTE FUNCTION public.notify_communication_followup();
REVOKE ALL ON FUNCTION public.notify_communication_followup() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.prepare_communication_reply(uuid,jsonb),public.finish_communication_reply(uuid,uuid,boolean,text,text),public.record_communication_inbound(text,uuid,text,text,text,text,boolean,timestamptz,int),public.record_communication_email_event(text,text,timestamptz,uuid,int,uuid),public.review_communication_followups() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_communication_reply(uuid,jsonb),public.finish_communication_reply(uuid,uuid,boolean,text,text),public.record_communication_inbound(text,uuid,text,text,text,text,boolean,timestamptz,int),public.record_communication_email_event(text,text,timestamptz,uuid,int,uuid),public.review_communication_followups() TO service_role;
NOTIFY pgrst,'reload schema';

-- Source: 20261113001000_activation_invitation_priority.sql
-- Invitation context is authoritative even if a browser event is interrupted.
CREATE OR REPLACE FUNCTION public.communication_invitation_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb:=to_jsonb(NEW);v_project uuid:=(j->>'project_id')::uuid;v_inviter uuid:=(j->>'invited_by')::uuid;
 v_token uuid:=(j->>'token')::uuid;v_email text:=lower(btrim(j->>'email'));v_accepted boolean;v_seq text;
 v_inviter_email text;v_name text;v_project_name text;v_lang text;v_position int;v_hours int;
BEGIN
 IF TG_TABLE_NAME='project_viewers' THEN
  IF NOT coalesce((j->>'is_client')::boolean,false) OR j->>'revoked_at' IS NOT NULL THEN RETURN NULL; END IF;
  v_accepted:=j->>'accepted_at' IS NOT NULL;v_seq:='cs_client_pending';
 ELSE
  IF j->>'status' NOT IN('pending','accepted') THEN RETURN NULL; END IF;
  v_accepted:=j->>'status'='accepted';v_seq:='cl_contractor_pending';
 END IF;
 IF v_email IS NOT NULL THEN
  WITH closed AS (
   UPDATE public.lifecycle_enrollments SET status='suppressed',exit_reason='invitation_context',next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE lower(btrim(email))=v_email AND sequence_key IN('cs_signup','cs_onboarded','cl_signup') AND status IN('active','completed') RETURNING id
  ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation takes priority')
    WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
 END IF;
 IF v_accepted THEN
  WITH closed AS (
   UPDATE public.lifecycle_enrollments SET status='exited',exit_reason='invitation_accepted',next_send_at=NULL,processing_token=NULL,processing_until=NULL
   WHERE context->>'project_id'=v_project::text AND context->>'invite_path' IN('/invite/'||v_token,'/share/'||v_token)
    AND sequence_key IN('ci_invited','iv_invited','cs_client_pending','cl_contractor_pending') AND status IN('active','completed') RETURNING id
  ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation accepted')
    WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
  RETURN NULL;
 END IF;
 IF NOT coalesce((j->>'is_share_link')::boolean,false) THEN RETURN NULL; END IF;
 -- A share link has no known recipient yet. Only remind its actual inviter;
 -- creating a link must never claim that an invitation email was delivered.
 IF v_seq='cs_client_pending' AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=v_inviter AND status='accepted' AND is_primary) THEN RETURN NULL; END IF;
 IF v_seq='cl_contractor_pending' AND NOT (
  EXISTS(SELECT 1 FROM public.projects WHERE id=v_project AND user_id=v_inviter)
  OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=v_project AND user_id=v_inviter AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)
 ) THEN RETURN NULL; END IF;
 SELECT lower(btrim(u.email)),p.full_name,CASE WHEN p.preferred_lang='fr' THEN 'fr' ELSE 'en' END INTO v_inviter_email,v_name,v_lang
 FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=v_inviter;
 SELECT name INTO v_project_name FROM public.projects WHERE id=v_project;
 WITH closed AS (
  UPDATE public.lifecycle_enrollments SET status='exited',exit_reason='invitation_created',next_send_at=NULL,processing_token=NULL,processing_until=NULL
  WHERE lower(btrim(email))=v_inviter_email AND context->>'project_id'=v_project::text AND sequence_key IN('cs_project','cl_project') AND status IN('active','completed') RETURNING id
 ) UPDATE public.followup_queue SET status='done',resolved_at=now(),note=concat_ws(E'\n',nullif(note,''),'Invitation link created')
   WHERE enrollment_id IN(SELECT id FROM closed) AND status='open' AND kind='activation';
 IF v_inviter_email IS NULL OR NOT EXISTS(SELECT 1 FROM public.lifecycle_sequences WHERE key=v_seq AND enabled) THEN RETURN NULL; END IF;
 SELECT min(position) INTO v_position FROM public.lifecycle_sequence_steps WHERE sequence_key=v_seq AND position>1;
 IF v_position IS NULL THEN RETURN NULL; END IF;
 SELECT sum(delay_hours) INTO v_hours FROM public.lifecycle_sequence_steps WHERE sequence_key=v_seq AND position<=v_position;
 INSERT INTO public.lifecycle_enrollments(sequence_key,email,full_name,lang,user_role,ref,context,next_position,next_send_at)
 VALUES(v_seq,v_inviter_email,v_name,v_lang,CASE WHEN v_seq='cs_client_pending' THEN 'contractor' ELSE 'client' END,
  v_project||':link:'||v_token,jsonb_build_object('project_id',v_project,'project_name',v_project_name,'invite_path',CASE WHEN v_seq='cs_client_pending' THEN '/share/' ELSE '/invite/' END||v_token,
   'recipient_role',CASE WHEN v_seq='cs_client_pending' THEN 'contractor' ELSE 'client' END,'anonymous_invitation',true),v_position,now()+v_hours*interval '1 hour')
 ON CONFLICT(sequence_key,email,ref) DO NOTHING;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS communication_viewer_priority ON public.project_viewers;
CREATE TRIGGER communication_viewer_priority AFTER INSERT OR UPDATE ON public.project_viewers FOR EACH ROW EXECUTE FUNCTION public.communication_invitation_changed();
DROP TRIGGER IF EXISTS communication_contractor_priority ON public.contractor_invites;
CREATE TRIGGER communication_contractor_priority AFTER INSERT OR UPDATE ON public.contractor_invites FOR EACH ROW EXECUTE FUNCTION public.communication_invitation_changed();
REVOKE ALL ON FUNCTION public.communication_invitation_changed() FROM PUBLIC,anon,authenticated;

UPDATE public.lifecycle_sequence_steps SET cta_key='manage_invitation'
 WHERE code IN('CS14','CS15','CL11','CL12') AND cta_key='open_project';
NOTIFY pgrst,'reload schema';

NOTIFY pgrst,'reload schema';
COMMIT;
