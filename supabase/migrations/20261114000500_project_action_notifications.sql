BEGIN;

-- New events have a stable identity. Existing notification history stays intact.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_event
 ON public.notifications(user_id,event_key) WHERE event_key IS NOT NULL;

-- Private audience lookup: account roles do not replace accepted project roles.
CREATE OR REPLACE FUNCTION public.project_notification_members(p_project uuid)
RETURNS TABLE(user_id uuid,role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH people AS (
  SELECT c.contractor_user_id AS uid,'contractor'::text AS label,1 AS priority FROM public.contractor_invites c
   WHERE c.project_id=p_project AND c.status='accepted' AND c.contractor_user_id IS NOT NULL
  UNION ALL SELECT v.user_id,CASE WHEN v.is_client THEN 'client' ELSE 'observer' END,2 FROM public.project_viewers v
   WHERE v.project_id=p_project AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL AND v.user_id IS NOT NULL
  UNION ALL SELECT p.user_id,'client',3 FROM public.projects p WHERE p.id=p_project
  UNION ALL SELECT v.user_id,'verifier',4 FROM public.project_verifiers v WHERE v.project_id=p_project AND v.status='active'
 ) SELECT DISTINCT ON(uid) uid,label FROM people WHERE uid IS NOT NULL ORDER BY uid,priority;
$$;
REVOKE ALL ON FUNCTION public.project_notification_members(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.emit_project_event(p_project uuid,p_actor uuid,p_event text,p_key text,p_data jsonb DEFAULT '{}',p_include_actor boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person record;project_name text;stage_no integer;stage_id uuid;tab text;title text;body text;payload jsonb:=coalesce(p_data,'{}');BEGIN
 SELECT name INTO project_name FROM public.projects WHERE id=p_project;
 IF NOT FOUND THEN RETURN; END IF;
 title:=CASE p_event
  WHEN 'project_created' THEN 'Project created'
  WHEN 'project_updated' THEN 'Project updated'
  WHEN 'evidence_uploaded' THEN 'Work update ready for review'
  WHEN 'substage_approved' THEN 'Work update approved'
  WHEN 'stage_review_requested' THEN 'Stage ready for review'
  WHEN 'stage_rework_requested' THEN 'Stage changes requested'
  WHEN 'stage_work_approved' THEN 'Stage work approved'
  WHEN 'stage_approved' THEN 'Stage completed'
  WHEN 'stage_opened' THEN 'Stage ready to begin'
  WHEN 'stage_awaiting_payment' THEN 'Stage payment available'
  WHEN 'stage_payment_settled' THEN 'Stage payment settled'
  WHEN 'receipt_submitted' THEN 'Payment receipt ready for confirmation'
  WHEN 'receipt_replaced' THEN 'Payment receipt replaced'
  WHEN 'receipt_received' THEN 'Payment received'
  WHEN 'receipt_accepted' THEN 'Payment received and work authorized'
  WHEN 'receipt_top_up_requested' THEN 'Additional stage payment requested'
  WHEN 'receipt_flagged' THEN 'Payment receipt needs attention'
  WHEN 'prices_proposed' THEN 'Project prices ready for approval'
  WHEN 'prices_approved' THEN 'Project price changes approved'
  WHEN 'prices_declined' THEN 'Project prices retained'
  WHEN 'prices_withdrawn' THEN 'Price proposal withdrawn'
  WHEN 'payment_plan_proposed' THEN 'Stage payment plan ready for review'
  WHEN 'payment_plan_accepted' THEN 'Stage payment plan accepted'
  WHEN 'payment_plan_declined' THEN 'Stage payment plan needs revision'
  WHEN 'payment_plan_superseded' THEN 'Stage payment plan replaced'
  WHEN 'progression_authorized' THEN 'Project progression authorized; balance remains recorded'
  WHEN 'member_invited' THEN 'Project invitation sent'
  WHEN 'member_joined' THEN 'Project member joined'
  WHEN 'member_removed' THEN 'Project membership updated'
  WHEN 'member_role_changed' THEN 'Project role updated'
  WHEN 'document_added' THEN 'Project document added'
  WHEN 'document_updated' THEN 'Project document updated'
  WHEN 'document_removed' THEN 'Project document removed'
  WHEN 'verification_requested' THEN 'Stage verification requested'
  WHEN 'verification_decided' THEN 'Stage verification reviewed'
  WHEN 'verifier_assigned' THEN 'Project verifier assigned'
  WHEN 'verifier_removed' THEN 'Project verifier assignment updated'
  WHEN 'project_budget_updated' THEN 'Project budget updated'
  WHEN 'project_tracking_started' THEN 'Project tracking started'
  ELSE NULL END;
 IF title IS NULL THEN RETURN; END IF;
 IF payload->>'stage_id' IS NOT NULL THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.id=(payload->>'stage_id')::uuid;
 ELSIF payload->>'stage_number' ~ '^\d{1,3}$' THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.stage_number=(payload->>'stage_number')::integer;
 END IF;
 body:=CASE WHEN stage_no IS NULL THEN 'Open “'||coalesce(project_name,'Project')||'” to view this update.'
  ELSE 'Open Stage '||stage_no||' in “'||coalesce(project_name,'Project')||'” to view this update.' END;
 FOR person IN SELECT * FROM public.project_notification_members(p_project) LOOP
  CONTINUE WHEN NOT p_include_actor AND person.user_id IS NOT DISTINCT FROM p_actor;
  tab:=CASE WHEN p_event LIKE 'prices_%' OR p_event='project_budget_updated' THEN CASE WHEN person.role='contractor' THEN 'money' ELSE 'costing' END
   WHEN p_event LIKE 'document_%' THEN 'documents'
   WHEN p_event LIKE 'member_%' OR p_event LIKE 'verifier_%' THEN CASE WHEN person.role='contractor' THEN 'people' ELSE 'team' END
   WHEN stage_no IS NOT NULL THEN CASE WHEN person.role='contractor' THEN 'work' ELSE 'stages' END
   ELSE CASE WHEN person.role='contractor' THEN 'work' ELSE 'overview' END END;
  INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params,event_key)
  VALUES(person.user_id,'project.'||p_event,title,body,
   jsonb_strip_nulls(payload||jsonb_build_object('project_id',p_project,'role',person.role,'project_tab',tab,'stage_id',stage_id,'stage_number',stage_no,'project_event',p_event)),
   'notifications.events.'||p_event,CASE WHEN stage_no IS NULL THEN 'notifications.projectEventBody' ELSE 'notifications.stageEventBody' END,
   jsonb_build_object('project',coalesce(project_name,'Project'),'stage',stage_no),'project:'||p_key)
  ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.emit_project_event(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

-- Replace the existing financial trigger body; keep its four existing trigger attachments.
CREATE OR REPLACE FUNCTION public.notify_project_financial_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n jsonb:=to_jsonb(NEW);o jsonb;event text;payload jsonb;BEGIN
 o:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 payload:=jsonb_strip_nulls(jsonb_build_object('stage_id',n->>'stage_id'));
 IF TG_TABLE_NAME='stage_price_amendments' THEN
  IF TG_OP='INSERT' THEN event:='prices_proposed';
  ELSIF n->>'status' IS DISTINCT FROM o->>'status' THEN event:='prices_'||(n->>'status'); ELSE RETURN NEW; END IF;
  payload:=payload||jsonb_build_object('proposal_id',n->>'id');
 ELSIF TG_TABLE_NAME='stage_payment_plans' THEN
  IF TG_OP='INSERT' THEN event:='payment_plan_proposed';
  ELSIF n->>'status' IS DISTINCT FROM o->>'status' THEN event:='payment_plan_'||(n->>'status'); ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='stage_progression_authorizations' THEN
  IF n->>'source'<>'explicit' OR TG_OP='UPDATE' THEN RETURN NEW; END IF;
  event:='progression_authorized';
 ELSE
  IF TG_OP='INSERT' THEN event:='receipt_submitted';
  ELSIF n->>'replaced_by' IS DISTINCT FROM o->>'replaced_by' AND n->>'replaced_by' IS NOT NULL THEN
   -- The replacement itself emits receipt_submitted and points at the new receipt.
   RETURN NEW;
  ELSIF ROW(n->>'decision',n->>'allows_work',n->>'requested_top_up') IS DISTINCT FROM ROW(o->>'decision',o->>'allows_work',o->>'requested_top_up') THEN
   event:=CASE WHEN n->>'decision'='flagged' THEN 'receipt_flagged' WHEN n->>'requested_top_up' IS NOT NULL THEN 'receipt_top_up_requested'
    WHEN (n->>'allows_work')::boolean THEN 'receipt_accepted' ELSE 'receipt_received' END;
  ELSE RETURN NEW; END IF;
  payload:=payload||jsonb_build_object('receipt_id',n->>'id');
 END IF;
 PERFORM public.emit_project_event((n->>'project_id')::uuid,auth.uid(),event,
  TG_TABLE_NAME||':'||(n->>'id')||':'||event||':'||md5(jsonb_build_array(n->>'status',n->>'decision',n->>'allows_work',n->>'requested_top_up')::text),payload);
 RETURN NEW;
END $$;

-- Audited workflow transitions are authoritative and already retry-safe at the RPC.
CREATE OR REPLACE FUNCTION public.notify_project_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text;payload jsonb:='{}';stage_id uuid;BEGIN
 IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
 event:=CASE NEW.action
  WHEN 'site_update.submitted' THEN 'evidence_uploaded'
  WHEN 'stage_submitted_for_review' THEN 'stage_review_requested'
  WHEN 'rework_requested' THEN 'stage_rework_requested'
  WHEN 'stage.work_approved' THEN 'stage_work_approved'
  WHEN 'stage.approved' THEN 'stage_approved'
  WHEN 'stage.opened' THEN 'stage_opened'
  WHEN 'stage.awaiting_payment' THEN 'stage_awaiting_payment'
  WHEN 'stage.payment_settled' THEN 'stage_payment_settled'
  WHEN 'verification.requested' THEN 'verification_requested'
  WHEN 'verification.decided' THEN 'verification_decided'
  WHEN 'project.joined_in_progress' THEN 'project_tracking_started'
  WHEN 'project.repriced' THEN 'project_budget_updated'
  WHEN 'project.repriced_from_bill' THEN 'project_budget_updated'
  ELSE NULL END;
 IF event IS NULL THEN RETURN NEW; END IF;
 stage_id:=coalesce(NEW.stage_id,(NEW.details->>'stage_id')::uuid);
 payload:=jsonb_strip_nulls(jsonb_build_object('stage_id',stage_id,'stage_number',NEW.details->>'stage_number','substage_id',NEW.details->>'substage_id'));
 IF NEW.entity_type='stage_verification' THEN
  SELECT v.stage_id INTO stage_id FROM public.stage_verifications v WHERE v.id=NEW.entity_id;
  payload:=payload||jsonb_build_object('stage_id',stage_id,'verification_id',NEW.entity_id);
 END IF;
 PERFORM public.emit_project_event(NEW.project_id,NEW.actor_id,event,'activity:'||NEW.id,payload);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_activity_notification ON public.project_audit_log;
CREATE TRIGGER project_activity_notification AFTER INSERT ON public.project_audit_log FOR EACH ROW EXECUTE FUNCTION public.notify_project_activity();

CREATE OR REPLACE FUNCTION public.notify_project_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n jsonb;o jsonb:='{}';pid uuid;event text;payload jsonb:='{}';member_id uuid;role text;BEGIN
 n:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' THEN o:=to_jsonb(OLD); END IF;
 pid:=(n->>'project_id')::uuid;
 IF TG_TABLE_NAME IN('contractor_invites','project_viewers') THEN
  role:=CASE WHEN TG_TABLE_NAME='contractor_invites' THEN 'contractor' WHEN (n->>'is_client')::boolean THEN 'client' ELSE 'observer' END;
  member_id:=CASE WHEN role='contractor' THEN (n->>'contractor_user_id')::uuid ELSE (n->>'user_id')::uuid END;
  IF TG_OP='INSERT' THEN event:='member_invited';
  ELSIF TG_OP='DELETE' OR n->>'revoked_at' IS DISTINCT FROM o->>'revoked_at' OR n->>'status'='rejected' THEN event:='member_removed';
  ELSIF n->>'accepted_at' IS DISTINCT FROM o->>'accepted_at' AND n->>'accepted_at' IS NOT NULL THEN event:='member_joined';
  ELSIF ROW(n->>'is_primary',n->>'is_client') IS DISTINCT FROM ROW(o->>'is_primary',o->>'is_client') THEN event:='member_role_changed';
  ELSE RETURN NEW; END IF;
  -- Existing accounts get an acceptance link before they have project read access.
  IF TG_OP='INSERT' AND coalesce((n->>'is_share_link')::boolean,false)=false THEN
   SELECT u.id INTO member_id FROM auth.users u WHERE lower(u.email)=lower(n->>'email');
   IF member_id IS NOT NULL AND member_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params,event_key)
    VALUES(member_id,'project.invited','Project invitation','Open your invitation to join this project.',
     jsonb_build_object('project_id',pid,'invitation_token',n->>'token','invitation_kind',CASE WHEN role='contractor' THEN 'contractor' ELSE 'viewer' END),
     'notifications.events.project_invited','notifications.invitationBody','{}','invite:'||TG_TABLE_NAME||':'||(n->>'id'))
    ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='project_documents' THEN
  event:=CASE TG_OP WHEN 'INSERT' THEN 'document_added' WHEN 'DELETE' THEN 'document_removed' ELSE 'document_updated' END;
  IF TG_OP='UPDATE' AND ROW(n->>'file_name',n->>'category',n->>'file_path') IS NOT DISTINCT FROM ROW(o->>'file_name',o->>'category',o->>'file_path') THEN RETURN NEW; END IF;
  -- Removed files open the remaining document catalogue.
  IF TG_OP<>'DELETE' THEN payload:=jsonb_build_object('document_id',n->>'id'); END IF;
 ELSIF TG_TABLE_NAME='project_substages' THEN
  IF n->>'status'<>'complete' OR n->>'status' IS NOT DISTINCT FROM o->>'status' OR coalesce((n->>'pre_existing')::boolean,false) THEN RETURN NEW; END IF;
  SELECT s.project_id INTO pid FROM public.project_stages s WHERE s.id=(n->>'stage_id')::uuid;
  event:='substage_approved';payload:=jsonb_build_object('stage_id',n->>'stage_id','substage_id',n->>'id');
 ELSIF TG_TABLE_NAME='projects' THEN
  pid:=(n->>'id')::uuid;
  IF TG_OP='INSERT' THEN event:='project_created';
  ELSIF ROW(n->>'status',n->>'name') IS DISTINCT FROM ROW(o->>'status',o->>'name') THEN event:='project_updated'; ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='project_verifiers' THEN
  event:=CASE WHEN TG_OP='DELETE' OR n->>'status'<>'active' THEN 'verifier_removed' ELSE 'verifier_assigned' END;
  IF TG_OP='UPDATE' AND n->>'status' IS NOT DISTINCT FROM o->>'status' THEN RETURN NEW; END IF;
 END IF;
 PERFORM public.emit_project_event(pid,auth.uid(),event,TG_TABLE_NAME||':'||(n->>'id')||':'||TG_OP||':'||txid_current()||':'||md5(n::text),payload);
 IF event='member_joined' AND member_id IS NOT NULL THEN
  -- The joining user also needs a direct project link, even when they accepted it themselves.
  INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params,event_key)
  SELECT member_id,'project.joined','Your project is ready','Open your project workspace.',
   jsonb_build_object('project_id',pid,'role',role,'project_tab',CASE WHEN role='contractor' THEN 'work' ELSE 'overview' END),
   'notifications.events.project_joined','notifications.projectEventBody',jsonb_build_object('project',p.name),'joined:'||TG_TABLE_NAME||':'||(n->>'id')
  FROM public.projects p WHERE p.id=pid AND member_id IS NOT DISTINCT FROM auth.uid()
  ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS project_membership_notification ON public.contractor_invites;
CREATE TRIGGER project_membership_notification AFTER INSERT OR UPDATE OR DELETE ON public.contractor_invites FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();
DROP TRIGGER IF EXISTS project_membership_notification ON public.project_viewers;
CREATE TRIGGER project_membership_notification AFTER INSERT OR UPDATE OR DELETE ON public.project_viewers FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();
DROP TRIGGER IF EXISTS project_document_notification ON public.project_documents;
CREATE TRIGGER project_document_notification AFTER INSERT OR UPDATE OR DELETE ON public.project_documents FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();
DROP TRIGGER IF EXISTS project_substage_notification ON public.project_substages;
CREATE TRIGGER project_substage_notification AFTER UPDATE ON public.project_substages FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();
DROP TRIGGER IF EXISTS project_record_notification ON public.projects;
CREATE TRIGGER project_record_notification AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();
DROP TRIGGER IF EXISTS project_verifier_team_notification ON public.project_verifiers;
CREATE TRIGGER project_verifier_team_notification AFTER INSERT OR UPDATE OR DELETE ON public.project_verifiers FOR EACH ROW EXECUTE FUNCTION public.notify_project_record();

-- Browser callers cannot impersonate senders or notify unrelated account-level contacts.
CREATE OR REPLACE FUNCTION public.notify_project_members(p_project_id uuid,p_sender_id uuid,p_type text,p_title text,p_body text,p_data jsonb DEFAULT '{}',p_title_key text DEFAULT NULL,p_body_key text DEFAULT NULL,p_params jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_sender_id OR NOT public.project_member(p_project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params)
 SELECT m.user_id,p_type,p_title,p_body,coalesce(p_data,'{}')||jsonb_build_object('project_id',p_project_id,'role',m.role),p_title_key,p_body_key,p_params
 FROM public.project_notification_members(p_project_id) m WHERE m.user_id IS DISTINCT FROM auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.notify_project_members(uuid,uuid,text,text,text,jsonb,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.notify_project_members(uuid,uuid,text,text,text,jsonb,text,text,jsonb) TO authenticated;

-- Realtime delivery is backed by the same RLS as the initial fetch.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
 END IF;
END $$;
COMMIT;
