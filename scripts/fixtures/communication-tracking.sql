RESET ROLE;
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT test_assert((SELECT delivery_enabled FROM communication_settings WHERE id)=(SELECT delivery_enabled FROM tracking_enablement_snapshot),'tracking upgrade preserves delivery flag');
SELECT test_assert((SELECT jsonb_agg(jsonb_build_object('key',key,'enabled',enabled) ORDER BY key) FROM lifecycle_sequences)=(SELECT journeys FROM tracking_enablement_snapshot),'tracking upgrade preserves journey flags');
INSERT INTO auth.users(id,email,created_at) VALUES(test_id(8001),'tracking-builder@test.example',now()-interval '12 days'),(test_id(8002),'tracking-client@test.example',now()-interval '2 days');
INSERT INTO profiles(id,full_name,preferred_lang) VALUES(test_id(8001),'Tracking builder','en'),(test_id(8002),'Tracking client','en');
INSERT INTO user_roles VALUES(test_id(8001),'contractor');
SET ROLE service_role;
SELECT record_communication_milestone('user_signup','TRACKING-BUILDER@test.example','{"user_role":"contractor","entry_source":"independent_signup"}');
SELECT record_communication_milestone('user_signup','tracking-builder@test.example','{"user_role":"contractor","entry_source":"independent_signup"}');
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM communication_milestones WHERE email='tracking-builder@test.example' AND event='user_signup')=1,'milestones are idempotent');
SELECT test_assert((SELECT occurred_at FROM communication_milestones WHERE email='tracking-builder@test.example' AND event='user_signup')=(SELECT created_at FROM auth.users WHERE id=test_id(8001)),'signup uses saved account creation time');
INSERT INTO contractor_onboarding(user_id,client_intent) VALUES(test_id(8001),'create_project');
SET ROLE service_role;
SELECT record_communication_milestone('contractor_onboarding_completed','tracking-builder@test.example','{"user_role":"contractor","entry_source":"independent_signup"}');
RESET ROLE;
UPDATE communication_milestones SET occurred_at=now()-interval '11 days' WHERE email='tracking-builder@test.example' AND event='contractor_onboarding_completed';
INSERT INTO projects(id,user_id,name,workflow_origin,created_at) VALUES(test_id(8100),test_id(8001),'Tracking project','contractor',now()-interval '10 hours');
INSERT INTO contractor_invites(id,project_id,email,status,contractor_user_id,invited_by,is_primary,accepted_at)
 VALUES(test_id(8101),test_id(8100),'tracking-builder@test.example','accepted',test_id(8001),test_id(8001),true,now()-interval '10 hours');
INSERT INTO project_viewers(id,token,project_id,email,is_client,invited_by,invited_at,email_status,email_delivered_at)
 VALUES(test_id(8102),test_id(8103),test_id(8100),'tracking-client@test.example',true,test_id(8001),now()-interval '8 hours','delivered',now()-interval '8 hours');
SET ROLE service_role;
SELECT record_communication_milestone('project_created','tracking-builder@test.example',jsonb_build_object('project_id',test_id(8100),'user_role','client'));
SELECT record_communication_milestone('user_signup','tracking-builder@test.example',jsonb_build_object('project_id',test_id(8100),'user_role','client','entry_source','contractor_invitation'));
SELECT record_communication_milestone('client_invited','tracking-client@test.example',jsonb_build_object('project_id',test_id(8100),'user_role','client','invite_path','/share/secret-capability-not-for-tracking','invitation_email_sent',true));
SELECT record_communication_milestone('user_signup','tracking-client@test.example',jsonb_build_object('project_id',test_id(8100),'user_role','client','entry_source','contractor_invitation'));
RESET ROLE;
SELECT test_assert((SELECT occurred_at FROM communication_milestones WHERE event='user_signup' AND email='tracking-client@test.example')=(SELECT created_at FROM auth.users WHERE id=test_id(8002)),'invited signup retains the account date rather than the project date');
SELECT test_assert((SELECT entry_source FROM communication_milestones WHERE event='user_signup' AND email='tracking-client@test.example')='client_invitation','invited client source matches the existing journey routing convention');
SELECT test_assert((SELECT count(*) FROM communication_milestones WHERE event='user_signup' AND email='tracking-builder@test.example')=1
 AND (SELECT entry_source FROM communication_milestones WHERE event='user_signup' AND email='tracking-builder@test.example')='independent_signup','a repeated signup with project context does not duplicate or reclassify the original independent signup');
SELECT test_assert((SELECT user_role FROM communication_milestones WHERE event='project_created' AND project_id=test_id(8100))='contractor','project origin is saved independently of later account roles');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_milestones WHERE subject_ref LIKE '%secret-capability%'),'invitation capabilities are not stored in tracking');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_project_connections WHERE project_id=test_id(8100)),'pending client is not a connection');
-- A link created for an unknown recipient is not a delivered invitation.
INSERT INTO projects(id,user_id,name,workflow_origin,created_at) VALUES(test_id(8110),test_id(8002),'Link project','client',now()-interval '9 hours');
INSERT INTO contractor_invites(id,project_id,is_share_link,invited_by,created_at)
 VALUES(test_id(8111),test_id(8110),true,test_id(8002),now()-interval '8 hours');

INSERT INTO lifecycle_enrollments(id,sequence_key,email,full_name,user_role,status,enrolled_at,next_position,context,subject_email,ref)
 VALUES(test_id(8120),'cs_client_pending','tracking-builder@test.example','Tracking builder','contractor','completed',now()-interval '8 days',4,
 jsonb_build_object('project_id',test_id(8100),'invite_path','/share/'||test_id(8103)::text),'tracking-client@test.example',test_id(8100)::text||':tracking-client@test.example');
INSERT INTO followup_queue(id,enrollment_id,sequence_key,email,kind,reason,due_at,created_at)
 VALUES(test_id(8121),test_id(8120),'cs_client_pending','tracking-builder@test.example','activation','Client invitation pending',now()+interval '1 day',now()-interval '2 days');
INSERT INTO lifecycle_sends(enrollment_id,sequence_key,position,email,channel,status,sent_at,step_code,subject)
 VALUES(test_id(8120),'cs_client_pending',2,'tracking-builder@test.example','email','sent',now()-interval '5 days','CS14','Invite reminder');
INSERT INTO lifecycle_deliveries(enrollment_id,position,payload,status,provider_id,delivery_status)
 VALUES(test_id(8120),2,'{"text":"Saved reminder","subject":"Invite reminder"}','sent','tracking-provider-id','delivered');
SELECT admin_followup_action(test_id(8121),'contacted','Helped the contractor resend the invitation',now()+interval '2 days');
UPDATE communication_followup_events SET created_at=now()-interval '1 day' WHERE followup_id=test_id(8121) AND kind='contacted';
SELECT test_assert((SELECT status FROM followup_queue WHERE id=test_id(8121))='open','human contact leaves activation open');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_action_outcomes WHERE enrollment_id=test_id(8120)),'sequence exhaustion and human contact do not count as recovery');
SELECT test_refused(format('SELECT admin_followup_action(%L,''resolve'','''',NULL,NULL)',test_id(8121)),'required_action_incomplete');

CREATE TEMP TABLE tracking_before AS SELECT admin_communication_tracking(now()-interval '20 days',now()-interval '1 hour') AS report;
SELECT test_assert((SELECT report#>>'{metrics,signupToOnboarding,total}' FROM tracking_before)='1','recorded independent signup denominator');
SELECT test_assert((SELECT report#>>'{metrics,signupToOnboarding,completed}' FROM tracking_before)='1','onboarding conversion uses a completed action');
SELECT test_assert((SELECT report#>>'{metrics,onboardingToProject,completed}' FROM tracking_before)='1','onboarding to owned project conversion');
SELECT test_assert((SELECT report#>>'{metrics,projectToInvitation,total}' FROM tracking_before)='2','first projects counted once per owner');
SELECT test_assert((SELECT report#>>'{metrics,projectToInvitation,completed}' FROM tracking_before)='1','unclaimed link does not become a delivered email');
SELECT test_assert((SELECT report#>>'{metrics,invitationAcceptance,total}' FROM tracking_before)='1','only confirmed delivered invitations in acceptance denominator');
SELECT test_assert((SELECT report#>>'{metrics,linkClaims,total}' FROM tracking_before)='1','link claims have their own denominator');
SELECT test_assert((SELECT report#>>'{metrics,humanRecovery,completed}' FROM tracking_before)='0','contact alone does not count as human recovery');
-- Provider acceptance proves the invitation was sent, but not that it was delivered.
INSERT INTO contractor_invites(id,project_id,email,invited_by,created_at,email_message_id,email_status)
 VALUES(test_id(8112),test_id(8110),'tracking-other@test.example',test_id(8002),now()-interval '7 hours','pending-delivery-provider-id','sent');
SELECT test_assert((admin_communication_tracking(now()-interval '20 days',now()-interval '1 hour')#>>'{metrics,projectToInvitation,completed}')='2','sent invitations count before delivery confirmation');
SELECT test_assert((admin_communication_tracking(now()-interval '20 days',now()-interval '1 hour')#>>'{metrics,invitationAcceptance,total}')='1','provider acceptance does not inflate the delivered invitation denominator');

UPDATE project_viewers SET user_id=test_id(8002),accepted_at=now() WHERE id=test_id(8102);
SELECT test_assert((SELECT connected_at IS NOT NULL FROM communication_project_connections WHERE project_id=test_id(8100)),'real two-party connection records time');
SELECT set_config('test.actor',test_id(4)::text,false);
SET ROLE service_role;
SELECT record_communication_milestone('project_membership_active','tracking-client@test.example',jsonb_build_object('project_id',test_id(8100),'user_role','client'));
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM communication_action_outcomes WHERE enrollment_id=test_id(8120)),'returning after the email sequence ended records actual completion');
SELECT test_assert((SELECT status FROM followup_queue WHERE id=test_id(8121))='done','joining the project closes the activation follow-up automatically');
-- Isolate the call entered after closure: its actual contact time, not the late
-- logging time, must place it in the measurement cohort and before recovery.
DELETE FROM communication_followup_events WHERE followup_id=test_id(8121) AND kind='contacted' AND contacted_at IS NULL;
SELECT admin_log_communication_contact(test_id(8121),'contacted','Added the completed call after the client joined',now()-interval '2 hours',NULL);
SELECT test_assert((SELECT status FROM followup_queue WHERE id=test_id(8121))='done','recording a completed call does not reopen activation');
SELECT test_assert(EXISTS(SELECT 1 FROM communication_followup_events WHERE followup_id=test_id(8121) AND abs(extract(epoch FROM contacted_at-(now()-interval '2 hours')))<2),'actual contact time is retained separately from the time it was logged');
SELECT test_refused(format('SELECT admin_log_communication_contact(%L,''contacted'',''invalid'',now()+interval ''2 days'',NULL)',test_id(8121)),'invalid_contact_time');
SELECT test_refused(format('SELECT admin_mark_duplicate_project(%L,true,'''')',test_id(8110)),'duplicate_reason_required');
SELECT admin_mark_duplicate_project(test_id(8110),true,'Team confirmed this was a duplicate during review');
CREATE TEMP TABLE tracking_after AS SELECT admin_communication_tracking(now()-interval '20 days',now()-interval '1 hour') AS report;
SELECT test_assert((SELECT report#>>'{metrics,invitationAcceptance,completed}' FROM tracking_after)='1','accepted invitation recovery');
SELECT test_assert((SELECT report#>>'{metrics,humanRecovery,completed}' FROM tracking_after)='1','verified completion after contact counts as recovery');
SELECT test_assert((SELECT report#>>'{metrics,duplicateProjects,completed}' FROM tracking_after)='1','reviewed duplicate flag measured');
SELECT test_assert((SELECT report#>>'{metrics,medianConnectionHours}' FROM tracking_after) IS NOT NULL,'connection median uses recorded times');
SELECT test_assert(EXISTS(SELECT 1 FROM tracking_after,jsonb_array_elements(report->'recovery') r WHERE r->>'step_code'='CS14' AND r->>'completed'='1'),'reminder recovery uses last delivered message before actual completion');
SELECT test_assert((admin_communication_tracking(now()-interval '20 days',now()-interval '1 hour','tracking-builder','Contractor self-signup','action_complete')->>'total')='1','person filters include people whose email sequence has ended');
SELECT admin_mark_duplicate_project(test_id(8110),false,'');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM communication_duplicate_projects WHERE project_id=test_id(8110)),'duplicate flag can be corrected');
UPDATE projects SET status='on_hold' WHERE id=test_id(8110);
UPDATE contractor_invites SET status='accepted',contractor_user_id=test_id(8001),is_primary=true,accepted_at=now() WHERE id=test_id(8111);
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(admin_contractor_tracking_index()) r WHERE r->>'userId'=test_id(8001)::text
 AND r->>'projectCount'='2' AND r->'projectStatuses' ? 'on_hold'
 AND (r->>'joinedAt')::timestamptz=(SELECT created_at FROM auth.users WHERE id=test_id(8001))),'contractor filters include assigned projects and the actual account joining date');
SELECT test_refused('SELECT admin_communication_tracking(now(),now()-interval ''1 day'')','invalid_tracking_filter');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(8002)::text,false);
SELECT test_refused('SELECT admin_communication_tracking()','not_admin');
SELECT test_refused('SELECT admin_contractor_tracking_index()','not_admin');
SELECT test_refused(format('SELECT admin_mark_duplicate_project(%L,true,''test'')',test_id(8110)),'not_admin');
SELECT test_refused('SELECT record_communication_milestone(''user_signup'',''other@test.example'',''{}'')','permission denied');
SELECT test_refused(format('SELECT admin_log_communication_contact(%L,''contacted'',''unauthorized'',now(),NULL)',test_id(8121)),'not_admin');
SELECT test_assert((SELECT count(*) FROM communication_milestones)=0,'ordinary user cannot read tracking');
RESET ROLE;
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT 'COMMUNICATION_TRACKING_OK' AS result;
