RESET ROLE;
INSERT INTO projects(id,user_id,created_at,target_start,created_by) VALUES
 (test_id(301),test_id(12),'2026-11-14','2026-11-20',NULL),
 (test_id(302),test_id(16),'2026-11-14','2026-11-20',NULL),
 (test_id(303),test_id(16),'2026-11-14','2026-11-20',test_id(4)),
 (test_id(304),test_id(12),'2026-11-14','2026-11-20',NULL),
 (test_id(305),test_id(12),'2026-11-14','2026-11-20',NULL),
 (test_id(306),test_id(12),'2026-11-14','2026-11-20',NULL),
 (test_id(307),test_id(12),'2026-11-14','2026-11-20',NULL),
 (test_id(308),test_id(18),'2026-11-14','2026-11-20',NULL),
 (test_id(309),test_id(16),'2026-11-14','2026-11-20',test_id(4));
INSERT INTO project_documents(project_id,category) SELECT test_id(n),'boq' FROM generate_series(301,309) n WHERE n<>306;
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary)
 SELECT test_id(n),test_id(12),'12@test.example','accepted',now(),test_id(12),true FROM generate_series(301,307) n WHERE n NOT IN(302,303,305);
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary)
 VALUES(test_id(302),test_id(16),'13@test.example','accepted',now(),test_id(13),true),
 (test_id(303),test_id(4),'13@test.example','accepted',now(),test_id(13),true),
 (test_id(309),test_id(4),'13@test.example','accepted',now(),test_id(13),true);
INSERT INTO contractor_invites(project_id,invited_by,email,status,primary_on_acceptance)
 VALUES(test_id(305),test_id(12),'12@test.example','pending',true);
INSERT INTO site_updates(project_id,submitted_by) SELECT test_id(n),test_id(12) FROM generate_series(301,306) n;
INSERT INTO project_viewers(project_id,email,user_id,accepted_at,is_client) VALUES
 (test_id(301),'17@test.example',test_id(17),now(),false),
 (test_id(304),'12@test.example',test_id(12),now(),true),
 (test_id(305),'16@test.example',test_id(16),now(),true),
 (test_id(306),'16@test.example',test_id(16),now(),true),
 (test_id(307),'16@test.example',test_id(16),now(),true);
SELECT test_assert(project_business_status(test_id(301))='qualified','observer/family acceptance does not verify a project');
INSERT INTO project_viewers(project_id,email,is_client) VALUES(test_id(301),'16@test.example',true);
SELECT test_assert(project_business_status(test_id(301))='qualified','a pending primary client does not count as joined');
UPDATE project_viewers SET user_id=test_id(16),accepted_at=now() WHERE project_id=test_id(301) AND is_client;
SELECT test_assert(project_business_status(test_id(301))='verified','a primary client joining is enough: no client approval, payment or message is required');
UPDATE project_viewers SET revoked_at=now(),revoked_by=test_id(4) WHERE project_id=test_id(301) AND is_client;
SELECT test_assert(project_business_status(test_id(301))='qualified','revoking the primary client stops verified status even with observers present');
UPDATE project_viewers SET revoked_at=NULL,revoked_by=NULL WHERE project_id=test_id(301) AND is_client;
SELECT test_assert(project_business_status(test_id(302))='verified','a client who creates their own project is already joined');
SELECT test_assert(project_business_status(test_id(303))='qualified','creating a project for a client does not prove that client has joined');
SELECT test_assert(project_business_status(test_id(304))='qualified','a contractor cannot count as their own financing client');
SELECT test_assert(project_business_status(test_id(305))='qualified','a pending contractor does not verify a project');
SELECT test_assert(project_business_status(test_id(306))='general','verified remains a subset of qualified and requires a BOQ');
INSERT INTO project_documents(project_id,category) VALUES(test_id(306),'boq');
UPDATE projects SET target_start='2027-02-14' WHERE id=test_id(306);
SELECT test_assert(project_business_status(test_id(306))='general','a start date beyond the 60-day qualification window is still general');
SELECT test_assert(project_business_status(test_id(307))='qualified','the existing ground-update requirement is retained');
INSERT INTO site_updates(project_id,submitted_by) VALUES(test_id(307),test_id(12));
SELECT test_assert(project_business_status(test_id(307))='verified','current contractor evidence uses the same ground-update signal');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_business_statuses s WHERE s.business_status IS DISTINCT FROM project_business_status(s.project_id)),'bulk and individual reads use one definition');
SELECT test_assert((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.project_business_statuses'::regclass),'the view preserves caller RLS');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(17)::text,false);
SELECT test_refused($q$SELECT record_primary_client_join(test_id(301))$q$,'not_project_client');
SELECT test_assert(project_business_status(test_id(308)) IS NULL,'a status function cannot disclose an unrelated project');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_business_statuses WHERE project_id=test_id(308)),'the bulk report cannot disclose an unrelated project');
SELECT set_config('test.actor',test_id(13)::text,false);
SELECT test_refused($q$SELECT record_primary_client_join(test_id(303))$q$,'not_project_client');
SELECT set_config('test.actor',test_id(16)::text,false);
SELECT record_primary_client_join(test_id(303));
SELECT record_primary_client_join(test_id(303));
RESET ROLE;
SELECT test_assert(project_business_status(test_id(303))='verified','a provisioned primary client joins by opening their project without another action');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(303) AND actor_id=test_id(16) AND action='project.client_joined')=1,'repeated visits record the same join once');
INSERT INTO user_roles(user_id,role) VALUES(test_id(16),'contractor');
SELECT test_assert(project_business_status(test_id(301))='verified','an account role does not erase a different accepted primary-client project role');
SELECT test_assert(NOT has_function_privilege('anon','public.record_primary_client_join(uuid)','EXECUTE'),'an anonymous visit cannot establish a primary-client join');
SELECT 'VERIFIED_PROJECT_PARTICIPANTS_OK';
