-- Operational measurement for Groundwork-owned lifecycle communication.
-- Records facts independently of sequence enablement. Does not enable or send mail.
BEGIN;
CREATE TABLE IF NOT EXISTS public.communication_milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event text NOT NULL,email text NOT NULL,
 user_id uuid REFERENCES auth.users ON DELETE SET NULL,project_id uuid REFERENCES public.projects ON DELETE SET NULL,
 user_role text,entry_source text,subject_ref text NOT NULL DEFAULT '',
 occurred_at timestamptz NOT NULL DEFAULT now(),source text NOT NULL DEFAULT 'live',
 email_sent boolean NOT NULL DEFAULT false,UNIQUE(event,email,subject_ref)
);
CREATE INDEX IF NOT EXISTS communication_milestones_lookup ON public.communication_milestones(email,event,occurred_at);
CREATE INDEX IF NOT EXISTS communication_milestones_project ON public.communication_milestones(project_id,event);
CREATE TABLE IF NOT EXISTS public.communication_action_outcomes (
 enrollment_id uuid PRIMARY KEY REFERENCES public.lifecycle_enrollments ON DELETE CASCADE,
 completed_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.communication_project_connections (
 project_id uuid PRIMARY KEY REFERENCES public.projects ON DELETE CASCADE,
 connected_at timestamptz,source text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.communication_duplicate_projects (
 project_id uuid PRIMARY KEY REFERENCES public.projects ON DELETE CASCADE,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 marked_by uuid REFERENCES auth.users ON DELETE SET NULL,marked_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['communication_milestones','communication_action_outcomes','communication_project_connections','communication_duplicate_projects'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS communication_tracking_read ON public.%I',t);
  EXECUTE format('CREATE POLICY communication_tracking_read ON public.%I FOR SELECT TO authenticated USING(public.is_admin())',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.communication_project_connected(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.projects p JOIN public.contractor_invites c ON c.project_id=p.id AND c.status='accepted' AND c.is_primary
  JOIN public.contractor_onboarding o ON o.user_id=c.contractor_user_id AND o.client_intent IS NOT NULL
  WHERE p.id=p_project AND p.status::text NOT IN('archived') AND (
   (p.workflow_origin='client' AND p.user_id<>c.contractor_user_id)
   OR EXISTS(SELECT 1 FROM public.project_viewers v WHERE v.project_id=p.id AND v.is_client AND v.accepted_at IS NOT NULL
     AND v.revoked_at IS NULL AND v.user_id IS NOT NULL AND v.user_id<>c.contractor_user_id)
  )
 )
$$;
CREATE OR REPLACE FUNCTION public.capture_communication_outcome(p_enrollment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lifecycle_enrollments%ROWTYPE;s jsonb;
BEGIN
 SELECT * INTO e FROM public.lifecycle_enrollments WHERE id=p_enrollment;
 IF NOT FOUND OR e.status='suppressed' THEN RETURN; END IF;
 s:=public.lifecycle_action_state(e.id);
 -- Exhausting the email sequence or recording a call is not action completion.
 IF s->>'kind'='complete' THEN
  INSERT INTO public.communication_action_outcomes(enrollment_id,reason)
   VALUES(e.id,coalesce(s->>'reason','action_completed')) ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.communication_tracking_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF TG_TABLE_NAME='lifecycle_enrollments' THEN
  PERFORM public.capture_communication_outcome(NEW.id);
 ELSE
  v_id:=(to_jsonb(NEW)->>'enrollment_id')::uuid;
  IF v_id IS NOT NULL THEN PERFORM public.capture_communication_outcome(v_id); END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_outcome_enrollment ON public.lifecycle_enrollments;
CREATE TRIGGER communication_outcome_enrollment AFTER UPDATE OF status,exit_reason ON public.lifecycle_enrollments
 FOR EACH ROW EXECUTE FUNCTION public.communication_tracking_transition();
DROP TRIGGER IF EXISTS communication_outcome_followup ON public.followup_queue;
CREATE TRIGGER communication_outcome_followup AFTER UPDATE OF status ON public.followup_queue
 FOR EACH ROW WHEN(NEW.status='done') EXECUTE FUNCTION public.communication_tracking_transition();

CREATE OR REPLACE FUNCTION public.record_communication_milestone(p_event text,p_email text,p_fields jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text:=lower(btrim(p_email));v_uid uuid;v_project uuid;v_role text:=p_fields->>'user_role';
 v_source text:=p_fields->>'entry_source';v_ref text:='';v_id uuid;r record;v_origin text;v_at timestamptz:=now();v_created timestamptz;
BEGIN
 IF p_event NOT IN('user_signup','contractor_onboarding_completed','project_created','client_invited','contractor_invited',
   'invitation_accepted','project_membership_active','contractor_support_requested','no_active_project_selected') THEN RETURN; END IF;
 IF coalesce(v_email,'')!~'^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' THEN RETURN; END IF;
 SELECT id,created_at INTO v_uid,v_created FROM auth.users WHERE lower(btrim(email))=v_email LIMIT 1;
 IF coalesce(p_fields->>'project_id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  SELECT id,workflow_origin,created_at INTO v_project,v_origin,v_created FROM public.projects WHERE id=(p_fields->>'project_id')::uuid;
 END IF;
 IF p_event='project_created' AND v_origin IN('client','contractor') THEN v_role:=v_origin; END IF;
 IF p_event='user_signup' THEN
  IF EXISTS(SELECT 1 FROM public.contractor_invites WHERE lower(btrim(email))=v_email AND status IN('pending','accepted') AND contractor_user_id IS DISTINCT FROM invited_by) THEN
   v_source:='client_invitation';v_role:='contractor';
  ELSIF EXISTS(SELECT 1 FROM public.project_viewers WHERE lower(btrim(email))=v_email AND is_client AND revoked_at IS NULL) THEN
   v_source:='contractor_invitation';v_role:='client';
  END IF;
 END IF;
 IF v_role NOT IN('client','contractor') THEN v_role:=NULL; END IF;
 IF p_event IN('user_signup','project_created') THEN v_at:=coalesce(v_created,now()); END IF;
 IF v_project IS NOT NULL THEN v_ref:=v_project::text; END IF;
 IF p_event IN('client_invited','contractor_invited') AND coalesce(p_fields->>'invite_path','')<>'' THEN
  v_ref:=v_ref||':'||md5(p_fields->>'invite_path');
 END IF;
 INSERT INTO public.communication_milestones(event,email,user_id,project_id,user_role,entry_source,subject_ref,email_sent,occurred_at)
  VALUES(p_event,v_email,v_uid,v_project,v_role,v_source,v_ref,coalesce((p_fields->>'invitation_email_sent')::boolean,false),v_at) ON CONFLICT DO NOTHING;
 -- Completed message sequences still need an outcome when the person returns later.
 FOR r IN SELECT id FROM public.lifecycle_enrollments WHERE status IN('active','completed','exited')
  AND (email=v_email OR subject_email=v_email OR (v_project IS NOT NULL AND context->>'project_id'=v_project::text)) LOOP
  PERFORM public.capture_communication_outcome(r.id);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.capture_communication_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid;r record;
BEGIN
 IF TG_TABLE_NAME='contractor_onboarding' THEN
  FOR r IN SELECT project_id FROM public.contractor_invites WHERE contractor_user_id=NEW.user_id AND status='accepted' AND is_primary LOOP
   IF public.communication_project_connected(r.project_id) THEN
    INSERT INTO public.communication_project_connections VALUES(r.project_id,clock_timestamp(),'live') ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 ELSE
  v_project:=coalesce((to_jsonb(NEW)->>'project_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
  IF public.communication_project_connected(v_project) THEN
   INSERT INTO public.communication_project_connections VALUES(v_project,clock_timestamp(),'live') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projects','contractor_invites','project_viewers','contractor_onboarding'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS communication_connection_record ON public.%I',t);
  EXECUTE format('CREATE TRIGGER communication_connection_record AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_communication_connection()',t);
 END LOOP;
END $$;
-- Historical connected state is useful, but its original timestamp is not invented.
INSERT INTO public.communication_project_connections(project_id,connected_at,source)
 SELECT id,NULL,'historical_time_unknown' FROM public.projects WHERE public.communication_project_connected(id) ON CONFLICT DO NOTHING;
-- Preserve actual older lifecycle observations when the optional legacy outbox exists.
DO $$ BEGIN
 IF to_regclass('public.ghl_outbox') IS NOT NULL THEN
  INSERT INTO public.communication_milestones(event,email,user_id,project_id,user_role,entry_source,subject_ref,occurred_at,source,email_sent)
   SELECT DISTINCT ON(g.event,lower(btrim(g.email)),coalesce(g.payload->>'project_id',''))
    g.event,lower(btrim(g.email)),u.id,p.id,CASE WHEN g.event='project_created' THEN p.workflow_origin ELSE g.payload->>'user_role' END,
    g.payload->>'entry_source',coalesce(p.id::text,''),g.created_at,'legacy_observation',coalesce(g.payload->>'invitation_email_sent','false')='true'
   FROM public.ghl_outbox g LEFT JOIN auth.users u ON lower(btrim(u.email))=lower(btrim(g.email))
   LEFT JOIN public.projects p ON p.id::text=g.payload->>'project_id'
   WHERE g.event IN('user_signup','contractor_onboarding_completed','project_created','client_invited','contractor_invited',
    'invitation_accepted','project_membership_active','contractor_support_requested','no_active_project_selected')
   ORDER BY g.event,lower(btrim(g.email)),coalesce(g.payload->>'project_id',''),g.created_at ON CONFLICT DO NOTHING;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_duplicate_project(p_project uuid,p_duplicate boolean,p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project) THEN RAISE EXCEPTION 'project_unavailable'; END IF;
 IF p_duplicate THEN
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'duplicate_reason_required'; END IF;
  INSERT INTO public.communication_duplicate_projects(project_id,reason,marked_by) VALUES(p_project,btrim(p_reason),auth.uid())
   ON CONFLICT(project_id) DO UPDATE SET reason=EXCLUDED.reason,marked_by=EXCLUDED.marked_by,marked_at=now();
 ELSE DELETE FROM public.communication_duplicate_projects WHERE project_id=p_project; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.communication_ratio(p_numerator bigint,p_denominator bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('completed',p_numerator,'total',p_denominator,
  'percent',round(p_numerator::numeric*100/nullif(p_denominator,0),1))
$$;

CREATE OR REPLACE FUNCTION public.admin_communication_tracking(
 p_from timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_search text DEFAULT '',
 p_journey text DEFAULT '',p_state text DEFAULT '',p_offset int DEFAULT 0,p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from timestamptz:=coalesce(p_from,now()-interval '30 days');v_until timestamptz:=coalesce(p_until,now());
 v_metrics jsonb;v_recovery jsonb;v_rows jsonb;v_projects jsonb;v_total bigint;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
 IF v_from>=v_until OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 100 OR length(p_search)>200 THEN RAISE EXCEPTION 'invalid_tracking_filter'; END IF;
 IF p_journey NOT IN('','Contractor self-signup','Contractor invited by a client','Client self-signup','Client invited by a contractor')
  OR p_state NOT IN('','active','awaiting_action','action_complete','sequence_complete','exited','suppressed') THEN RAISE EXCEPTION 'invalid_tracking_filter'; END IF;
 WITH signup AS (
  SELECT DISTINCT ON(coalesce(user_id::text,email)) * FROM public.communication_milestones
   WHERE event='user_signup' AND entry_source='independent_signup' ORDER BY coalesce(user_id::text,email),occurred_at
 ), onboarding AS (
  SELECT DISTINCT ON(coalesce(user_id::text,email)) * FROM public.communication_milestones
   WHERE event='contractor_onboarding_completed' ORDER BY coalesce(user_id::text,email),occurred_at
 ), first_project AS (
  SELECT DISTINCT ON(user_id) * FROM public.projects ORDER BY user_id,created_at,id
 ), invitations AS (
  SELECT id,project_id,email,created_at,accepted_at,status='accepted' AS accepted,
   coalesce(is_share_link,false) AS share_link,(email_delivered_at IS NOT NULL OR email_status='delivered') AS delivered
   FROM public.contractor_invites WHERE contractor_user_id IS DISTINCT FROM invited_by
  UNION ALL
  SELECT id,project_id,email,invited_at,accepted_at,accepted_at IS NOT NULL,
   coalesce(is_share_link,false),(email_delivered_at IS NOT NULL OR email_status='delivered')
   FROM public.project_viewers WHERE is_client
 ), signup_cohort AS (SELECT * FROM signup WHERE occurred_at>=v_from AND occurred_at<v_until AND user_role='contractor'),
 onboarding_cohort AS (
  SELECT o.* FROM onboarding o JOIN signup s ON coalesce(o.user_id::text,o.email)=coalesce(s.user_id::text,s.email)
   WHERE s.user_role='contractor' AND o.occurred_at>=v_from AND o.occurred_at<v_until
 ), project_cohort AS (SELECT * FROM first_project WHERE created_at>=v_from AND created_at<v_until),
 invitation_cohort AS (SELECT * FROM invitations WHERE created_at>=v_from AND created_at<v_until),
 assisted AS (
  SELECT f.enrollment_id,min(ev.created_at) AS contacted_at FROM public.followup_queue f
   JOIN public.communication_followup_events ev ON ev.followup_id=f.id
   WHERE f.kind='activation' AND ev.kind IN('contacted','awaiting_reply','email_sent')
    AND ev.created_at>=v_from AND ev.created_at<v_until GROUP BY f.enrollment_id
 ), entries AS (
  SELECT DISTINCT ON(email) email,user_id,occurred_at FROM public.communication_milestones
   WHERE event IN('user_signup','contractor_invited','client_invited') ORDER BY email,occurred_at
 ), connection_times AS (
  SELECT e.email,min(c.connected_at)-e.occurred_at AS elapsed FROM entries e
   JOIN public.communication_milestones m ON m.email=e.email AND m.project_id IS NOT NULL
   JOIN public.communication_project_connections c ON c.project_id=m.project_id
   WHERE e.occurred_at>=v_from AND e.occurred_at<v_until AND c.connected_at>=e.occurred_at GROUP BY e.email,e.occurred_at
 ) SELECT jsonb_build_object(
  'signupToOnboarding',public.communication_ratio((SELECT count(*) FROM signup_cohort s WHERE EXISTS(SELECT 1 FROM onboarding o WHERE coalesce(o.user_id::text,o.email)=coalesce(s.user_id::text,s.email) AND o.occurred_at>=s.occurred_at)),(SELECT count(*) FROM signup_cohort)),
  'onboardingToProject',public.communication_ratio((SELECT count(*) FROM onboarding_cohort o WHERE EXISTS(SELECT 1 FROM public.projects p WHERE p.user_id=o.user_id AND p.workflow_origin='contractor' AND p.created_at>=o.occurred_at)),(SELECT count(*) FROM onboarding_cohort)),
  'projectToInvitation',public.communication_ratio((SELECT count(*) FROM project_cohort p WHERE EXISTS(SELECT 1 FROM invitations i WHERE i.project_id=p.id AND ((NOT i.share_link AND (i.delivered OR i.accepted)) OR (i.share_link AND i.accepted)))),(SELECT count(*) FROM project_cohort)),
  'invitationAcceptance',public.communication_ratio((SELECT count(*) FROM invitation_cohort WHERE NOT share_link AND delivered AND accepted),(SELECT count(*) FROM invitation_cohort WHERE NOT share_link AND delivered)),
  'linkClaims',public.communication_ratio((SELECT count(*) FROM invitation_cohort WHERE share_link AND accepted),(SELECT count(*) FROM invitation_cohort WHERE share_link)),
  'humanRecovery',public.communication_ratio((SELECT count(*) FROM assisted a JOIN public.communication_action_outcomes o ON o.enrollment_id=a.enrollment_id AND o.completed_at>=a.contacted_at),(SELECT count(*) FROM assisted)),
  'duplicateProjects',public.communication_ratio((SELECT count(*) FROM public.projects p JOIN public.communication_duplicate_projects d ON d.project_id=p.id WHERE p.created_at>=v_from AND p.created_at<v_until),(SELECT count(*) FROM public.projects WHERE created_at>=v_from AND created_at<v_until)),
  'medianConnectionHours',(SELECT round((percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM elapsed)/3600))::numeric,1) FROM connection_times),
  'knownConnectionTimes',(SELECT count(*) FROM connection_times),
  'historicalUnknownConnectionTimes',(SELECT count(*) FROM public.communication_project_connections WHERE connected_at IS NULL),
  'invitationsWithoutDeliveryProof',(SELECT count(*) FROM invitation_cohort WHERE NOT share_link AND NOT coalesce(delivered,false)),
  'knownSignupEvents',(SELECT count(*) FROM signup WHERE occurred_at>=v_from AND occurred_at<v_until),
  'unclassifiedSignupEvents',(SELECT count(*) FROM public.communication_milestones WHERE event='user_signup' AND (user_role IS NULL OR entry_source IS NULL) AND occurred_at>=v_from AND occurred_at<v_until)
 ) INTO v_metrics;

 -- Recovery is a temporal association with the last verified email before completion,
 -- not a claim that opening/clicking alone completed the user's required action.
 WITH verified AS (
  SELECT DISTINCT ON(d.enrollment_id,d.position) d.enrollment_id,d.position,s.sequence_key,s.step_code,s.subject,s.sent_at
   FROM public.lifecycle_deliveries d JOIN public.lifecycle_sends s ON s.enrollment_id=d.enrollment_id AND s.position=d.position AND s.status='sent'
   WHERE (d.delivery_status='delivered' OR d.opened_at IS NOT NULL OR d.clicked_at IS NOT NULL)
    AND coalesce(d.delivery_status,'') NOT IN('bounced','complained','failed') ORDER BY d.enrollment_id,d.position,s.sent_at
 ), credited AS (
  SELECT DISTINCT ON(o.enrollment_id) o.enrollment_id,v.position FROM public.communication_action_outcomes o JOIN verified v
   ON v.enrollment_id=o.enrollment_id AND v.sent_at<=o.completed_at ORDER BY o.enrollment_id,v.sent_at DESC,v.position DESC
 ), grouped AS (
  SELECT v.sequence_key,v.step_code,max(v.subject) AS subject,count(*) AS total,
   count(c.enrollment_id) AS completed FROM verified v LEFT JOIN credited c ON c.enrollment_id=v.enrollment_id AND c.position=v.position
   WHERE v.sent_at>=v_from AND v.sent_at<v_until GROUP BY v.sequence_key,v.step_code
 ) SELECT coalesce(jsonb_agg(to_jsonb(g)||public.communication_ratio(g.completed,g.total) ORDER BY g.sequence_key,g.step_code),'[]') INTO v_recovery FROM grouped g;

 WITH filtered AS (
  SELECT e.*,s.journey,s.awaiting_action,CASE WHEN o.enrollment_id IS NOT NULL THEN 'action_complete'
    WHEN e.status='completed' AND s.awaiting_action='' THEN 'sequence_complete'
    WHEN e.status='completed' THEN 'awaiting_action' ELSE e.status END AS recorded_state,o.completed_at,
   (SELECT id FROM auth.users WHERE lower(btrim(email))=lower(btrim(e.email)) LIMIT 1) AS account_id
   FROM public.lifecycle_enrollments e JOIN public.lifecycle_sequences s ON s.key=e.sequence_key
   LEFT JOIN public.communication_action_outcomes o ON o.enrollment_id=e.id
   WHERE e.enrolled_at>=v_from AND e.enrolled_at<v_until AND (p_journey='' OR s.journey=p_journey)
    AND (p_search='' OR concat_ws(' ',e.email,e.full_name,e.context->>'project_name') ILIKE '%'||p_search||'%')
 ), matched AS (SELECT * FROM filtered WHERE p_state='' OR recorded_state=p_state),page AS (
  SELECT * FROM matched ORDER BY enrolled_at DESC,id LIMIT p_limit OFFSET p_offset
 ) SELECT (SELECT count(*) FROM matched),coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'email',e.email,'phone',e.phone,'name',e.full_name,'role',e.user_role,'journey',e.journey,'sequenceKey',e.sequence_key,
  'action',e.awaiting_action,'state',e.recorded_state,'enteredAt',e.enrolled_at,'completedAt',e.completed_at,
  'projectId',e.context->>'project_id','projectName',e.context->>'project_name','entrySource',e.context->>'entry_source',
  'lastEmail',last_email.value,'nextEmailAt',CASE WHEN e.recorded_state='active' THEN e.next_send_at ELSE NULL END,
  'nextEmailCode',CASE WHEN e.recorded_state='active' THEN next_email.code ELSE NULL END,
  'followup',followup.value,'accountId',e.account_id,
  'threadId',(SELECT id FROM public.communication_threads WHERE enrollment_id=e.id LIMIT 1)
 ) ORDER BY e.enrolled_at DESC,e.id),'[]') INTO v_total,v_rows FROM page e
 LEFT JOIN LATERAL (
  SELECT jsonb_build_object('code',s.step_code,'subject',s.subject,'sentAt',s.sent_at,'status',coalesce(d.delivery_status,'accepted')) AS value
   FROM public.lifecycle_sends s LEFT JOIN public.lifecycle_deliveries d ON d.enrollment_id=s.enrollment_id AND d.position=s.position
   WHERE s.enrollment_id=e.id AND s.status='sent' ORDER BY s.sent_at DESC LIMIT 1
 ) last_email ON true
 LEFT JOIN LATERAL (SELECT code FROM public.lifecycle_sequence_steps WHERE sequence_key=e.sequence_key AND position>=e.next_position ORDER BY position LIMIT 1) next_email ON true
 LEFT JOIN LATERAL (
  SELECT jsonb_build_object('id',f.id,'kind',f.kind,'ownerId',f.owner_id,'ownerName',pr.full_name,'dueAt',f.due_at,
   'contactStatus',f.contact_status,'attempts',f.attempt_count,'lastContactedAt',f.last_contacted_at) AS value
   FROM public.followup_queue f LEFT JOIN public.profiles pr ON pr.id=f.owner_id WHERE f.enrollment_id=e.id AND f.status='open'
   ORDER BY CASE WHEN f.kind='activation' THEN 0 ELSE 1 END,f.created_at DESC LIMIT 1
 ) followup ON true;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]') INTO v_projects FROM (
  SELECT p.id,p.name,p.workflow_origin AS origin,p.created_at,(d.project_id IS NOT NULL) AS duplicate,d.reason,
   public.communication_project_connected(p.id) AS connected
   FROM public.projects p LEFT JOIN public.communication_duplicate_projects d ON d.project_id=p.id
   WHERE p.created_at>=v_from AND p.created_at<v_until ORDER BY p.created_at DESC,p.id LIMIT 50
 ) p;
 RETURN jsonb_build_object('from',v_from,'until',v_until,'asOf',now(),'metrics',v_metrics,'recovery',v_recovery,
  'total',v_total,'rows',v_rows,'projects',v_projects,'offset',p_offset,'limit',p_limit);
END $$;

REVOKE ALL ON FUNCTION public.record_communication_milestone(text,text,jsonb),public.capture_communication_outcome(uuid),public.communication_project_connected(uuid),
 public.communication_tracking_transition(),public.capture_communication_connection() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_communication_milestone(text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_mark_duplicate_project(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_duplicate_project(uuid,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_communication_tracking(timestamptz,timestamptz,text,text,text,int,int),public.communication_ratio(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_communication_tracking(timestamptz,timestamptz,text,text,text,int,int) TO authenticated;
COMMIT;
