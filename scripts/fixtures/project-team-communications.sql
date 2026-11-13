-- Exercise real invitation RPCs after installing the new communication triggers.
RESET ROLE;
INSERT INTO projects(id,user_id) VALUES(test_id(304),test_id(1)),(test_id(305),test_id(2));
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary)
 VALUES(test_id(305),test_id(2),'2@test.example','accepted',now(),test_id(2),true);
UPDATE lifecycle_sequences SET enabled=true WHERE key IN('cl_contractor_pending','cs_client_pending');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT create_project_invitation_link(test_id(304),'contractor');
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT create_project_invitation_link(test_id(305),'client');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM lifecycle_enrollments WHERE sequence_key='cl_contractor_pending' AND email='1@test.example' AND context->>'project_id'=test_id(304)::text),'actual contractor-link RPC creates known-inviter follow-up');
SELECT test_assert(EXISTS(SELECT 1 FROM lifecycle_enrollments WHERE sequence_key='cs_client_pending' AND email='2@test.example' AND context->>'project_id'=test_id(305)::text),'actual client-link RPC creates known-inviter follow-up');
DO $$ DECLARE tok uuid;BEGIN
 SELECT token INTO tok FROM contractor_invites WHERE project_id=test_id(304);
 PERFORM set_config('test.actor',test_id(7)::text,true);PERFORM accept_contractor_invite(tok);
 SELECT token INTO tok FROM project_viewers WHERE project_id=test_id(305) AND is_client;
 PERFORM set_config('test.actor',test_id(3)::text,true);PERFORM accept_project_viewer(tok);
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(is_primary_project_contractor(test_id(304)) AND EXISTS(SELECT 1 FROM projects WHERE id=test_id(304)),'contractor can read claimed project with communication triggers installed');
SELECT set_config('test.actor',test_id(3)::text,false);
SELECT test_assert(is_project_client(test_id(305)) AND EXISTS(SELECT 1 FROM projects WHERE id=test_id(305)),'primary client can read claimed project with communication triggers installed');
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_enrollments WHERE sequence_key IN('cl_contractor_pending','cs_client_pending') AND context->>'project_id' IN(test_id(304)::text,test_id(305)::text) AND status='active'),'claiming either role retires the pending reminder');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM lifecycle_sends s JOIN lifecycle_enrollments e ON e.id=s.enrollment_id WHERE e.context->>'project_id' IN(test_id(304)::text,test_id(305)::text)),'creating and accepting links does not fabricate sent email');
SELECT 'PROJECT_TEAM_COMMUNICATIONS_OK';
