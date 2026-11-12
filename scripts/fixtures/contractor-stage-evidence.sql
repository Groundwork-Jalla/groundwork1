CREATE FUNCTION public.actor(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',label; END IF;
END $$;
CREATE FUNCTION public.proof(p int,n text DEFAULT 'photo.jpg') RETURNS text LANGUAGE sql AS $$ SELECT test_id($1)::text||'/'||test_id($1,1)::text||'/'||test_sub($1,1,1)::text||'/'||$2 $$;
-- Helpers are fixtures only: migration/RPC functions are the production implementations.
SELECT set_config('test.actor',actor(4)::text,false);
INSERT INTO user_roles VALUES(actor(3),'contractor'),(actor(5),'contractor'),(actor(6),'contractor');
INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,current_stage)
 VALUES(test_id(301),actor(1),'US','boq','USD',1,100,100,1),
       (test_id(302),actor(2),'US','boq','USD',1,100,100,1),
       (test_id(303),actor(6),'US','boq','USD',1,100,100,1);
INSERT INTO contractor_invites(project_id,status,contractor_user_id,invited_by,is_primary)
 VALUES(test_id(301),'accepted',actor(2),actor(1),true),
       (test_id(302),'accepted',actor(2),actor(2),true),
       (test_id(303),'accepted',actor(6),actor(6),true),
       (test_id(301),'rejected',actor(7),actor(1),false),
       (test_id(301),'pending',actor(8),actor(1),false);
INSERT INTO project_viewers(project_id,user_id,is_client,accepted_at)
 VALUES(test_id(301),actor(3),false,now()),(test_id(302),actor(5),true,now()),(test_id(303),actor(1),true,now());
INSERT INTO project_verifiers VALUES(test_id(301),actor(9),'active');
INSERT INTO project_stages(id,project_id,stage_number,status,payment_milestone_usd,milestone_amount)
 SELECT test_id(p,n),test_id(p),n,CASE WHEN n=1 THEN 'active' ELSE 'locked' END,100,100 FROM generate_series(301,303) p CROSS JOIN generate_series(1,2) n;
INSERT INTO project_substages(id,project_id,stage_id,status,evidence_urls)
 SELECT test_sub(p,n,1),test_id(p),test_id(p,n),CASE WHEN n=1 THEN 'pending' ELSE 'locked' END,'[]'::jsonb FROM generate_series(301,303) p CROSS JOIN generate_series(1,2) n;
INSERT INTO payments(project_id,stage_id,direction,state,amount)
 SELECT test_id(p),test_id(p,n),'in','expected',100 FROM generate_series(301,303) p CROSS JOIN generate_series(1,2) n;
SELECT mark_stage_paid(test_id(301,1),'Fixture initial funding');
-- Keep broad legacy owner/member write policies so the new guards are actually exercised.
ALTER TABLE project_substages ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_substage_member ON project_substages FOR ALL TO authenticated USING(public.project_member(project_id) OR public.is_admin()) WITH CHECK(public.project_member(project_id) OR public.is_admin());
CREATE POLICY site_update_members_read ON site_updates FOR SELECT TO authenticated USING(public.project_member(project_id) OR public.is_admin());
CREATE POLICY legacy_storage_member ON storage.objects FOR ALL TO authenticated USING(public.project_member(public.try_uuid(split_part(name,'/',1))) OR public.is_admin()) WITH CHECK(public.project_member(public.try_uuid(split_part(name,'/',1))) OR public.is_admin());
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated;
GRANT SELECT ON projects,project_stages,payments,test_activity,site_updates TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON project_substages,storage.objects TO authenticated;
-- A payer can upload payment receipts and documents, but not construction evidence.
SET ROLE authenticated;
SELECT set_config('test.actor',actor(1)::text,false);
SELECT test_assert(is_project_client(test_id(301)) AND NOT project_evidence_writer(test_id(301)),'client ownership does not authorise construction evidence');
SELECT test_refused($q$INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',proof(301))$q$,'new row violates row-level security');
INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',test_id(301)::text||'/receipts/client.png'),('documents',test_id(301)::text||'/boq.pdf');
SELECT test_refused($q$SELECT submit_site_update(test_id(301,1),test_sub(301,1,1),'Client update','[]')$q$,'not_submitter:');
SELECT test_refused($q$UPDATE project_substages SET evidence_urls=jsonb_build_array(proof(301)) WHERE id=test_sub(301,1,1)$q$,'contractor_evidence_only:');
SELECT test_refused($q$INSERT INTO project_substages(id,project_id,stage_id,status,evidence_urls) VALUES(test_sub(301,1,2),test_id(301),test_id(301,1),'pending',jsonb_build_array(proof(301)))$q$,'contractor_evidence_only:');
-- The assigned contractor uploads and files the evidence; the client receives a viewer.
SELECT set_config('test.actor',actor(2)::text,false);
INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',proof(301)),('evidence',proof(302)),('evidence',proof(302,'extra.jpg'));
SELECT submit_site_update(test_id(301,1),test_sub(301,1,1),'Contractor evidence',jsonb_build_array(proof(301)),NULL,actor(100));
SELECT submit_site_update(test_id(301,1),test_sub(301,1,1),'Contractor evidence',jsonb_build_array(proof(301)),NULL,actor(100));
SELECT test_assert((SELECT count(*) FROM site_updates WHERE project_id=test_id(301))=1 AND (SELECT jsonb_array_length(evidence_urls) FROM project_substages WHERE id=test_sub(301,1,1))=1,'retries keep one contractor update and one proof reference');
SELECT test_refused($q$SELECT submit_site_update(test_id(301,1),test_sub(301,1,1),'Reuse payment receipt',jsonb_build_array(test_id(301)::text||'/receipts/client.png'))$q$,'path_mismatch:');
SELECT test_refused($q$SELECT submit_site_update(test_id(303,1),test_sub(303,1,1),'Other project','[]')$q$,'not_submitter:');
SELECT test_refused($q$SELECT submit_site_update(test_id(301,2),test_sub(301,2,1),'Future work','[]')$q$,'wrong_state:');
SELECT submit_site_update(test_id(302,1),test_sub(302,1,1),'Contractor-created initial evidence',jsonb_build_array(proof(302)),NULL,actor(101));
SELECT test_assert(NOT stage_funding_settled(test_id(302,1)) AND (SELECT state FROM payments WHERE stage_id=test_id(302,1))='expected','contractor initial evidence does not fabricate funding');
-- Global contractor accounts invited as observers/clients receive only their project role.
SELECT set_config('test.actor',actor(3)::text,false);
SELECT test_assert(NOT project_evidence_writer(test_id(301)) AND (SELECT count(*) FROM storage.objects WHERE name=proof(301))=1,'global contractor observer reads without write permission');
SELECT test_refused($q$INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',proof(301,'observer.jpg'))$q$,'new row violates row-level security');
SELECT test_refused($q$SELECT submit_site_update(test_id(301,1),test_sub(301,1,1),'Observer update','[]')$q$,'not_submitter:');
SELECT set_config('test.actor',actor(5)::text,false);
SELECT test_assert(is_project_client(test_id(302)) AND NOT project_evidence_writer(test_id(302)),'global contractor primary client reviews on this project');
INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',test_id(302)::text||'/receipts/payer.png');
SELECT test_refused($q$SELECT submit_site_update(test_id(302,1),test_sub(302,1,1),'Payer evidence','[]')$q$,'not_submitter:');
SELECT approve_substage(test_sub(302,1,1));
SELECT test_assert((SELECT review_payment_pending FROM project_stages WHERE id=test_id(302,1)),'primary client can review contractor evidence and request the same-stage receipt');
SELECT set_config('test.actor',actor(2)::text,false);
SELECT test_refused($q$UPDATE project_substages SET evidence_urls=jsonb_build_array(proof(302,'extra.jpg')) WHERE id=test_sub(302,1,1)$q$,'evidence_reviewed:');
-- Clients can read/approve but cannot remove, replace, or rename the contractor's proof.
SELECT set_config('test.actor',actor(1)::text,false);
SELECT test_assert((SELECT evidence_urls @> jsonb_build_array(proof(301)) FROM project_substages WHERE id=test_sub(301,1,1)) AND (SELECT count(*) FROM storage.objects WHERE name=proof(301))=1,'client can open contractor proof');
SELECT test_refused($q$UPDATE project_substages SET evidence_urls='[]' WHERE id=test_sub(301,1,1)$q$,'contractor_evidence_only:');
SELECT test_refused($q$DELETE FROM project_substages WHERE id=test_sub(301,1,1)$q$,'contractor_evidence_only:');
DELETE FROM storage.objects WHERE name=proof(301);
UPDATE storage.objects SET version='client-replaced' WHERE name=proof(301);
UPDATE storage.objects SET name=test_id(301)::text||'/receipts/renamed.jpg' WHERE name=proof(301);
SELECT test_assert((SELECT count(*) FROM storage.objects WHERE name=proof(301) AND version='v1')=1,'storage policies block client deletion, overwrite and rename');
SELECT approve_substage(test_sub(301,1,1));
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(301,1))='complete','client approval remains available and follows existing progression');
-- Revoked, pending, verifier and unassigned staff roles do not gain evidence authorship.
SELECT set_config('test.actor',actor(7)::text,false);
SELECT test_assert(NOT project_evidence_writer(test_id(301)),'revoked contractor cannot author evidence');
SELECT set_config('test.actor',actor(8)::text,false);
SELECT test_assert(NOT project_evidence_writer(test_id(301)),'pending contractor cannot author evidence');
SELECT set_config('test.actor',actor(9)::text,false);
SELECT test_assert((SELECT count(*) FROM storage.objects WHERE name=proof(301))=1 AND NOT project_evidence_writer(test_id(301)),'verifier sees contractor proof without authoring site updates');
SELECT set_config('test.actor',actor(4)::text,false);
SELECT test_refused($q$SELECT submit_site_update(test_id(301,2),test_sub(301,2,1),'Staff evidence','[]')$q$,'not_submitter:');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'CONTRACTOR_EVIDENCE_OK' AS result;
