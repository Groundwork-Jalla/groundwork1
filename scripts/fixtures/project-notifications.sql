RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_price_start(190),test_price_start(191),test_price_start(192,'boq','contractor');
INSERT INTO public.project_viewers(project_id,user_id,is_client,accepted_at) VALUES
 (test_id(190),'00000000-0000-0000-0000-000000000006',false,now()),
 (test_id(190),'00000000-0000-0000-0000-000000000007',true,now());
INSERT INTO public.project_viewers(project_id,user_id,is_client,accepted_at,revoked_at) VALUES
 (test_id(190),'00000000-0000-0000-0000-000000000008',false,now(),now());
INSERT INTO public.contractor_invites(project_id,contractor_user_id,status,is_primary) VALUES
 (test_id(190),'00000000-0000-0000-0000-000000000003','accepted',false),
 (test_id(190),'00000000-0000-0000-0000-000000000009','pending',false);
INSERT INTO public.project_verifiers(project_id,user_id,status) VALUES(test_id(190),'00000000-0000-0000-0000-000000000005','active');
DELETE FROM public.notifications;
SELECT public.emit_project_event(test_id(190),'00000000-0000-0000-0000-000000000002','evidence_uploaded','one-evidence',jsonb_build_object('stage_id',test_id(190,3),'substage_id',test_sub(190,3,1)));
SELECT test_assert((SELECT count(*) FROM notifications WHERE event_key='project:one-evidence')=5,'evidence reaches owner, invited primary client, additional contractor, observer and verifier exactly once');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE user_id IN('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002')),'revoked, pending and author accounts are excluded');
SELECT test_assert((SELECT data->>'project_tab'='work' AND data->>'role'='contractor' FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000003'),'additional contractor gets contractor workspace');
SELECT test_assert((SELECT data->>'project_tab'='stages' AND data->>'role'='observer' AND data->>'substage_id'=test_sub(190,3,1)::text AND data->>'stage_number'='3' FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000006'),'observer gets stage and exact update without approval permissions');
SELECT public.emit_project_event(test_id(190),'00000000-0000-0000-0000-000000000002','evidence_uploaded','one-evidence',jsonb_build_object('stage_id',test_id(190,3)));
SELECT test_assert((SELECT count(*) FROM notifications)=5,'retry does not duplicate the same event');

-- Return approval/payment responsibility to the owner for the RPC fixtures below.
UPDATE public.project_viewers SET is_client=false WHERE project_id=test_id(190) AND user_id='00000000-0000-0000-0000-000000000007';

-- Real receipt RPCs, including retries, use the same complete project audience.
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(190,3,1,50);
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.receipt_submitted' AND data->>'project_id'=test_id(190)::text)=5,'receipt submission reaches all other accepted participants');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(190,3,1,'record');
SELECT test_decide(190,3,1,'record');
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.receipt_received' AND data->>'project_id'=test_id(190)::text)=5,'receipt decision retry emits one notice per other participant');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE type='project.receipt_received' AND NOT data ? 'receipt_id'),'receipt notices locate the exact receipt');
SET ROLE authenticated;
SELECT test_decide(190,3,1,'accept');
RESET ROLE;

SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(190,2,'10000');
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.prices_proposed')=5,'price proposals reach the client, observers and other accepted participants');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE type='project.prices_proposed' AND (data->>'proposal_id' IS NULL OR data->>'project_tab' NOT IN('costing','money'))),'pricing notices locate the proposal in pricing');

-- Existing accounts get an acceptance target; claiming emits a direct project target.
INSERT INTO public.project_viewers(project_id,email,is_client,token) VALUES(test_id(191),'6@test.example',false,test_id(191,90));
SELECT test_assert((SELECT data->>'invitation_kind'='viewer' AND data->>'invitation_token'=test_id(191,90)::text FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000006' AND type='project.invited'),'unaccepted users are sent to their invitation rather than an unreadable project');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000006',false);
UPDATE public.project_viewers SET user_id=auth.uid(),accepted_at=now() WHERE token=test_id(191,90);
SELECT test_assert((SELECT count(*) FROM notifications WHERE user_id=auth.uid() AND type='project.joined' AND data->>'project_id'=test_id(191)::text)=1,'the joining observer has a direct project notification');
UPDATE public.project_viewers SET accepted_at=accepted_at WHERE token=test_id(191,90);
SELECT test_assert((SELECT count(*) FROM notifications WHERE user_id=auth.uid() AND type='project.joined' AND data->>'project_id'=test_id(191)::text)=1,'an unchanged membership does not repeat joining notices');

-- Documents, approvals and audit transitions are written inside the real transaction.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
INSERT INTO public.project_documents(id,project_id,file_name,file_path,category) VALUES(test_id(190,91),test_id(190),'Contract.pdf','contract.pdf','contract');
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.document_added' AND data->>'document_id'=test_id(190,91)::text)=5,'documents notify the accepted audience and carry the exact document');
SELECT public.approve_substage(test_sub(190,3,1));
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.substage_approved')=5,'substage approval reaches all other participants');
SELECT public.log_activity(test_id(190),'stage.work_approved','project_stage',test_id(190,3),auth.uid(),'{}');
SELECT test_assert((SELECT count(*) FROM notifications WHERE type='project.stage_work_approved')=5,'audited workflow actions fan out');
SELECT public.log_activity(test_id(190),'message.internal_note','conversation',test_id(190,92),auth.uid(),'{}');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE type LIKE '%internal_note%'),'private staff notes do not enter the project notification feed');

SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000006',false);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE user_id<>auth.uid()),'notification RLS remains per recipient');
SELECT test_refused($q$SELECT notify_project_members(test_id(190),'00000000-0000-0000-0000-000000000002','fake','x','x')$q$,'forbidden');
SELECT test_refused($q$SELECT emit_project_event(test_id(190),auth.uid(),'evidence_uploaded','forged','{}')$q$,'permission denied');
SELECT notify_project_members(test_id(190),auth.uid(),'legacy','Project update','Update',jsonb_build_object('project_id',test_id(191)));
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE type='legacy' AND data->>'project_id'<>test_id(190)::text),'the public RPC cannot forge the project destination');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000009',false);
SELECT test_refused($q$SELECT notify_project_members(test_id(190),auth.uid(),'fake','x','x')$q$,'forbidden');
RESET ROLE;
SELECT 'PROJECT_NOTIFICATIONS_OK';
