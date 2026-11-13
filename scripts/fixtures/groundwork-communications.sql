RESET ROLE;
SELECT test_assert(NOT (SELECT delivery_enabled FROM communication_settings WHERE id),'communication upgrade does not enable sends');
INSERT INTO auth.users(id,email) SELECT test_id(n),n||'@test.example' FROM generate_series(11,13) n;
INSERT INTO profiles(id,full_name,preferred_lang) SELECT test_id(n),'Communication test '||n,'en' FROM generate_series(11,13) n;
INSERT INTO user_roles VALUES(test_id(11),'contractor'),(test_id(12),'contractor');
SELECT test_enrollment(1100,'cs_onboarded',11);
SELECT test_enrollment(1101,'test_delivery',11);
SELECT test_enrollment(1102,'test_delivery',11);
SELECT test_assert(lifecycle_enrollment_state(test_id(1101))->>'reason'='communications_paused','global pause is authoritative');
SELECT set_config('test.actor',test_id(11)::text,false);
SET ROLE authenticated;
SELECT test_refused($q$SELECT admin_save_communication_settings('{}',now())$q$,'not_admin');
SELECT test_refused($q$SELECT queue_communication_reply(test_id(1),'hello',test_id(2))$q$,'not_admin');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_preferences),'ordinary users cannot read recipients or preference capabilities');
SELECT set_contractor_client_intent('create_project');
RESET ROLE;
SELECT test_assert((SELECT client_intent FROM contractor_onboarding WHERE user_id=test_id(11))='create_project','create-project choice is distinct from opting out');
SELECT test_assert(lifecycle_action_state(test_id(1100))->>'kind'='ready','create-project choice permits project reminders');
INSERT INTO projects(id,user_id,name) VALUES(test_id(1140),test_id(11),'Already created');
UPDATE contractor_onboarding SET client_intent='no_client' WHERE user_id=test_id(11);
SELECT test_assert(lifecycle_action_state(test_id(1100))->>'reason'='project_created','actual project completion wins over the legacy falsely saved opt-out');
DELETE FROM projects WHERE id=test_id(1140);
UPDATE contractor_onboarding SET client_intent='create_project' WHERE user_id=test_id(11);
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE authenticated;
SELECT test_refused($q$SELECT admin_save_communication_settings('{"sender_name":"Groundwork","sender_email":"sender@test.example","reply_domain":"replies.test.example","delivery_enabled":true}',now())$q$,'stale_settings');
SELECT admin_save_communication_settings('{"sender_name":"Groundwork","sender_email":"sender@test.example","reply_domain":"replies.test.example","delivery_enabled":true,"default_owner_id":"00000000-0000-0000-0000-000000000004","test_recipients":["1@test.example","11@test.example","12@test.example","13@test.example"]}',(SELECT updated_at FROM communication_settings WHERE id));
RESET ROLE;
SELECT test_assert(lifecycle_enrollment_state(test_id(1100))->>'kind'='ready','configured cohort permits eligible reminder');
SELECT test_assert((SELECT sender_email='sender@test.example' AND followup_sender_email='contact@tryjalla.com' AND application_sender_email='partner@tryjalla.com' FROM communication_settings WHERE id),'welcome, follow-up and application senders remain distinct');
SELECT test_enrollment(1103,'test_delivery',5);
SELECT test_assert(lifecycle_enrollment_state(test_id(1103))->>'reason'='outside_test_group','cohort prevents accidental wider sends');

-- An invitation takes priority even when generic signup happened first.
INSERT INTO contractor_onboarding(user_id,client_intent,client_intent_at) VALUES(test_id(12),'create_project',now());
INSERT INTO contractor_invites(id,token,project_id,invited_by,email,is_share_link,expires_at)
 VALUES(test_id(1220),test_id(1221),test_id(100),test_id(1),'12@test.example',true,now()-interval '1 year');
INSERT INTO project_viewers(id,token,project_id,invited_by,email,is_client)
 VALUES(test_id(1230),test_id(1231),test_id(101),test_id(2),'13@test.example',true);
SELECT test_enrollment(1110,'cs_onboarded',12);
SELECT test_enrollment(1111,'cl_signup',13);
SELECT test_assert(lifecycle_enrollment_state(test_id(1110))->>'reason'='invitation_context','invited contractor does not keep receiving create-project reminders');
SELECT test_assert(lifecycle_enrollment_state(test_id(1111))->>'reason'='invitation_context','invited client does not receive a generic welcome');
SELECT test_enrollment(1125,'test_delivery',13);
SELECT test_assert(NOT (lifecycle_enrollment_state(test_id(1125))->>'qualified')::boolean,'inactive signup without engagement is not prioritized for human contact');
INSERT INTO lifecycle_deliveries(enrollment_id,position,payload,clicked_at) VALUES(test_id(1125),1,'{}',now());
SELECT test_assert((lifecycle_enrollment_state(test_id(1125))->>'qualified')::boolean,'recorded reminder engagement qualifies for human follow-up');
SELECT test_enrollment(1112,'ci_invited',12,jsonb_build_object('project_id',test_id(100),'invite_path','/invite/'||test_id(1221)));
SELECT test_assert(lifecycle_enrollment_state(test_id(1112))->>'kind'='ready','project invitation reminders retain non-expiring links');
UPDATE projects SET status='on_hold' WHERE id=test_id(100);
SELECT test_assert(lifecycle_enrollment_state(test_id(1112))->>'kind'='hold','actual on-hold project status defers reminders');
UPDATE projects SET status='active' WHERE id=test_id(100);

-- Capability preferences expose no recipient identity and a GET-style preview has no effects.
SELECT ensure_lifecycle_communication(test_id(1101));
UPDATE communication_preferences SET token=test_id(1500) WHERE email='11@test.example';
SET ROLE anon;
SELECT test_assert(NOT communication_preference_preview(test_id(1500))?'email','preference preview does not reveal email');
SELECT test_assert(NOT (communication_preference_preview(test_id(1500))->>'activation_unsubscribed')::boolean,'preview alone changes no consent');
SELECT set_communication_preference(test_id(1500),'pause_project');
SELECT test_refused($q$SELECT ensure_lifecycle_communication(test_id(1102))$q$,'permission denied');
RESET ROLE;
SELECT test_assert((SELECT status='suppressed' FROM lifecycle_enrollments WHERE id=test_id(1100)),'project opt-out cancels only project-creation journey');
SELECT test_assert(lifecycle_enrollment_state(test_id(1101))->>'kind'='ready','project-only opt-out leaves another journey eligible');
SET ROLE anon;
SELECT set_communication_preference(test_id(1500),'unsubscribe');
SELECT set_communication_preference(test_id(1500),'resume');
RESET ROLE;
SELECT test_assert((SELECT status='suppressed' FROM lifecycle_enrollments WHERE id=test_id(1101)),'resuming does not replay past journeys');
SELECT test_enrollment(1104,'test_delivery',11,'{"project_id":"00000000-0000-0000-0000-000000000100"}',0);
SELECT ensure_lifecycle_communication(test_id(1104));

-- Preserve delivery events that arrive before the send HTTP response is recorded.
DO $$ DECLARE c jsonb;d jsonb;t uuid;BEGIN
 c:=claim_lifecycle_enrollment(test_id(1104));
 PERFORM test_assert(c IS NOT NULL,'new eligible journey can be claimed');
 d:=prepare_lifecycle_delivery(test_id(1104),(c->>'processing_token')::uuid,1,'{"to":"11@test.example","subject":"Test reminder","text":"Continue your project"}');
 PERFORM record_communication_email_event('provider-1104','delivered',now(),test_id(1104),1,NULL);
 PERFORM finish_lifecycle_delivery(test_id(1104),(c->>'processing_token')::uuid,1,'sent',NULL,'provider-1104');
 PERFORM test_assert((SELECT status='delivered' FROM communication_messages WHERE provider_id='provider-1104'),'conversation history retains early delivery verdict');
 SELECT id INTO t FROM communication_threads WHERE enrollment_id=test_id(1104);
 PERFORM record_communication_inbound('inbound-1104',t,'wrong@test.example','Wrong account','hello','<wrong@test.example>',true,now(),0);
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM communication_messages WHERE provider_id='inbound-1104'),'another sender cannot claim a conversation');
 PERFORM record_communication_inbound('unverified-1104',t,'11@test.example','Unverified','hello','<unverified@test.example>',false,now(),0);
 PERFORM test_assert(NOT (SELECT automation_paused FROM communication_threads WHERE id=t),'unverified mail cannot pause a journey');
 PERFORM record_communication_inbound('inbound-1104',t,'11@test.example','Need help','Please help me continue','<inbound@test.example>',true,now(),0);
 PERFORM record_communication_inbound('inbound-1104',t,'11@test.example','Need help','Please help me continue','<inbound@test.example>',true,now(),0);
 PERFORM test_assert((SELECT count(*)=1 FROM communication_messages WHERE provider_id='inbound-1104'),'provider retries do not duplicate incoming mail');
 PERFORM test_assert(lifecycle_enrollment_state(test_id(1104))->>'reason'='awaiting_staff_response','a verified reply pauses automated nudges');
 PERFORM test_assert((SELECT kind='reply' AND owner_id=test_id(4) AND status='open' FROM followup_queue WHERE enrollment_id=test_id(1104)),'reply creates an assigned staff task');
END $$;

-- Contact attempts are history, not activation completion.
GRANT UPDATE ON followup_queue TO authenticated;
INSERT INTO followup_queue(enrollment_id,sequence_key,email,kind,reason,priority,context,due_at)
 VALUES(test_id(1112),'ci_invited','12@test.example','activation','Accept invitation','high','{}',now()-interval '1 hour');
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE authenticated;
UPDATE followup_queue SET status='done' WHERE enrollment_id=test_id(1112);
SELECT test_assert((SELECT status='open' FROM followup_queue WHERE enrollment_id=test_id(1112)),'direct browser writes cannot close a task');
SELECT test_refused($q$SELECT admin_followup_action((SELECT id FROM followup_queue WHERE enrollment_id=test_id(1112)),'resolve')$q$,'required_action_incomplete');
SELECT test_refused($q$SELECT admin_followup_action((SELECT id FROM followup_queue WHERE enrollment_id=test_id(1112)),'contacted','Called',now()-interval '1 hour')$q$,'future_followup_required');
SELECT admin_followup_action((SELECT id FROM followup_queue WHERE enrollment_id=test_id(1112)),'contacted','Called; will try tomorrow',now()+interval '1 day');
SELECT test_assert((SELECT status='open' AND attempt_count=1 FROM followup_queue WHERE enrollment_id=test_id(1112)),'contact leaves incomplete activation open');
RESET ROLE;
UPDATE contractor_invites SET status='accepted',contractor_user_id=test_id(12) WHERE id=test_id(1220);
SELECT review_communication_followups();
SELECT test_assert((SELECT status='done' FROM followup_queue WHERE enrollment_id=test_id(1112)),'actual action closes activation task');

-- Non-expiring share links schedule only the known inviter, without inventing email delivery.
INSERT INTO projects(id,user_id,name) VALUES(test_id(1501),test_id(2),'Shared-link project');
INSERT INTO contractor_invites(id,project_id,invited_by,email,status,contractor_user_id,is_primary)
 VALUES(test_id(1502),test_id(1501),test_id(2),'2@test.example','accepted',test_id(2),true);
UPDATE lifecycle_sequences SET enabled=true WHERE key='cs_client_pending';
SELECT test_enrollment(1510,'cs_project',2,jsonb_build_object('project_id',test_id(1501)));
INSERT INTO project_viewers(id,token,project_id,invited_by,is_client,is_share_link)
 VALUES(test_id(1503),test_id(1504),test_id(1501),test_id(2),true,true);
SELECT test_assert((SELECT status='exited' FROM lifecycle_enrollments WHERE id=test_id(1510)),'creating a link stops invite-client reminders synchronously');
SELECT test_assert(EXISTS(SELECT 1 FROM lifecycle_enrollments WHERE sequence_key='cs_client_pending' AND email='2@test.example' AND context->>'project_id'=test_id(1501)::text AND next_position=2 AND emails_sent=0),'share-link inviter begins with pending reminder, without claiming an email was sent');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_enrollments WHERE sequence_key='iv_invited' AND context->>'project_id'=test_id(1501)::text),'unknown link recipient is never enrolled under an invented email');

-- Staff replies are recipient-bound, idempotent, immutable and leased.
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE authenticated;
SELECT queue_communication_reply((SELECT id FROM communication_threads WHERE enrollment_id=test_id(1104)),'Here is the next step.',test_id(1600));
SELECT queue_communication_reply((SELECT id FROM communication_threads WHERE enrollment_id=test_id(1104)),'Here is the next step.',test_id(1600));
SELECT test_refused($q$SELECT queue_communication_reply((SELECT id FROM communication_threads WHERE enrollment_id=test_id(1104)),'A changed message',test_id(1600))$q$,'message_reference_conflict');
RESET ROLE;
DO $$ DECLARE m public.communication_messages%ROWTYPE;p jsonb;c jsonb;old_token uuid;new_token uuid;BEGIN
 SELECT * INTO m FROM communication_messages WHERE client_ref=test_id(1600);
 PERFORM test_assert((SELECT count(*)=1 FROM communication_messages WHERE client_ref=test_id(1600)),'repeat queue is one outgoing message');
 p:=jsonb_build_object('to','11@test.example','subject',m.subject,'text','Frozen reply');
 c:=prepare_communication_reply(m.id,p);old_token:=(c->>'worker_token')::uuid;
 UPDATE communication_messages SET processing_until=now()-interval '1 minute' WHERE id=m.id;
 c:=prepare_communication_reply(m.id,p||'{"text":"Changed reply"}');new_token:=(c->>'worker_token')::uuid;
 PERFORM test_assert(c->'payload'->>'text'='Frozen reply','retry retains exact original wire payload');
 PERFORM test_assert(NOT finish_communication_reply(m.id,old_token,true,'reply-provider-1104'),'stale worker cannot finish a newer attempt');
 PERFORM record_communication_email_event('reply-provider-1104','delivered',now(),NULL,NULL,m.id);
 PERFORM finish_communication_reply(m.id,new_token,false,NULL,'resend_connection_uncertain');
 PERFORM test_assert((SELECT status='delivered' FROM communication_messages WHERE id=m.id),'staff reply retains early delivery verdict');
 PERFORM test_assert((SELECT attempt_count=1 AND contact_status='awaiting_reply' AND status='open' FROM followup_queue WHERE enrollment_id=test_id(1104)),'sending a reply logs contact and schedules the next attempt');
 PERFORM record_communication_email_event('reply-provider-1104','bounced',now());
 PERFORM record_communication_email_event('reply-provider-1104','delivered',now()+interval '1 second');
 PERFORM test_assert((SELECT status='bounced' FROM communication_messages WHERE id=m.id),'later delivery cannot erase a bounce');
 PERFORM test_assert((SELECT blocked_reason='bounced' FROM communication_preferences WHERE email='11@test.example'),'bounce suppresses further activation delivery');
END $$;
SELECT test_enrollment(1130,'test_delivery',12);
SELECT ensure_lifecycle_communication(test_id(1130));
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE authenticated;
SELECT queue_communication_reply((SELECT id FROM communication_threads WHERE enrollment_id=test_id(1130)),'Review the uncertain send.',test_id(1601));
SELECT queue_communication_reply((SELECT id FROM communication_threads WHERE enrollment_id=test_id(1130)),'Queued before role change.',test_id(1602));
RESET ROLE;
DO $$ DECLARE m public.communication_messages%ROWTYPE;BEGIN
 SELECT * INTO m FROM communication_messages WHERE client_ref=test_id(1601);
 PERFORM test_assert(m.payload->>'sender_email'='contact@tryjalla.com','staff follow-up uses the contact address');
 PERFORM prepare_communication_reply(m.id,jsonb_build_object('to','12@test.example','subject',m.subject,'text','Frozen reply'));
 UPDATE communication_messages SET started_at=now()-interval '24 hours',processing_until=now()-interval '1 minute' WHERE id=m.id;
 PERFORM test_assert(prepare_communication_reply(m.id) IS NULL,'uncertain sends stop before provider idempotency expires');
 PERFORM test_assert((SELECT status='blocked' AND last_error='delivery_needs_review' FROM communication_messages WHERE id=m.id),'expired uncertainty requires operator review');
 PERFORM test_assert(EXISTS(SELECT 1 FROM followup_queue WHERE enrollment_id=test_id(1130) AND kind='delivery' AND status='open'),'blocked reply appears in staff follow-up');
 DELETE FROM user_roles WHERE user_id=test_id(4) AND role='admin';
 PERFORM review_communication_followups();
 PERFORM test_assert((SELECT owner_id IS NULL FROM followup_queue WHERE enrollment_id=test_id(1130)),'demoted staff do not retain ownership of open follow-up');
 SELECT * INTO m FROM communication_messages WHERE client_ref=test_id(1602);
 PERFORM test_assert(prepare_communication_reply(m.id) IS NULL,'demoted staff cannot send an already queued reply');
 PERFORM test_assert((SELECT status='blocked' AND last_error='staff_role_changed' FROM communication_messages WHERE id=m.id),'role-change refusal is recorded');
 INSERT INTO user_roles VALUES(test_id(4),'admin');
END $$;
SELECT 'GROUNDWORK_COMMUNICATIONS_OK';
