// Exercise the real migration and RLS without a listener or external credentials.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const bin = process.env.GROUNDWORK_PG_BIN
  ?? [18, 17, 16, 15, 14].map(v => `/usr/lib/postgresql/${v}/bin`).find(p => existsSync(join(p, 'initdb')));
if (!bin) throw new Error('Set GROUNDWORK_PG_BIN to the directory containing initdb and postgres.');
const read = file => readFileSync(join(root, file), 'utf8');
const fn = (file, name) => {
  const source = read(file);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const body = source.indexOf('AS $$', start);
  if (start < 0 || body < 0) throw new Error(`Missing function: ${name}`);
  return source.slice(start, source.indexOf('$$;', body + 5) + 3);
};
const dir = mkdtempSync(join(tmpdir(), 'groundwork-team-test-'));
let started = false;
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'], { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION public.test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()=public.test_id(4),false) $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
INSERT INTO auth.users SELECT test_id(n),n||'@test.example',CASE WHEN n=9 THEN NULL ELSE now() END FROM generate_series(1,10) n;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text);
CREATE TABLE public.user_roles(user_id uuid,role text,UNIQUE(user_id,role));
INSERT INTO user_roles VALUES(test_id(2),'contractor'),(test_id(7),'contractor'),(test_id(10),'contractor');
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid,name text DEFAULT 'Home',budget_source text DEFAULT 'boq',budget_amount numeric DEFAULT 141407337.524);
INSERT INTO projects(id,user_id) SELECT test_id(n),test_id(CASE WHEN n IN(102,106,108) THEN 2 WHEN n=107 THEN 3 ELSE 1 END) FROM generate_series(101,110) n;
CREATE TABLE public.project_stages(id uuid PRIMARY KEY,project_id uuid,milestone_amount numeric,status text,pre_existing boolean);
INSERT INTO project_stages VALUES(test_id(501),test_id(101),141407337.524,'complete',true),(test_id(502),test_id(102),0,'locked',false);
CREATE TABLE public.contractor_invites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES projects,invited_by uuid REFERENCES auth.users,email text NOT NULL,
 role text DEFAULT 'contractor',status text DEFAULT 'pending' CHECK(status IN('pending','accepted','rejected')),accepted_at timestamptz,
 created_at timestamptz DEFAULT now(),token uuid UNIQUE DEFAULT gen_random_uuid(),contractor_user_id uuid REFERENCES auth.users,
 is_primary boolean NOT NULL DEFAULT false CHECK(NOT is_primary OR status='accepted'),UNIQUE(project_id,email),
 email_status text DEFAULT 'queued',email_message_id text,email_sent_at timestamptz,email_delivered_at timestamptz,email_error text,email_attempts int DEFAULT 0);
CREATE UNIQUE INDEX contractor_invites_one_primary ON contractor_invites(project_id) WHERE is_primary;
CREATE TABLE public.project_viewers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES projects,email text NOT NULL,relationship text,invited_by uuid REFERENCES auth.users,
 token uuid UNIQUE DEFAULT gen_random_uuid(),invited_at timestamptz DEFAULT now(),user_id uuid REFERENCES auth.users,accepted_at timestamptz,
 revoked_at timestamptz,revoked_by uuid REFERENCES auth.users,is_client boolean NOT NULL DEFAULT false,
 CHECK((accepted_at IS NULL)=(user_id IS NULL)),CHECK((revoked_at IS NULL)=(revoked_by IS NULL)));
CREATE UNIQUE INDEX project_viewers_one_client ON project_viewers(project_id) WHERE is_client AND revoked_at IS NULL;
CREATE UNIQUE INDEX project_viewers_one_open_per_email ON project_viewers(project_id,lower(email)) WHERE revoked_at IS NULL;
CREATE TABLE public.project_takeoffs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES projects,created_by uuid,status text DEFAULT 'draft',inputs jsonb DEFAULT '{}',overrides jsonb DEFAULT '{}');
ALTER TABLE project_takeoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_all_takeoffs ON project_takeoffs FOR ALL USING(public.is_admin()) WITH CHECK(public.is_admin());
CREATE POLICY owners_select_takeoffs ON project_takeoffs FOR SELECT USING(status<>'draft' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=project_id AND p.user_id=auth.uid()));
INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(101),test_id(1));
CREATE TABLE public.project_verifiers(project_id uuid,user_id uuid,status text);
CREATE TABLE public.contractor_clients(client_id uuid,contractor_id uuid,client_was_created boolean,accepted_at timestamptz);
CREATE TABLE public.test_activity(project_id uuid,event text,details jsonb);
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ($3 IS NULL)<>($4 IS NULL) THEN RAISE EXCEPTION 'bad_entity'; END IF;
 IF $1 IS NULL AND $5 IS NULL THEN RAISE EXCEPTION 'no_subject'; END IF;
 INSERT INTO test_activity VALUES($1,$2,$6); END $$;
CREATE FUNCTION public.test_assert(ok boolean,description text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',description; END IF; END $$;
CREATE FUNCTION public.test_refused(statement text,prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; RAISE EXCEPTION 'TEST_EXPECTED_REFUSAL: %',prefix;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE prefix||'%' THEN RAISE; END IF; END;
END $$;
-- Legacy fixtures: preserve explicit primary roles, repair only unambiguous ones.
INSERT INTO contractor_invites(project_id,invited_by,email,status,accepted_at,contractor_user_id,is_primary) VALUES
 (test_id(102),test_id(2),'2@test.example','accepted',now(),test_id(2),true),
 (test_id(103),test_id(1),'10@test.example','accepted',now(),test_id(10),false),
 (test_id(104),test_id(1),'7@test.example','accepted',now(),test_id(7),false),
 (test_id(104),test_id(1),'10@test.example','accepted',now(),test_id(10),false),
 (test_id(108),test_id(2),'2@test.example','accepted',now(),test_id(2),false),
 (test_id(108),test_id(2),'7@test.example','accepted',now(),test_id(7),true);
INSERT INTO contractor_invites(project_id,invited_by,email) VALUES(test_id(105),test_id(1),'2@test.example');
INSERT INTO contractor_invites(project_id,invited_by,email,status,email_status,email_message_id,email_delivered_at,email_attempts)
 VALUES(test_id(109),test_id(1),'2@test.example','rejected','delivered','old-email',now(),4);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_all_invites ON contractor_invites FOR ALL USING(EXISTS(SELECT 1 FROM projects WHERE id=project_id AND user_id=auth.uid()));
CREATE POLICY contractors_read_own_invites ON contractor_invites FOR SELECT USING(contractor_user_id=auth.uid());
CREATE POLICY admins_read_invites ON contractor_invites FOR SELECT USING(public.is_admin());
CREATE POLICY owner_reads_project_viewers ON project_viewers FOR SELECT USING(user_id=auth.uid() OR public.is_admin());

CREATE TABLE public.project_substages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid);
CREATE TABLE public.project_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid);
CREATE TABLE public.project_fees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid);
CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,direction text);
ALTER TABLE project_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_substages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
INSERT INTO project_stages VALUES(test_id(503),test_id(110),123.456,'locked',false);
INSERT INTO project_substages(project_id) VALUES(test_id(110));
INSERT INTO project_documents(project_id) VALUES(test_id(110));
INSERT INTO project_fees(project_id) VALUES(test_id(110));
INSERT INTO payments(project_id,direction) VALUES(test_id(110),'in'),(test_id(110),'out');

GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
`;
  const policies = `
CREATE POLICY members_read_projects ON projects FOR SELECT USING(public.project_member(id) OR public.is_admin());
CREATE TRIGGER trg_contractor_invites_clear_primary BEFORE UPDATE ON contractor_invites
 FOR EACH ROW EXECUTE FUNCTION public.contractor_invites_clear_primary();
`;
  const tests = `
SELECT test_assert((SELECT is_primary FROM contractor_invites WHERE project_id=test_id(103)),'sole accepted contractor repaired');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contractor_invites WHERE project_id=test_id(104) AND is_primary),'ambiguous legacy contractors not picked');
SELECT test_assert((SELECT primary_on_acceptance FROM contractor_invites WHERE project_id=test_id(105)),'sole pending contractor repaired');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert(project_team_access(test_id(101))->>'can_invite_contractor'='true','client can choose first contractor');
SELECT test_assert(project_team_access(test_id(104))->>'needs_primary_review'='true','ambiguous primary needs staff review');
DO $$ DECLARE c contractor_invites%ROWTYPE; again contractor_invites%ROWTYPE; BEGIN
 c:=invite_project_contractor(test_id(101),' 2@TEST.EXAMPLE ');
 PERFORM test_assert(c.primary_on_acceptance AND c.invited_by=test_id(1) AND NOT c.is_primary,'initial intent and server chosen inviter');
 again:=invite_project_contractor(test_id(101),'2@test.example');
 PERFORM test_assert(c.token=again.token,'pending invite retry keeps token');
 PERFORM test_assert(project_team_access(test_id(101))->>'can_invite_contractor'='false','pending hides initial form');
END $$;
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'7@test.example')$q$,'contractor_invitation_pending');
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'1@test.example')$q$,'self_invite');
SELECT test_refused($q$SELECT invite_project_viewer(test_id(101),'bad address')$q$,'invalid_email');
-- Verified recipient matching and idempotent primary assignment on acceptance.
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_assert(current_user='authenticated' AND row_security_active('contractor_invites'),'RLS is active for the authenticated test actor');
SELECT test_assert((SELECT count(*) FROM contractor_invites WHERE project_id=test_id(101))=0,'outsider cannot read invitation token');
RESET ROLE;
DO $$ DECLARE tok uuid; BEGIN
 SELECT token INTO tok FROM contractor_invites WHERE project_id=test_id(101);
 PERFORM set_config('test.actor',test_id(8)::text,true);
 PERFORM test_refused(format('SELECT accept_contractor_invite(%L)',tok),'invite_email_mismatch');
 PERFORM set_config('test.actor',test_id(2)::text,true);
 PERFORM test_assert(accept_contractor_invite(tok)=test_id(101),'recipient joins correct project');
 PERFORM test_assert(accept_contractor_invite(tok)=test_id(101),'accept retry idempotent');
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT test_assert(is_primary_project_contractor(test_id(101)) AND can_invite_project_people(test_id(101)),'invited primary contractor may invite');
SELECT test_assert(NOT is_project_client(test_id(102)),'contractor owner cannot approve before inviting client');
SELECT invite_project_viewer(test_id(101),'3@test.example',NULL,false);
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'7@test.example')$q$,'not_permitted');
-- Contractor-created project: choose client, never promote observers by re-inviting.
SELECT invite_project_viewer(test_id(102),'3@test.example',NULL,false);
SELECT test_refused($q$SELECT invite_project_viewer(test_id(102),'3@test.example',NULL,true)$q$,'role_change_requires_admin');
SELECT invite_project_viewer(test_id(102),'1@test.example','Client',true);
SELECT test_assert(NOT is_project_client(test_id(102)),'contractor cannot approve own work after naming client');
SELECT test_refused($q$SELECT invite_project_viewer(test_id(102),'6@test.example',NULL,true)$q$,'not_permitted');
DO $$ DECLARE tok uuid; BEGIN
 SELECT token INTO tok FROM project_viewers WHERE project_id=test_id(102) AND is_client;
 PERFORM set_config('test.actor',test_id(1)::text,true);
 PERFORM test_assert(NOT can_invite_project_people(test_id(102)),'unaccepted client gains no invitation rights');
 PERFORM accept_project_viewer(tok); PERFORM accept_project_viewer(tok);
 PERFORM test_assert(can_invite_project_people(test_id(102)),'invited client may invite after accepting');
 PERFORM invite_project_viewer(test_id(102),'6@test.example',NULL,false);
END $$;
-- A secondary observer can read only their own invitation and cannot alter roles.
RESET ROLE;
DO $$ DECLARE tok uuid; BEGIN
 SELECT token INTO tok FROM project_viewers WHERE project_id=test_id(101) AND email='3@test.example';
 PERFORM set_config('test.actor',test_id(3)::text,true); PERFORM accept_project_viewer(tok);
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(3)::text,false);
SELECT test_assert(project_member(test_id(101)) AND NOT can_invite_project_people(test_id(101)),'observer has read membership only');
SELECT test_assert(project_team_access(test_id(101))->>'assigned_contractor'='false','observer account has no work assignment');
SELECT test_assert((SELECT count(*) FROM project_viewers WHERE project_id=test_id(101))=1,'observer sees only own row');
SELECT test_refused($q$SELECT invite_project_viewer(test_id(101),'8@test.example')$q$,'not_permitted');
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'8@test.example')$q$,'not_permitted');
SELECT test_refused($q$SELECT contractor_take_own_client_project(test_id(107))$q$,'not_mine');
SELECT test_refused($q$SELECT project_team_access(test_id(110))$q$,'not_permitted');
SELECT test_refused($q$SELECT set_project_client(id) FROM project_viewers WHERE project_id=test_id(101)$q$,'not_admin');
SELECT revoke_project_viewer(id) FROM project_viewers WHERE project_id=test_id(101);
SELECT test_assert(NOT project_member(test_id(101)),'observer removal takes effect immediately');
-- No direct contractor write policies survive, even for the project creator.
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_refused($q$INSERT INTO contractor_invites(project_id,invited_by,email,status,is_primary,contractor_user_id) VALUES(test_id(110),test_id(1),'forged@test.example','accepted',true,test_id(1))$q$,'new row violates row-level security policy');
DO $$ DECLARE n int; BEGIN
 UPDATE contractor_invites SET is_primary=false WHERE project_id=test_id(101); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'direct update denied');
 DELETE FROM contractor_invites WHERE project_id=test_id(101); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'direct delete denied');
END $$;
SELECT test_refused($q$SELECT set_primary_contractor(id) FROM contractor_invites WHERE project_id=test_id(101)$q$,'not_admin');
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'7@test.example')$q$,'role_change_requires_admin');
SELECT test_refused($q$SELECT revoke_project_viewer(id) FROM project_viewers WHERE project_id=test_id(102) AND is_client$q$,'role_change_requires_admin');
-- Missing user_id on a pending observer must not make a NULL permission pass.
RESET ROLE;
DO $$ DECLARE v uuid; BEGIN
 PERFORM set_config('test.actor',test_id(1)::text,true); PERFORM invite_project_viewer(test_id(101),'8@test.example');
 SELECT id INTO v FROM project_viewers WHERE project_id=test_id(101) AND email='8@test.example';
 PERFORM set_config('test.actor',test_id(7)::text,true);
 PERFORM test_refused(format('SELECT revoke_project_viewer(%L)',v),'not_permitted');
END $$;
-- Legacy pending links gain primary only when accepted by the matching account.
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT accept_contractor_invite(token) FROM contractor_invites WHERE project_id=test_id(105);
SELECT test_assert(is_primary_project_contractor(test_id(105)),'old initial link repaired on acceptance');
SELECT contractor_take_own_client_project(test_id(106));
SELECT contractor_take_own_client_project(test_id(106));
SELECT test_assert((SELECT count(*) FROM contractor_invites WHERE project_id=test_id(106) AND is_primary)=1,'own contractor onboarding idempotent');
SELECT test_refused($q$SELECT contractor_take_own_client_project(test_id(108))$q$,'role_change_requires_admin');
SELECT test_assert(NOT can_invite_project_people(test_id(108)) AND NOT is_project_client(test_id(108)),'creator with secondary contractor assignment cannot assume primary client rights');
-- Staff changes established roles; demotion immediately removes invitation rights.
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(NOT can_invite_project_people(test_id(104)),'secondary assigned contractor cannot invite');
SELECT test_assert(project_team_access(test_id(104))->>'assigned_contractor'='true','staff assigned secondary contractor keeps work access');
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT set_primary_contractor(id) FROM contractor_invites WHERE project_id=test_id(104) AND contractor_user_id=test_id(7);
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(can_invite_project_people(test_id(104)),'staff named primary can invite');
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_assert(NOT can_invite_project_people(test_id(104)),'other accepted contractor stays secondary');
RESET ROLE;
DO $$ DECLARE tok uuid; BEGIN
 SELECT token INTO tok FROM project_viewers WHERE project_id=test_id(102) AND email='6@test.example';
 PERFORM set_config('test.actor',test_id(6)::text,true); PERFORM accept_project_viewer(tok);
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT set_project_client(id) FROM project_viewers WHERE project_id=test_id(102) AND email='6@test.example';
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert(NOT is_project_client(test_id(102)) AND NOT can_invite_project_people(test_id(102)),'former primary client becomes observer');
SELECT set_config('test.actor',test_id(6)::text,false);
SELECT test_assert(is_project_client(test_id(102)) AND can_invite_project_people(test_id(102)),'new primary client has approval and invitation rights');
-- Cancellation and rejected-link reissue do not carry stale email delivery state.
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT invite_project_contractor(test_id(109),'2@test.example');
SELECT test_assert((SELECT email_status='queued' AND email_message_id IS NULL AND email_delivered_at IS NULL AND email_attempts=0 FROM contractor_invites WHERE project_id=test_id(109)),'reissued email state cleared');
SELECT cancel_project_contractor_invite(id) FROM contractor_invites WHERE project_id=test_id(109);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contractor_invites WHERE project_id=test_id(109)),'pending initial invitation cancelled');
SELECT test_refused($q$SELECT cancel_project_contractor_invite(id) FROM contractor_invites WHERE project_id=test_id(101)$q$,'role_change_requires_admin');
-- Role helpers and public RPCs fail closed for anonymous/unverified actors.
SELECT set_config('test.actor','',false);
SELECT test_refused($q$SELECT invite_project_viewer(test_id(101),'8@test.example')$q$,'not_signed_in');
SELECT test_refused($q$SELECT invite_project_contractor(test_id(101),'8@test.example')$q$,'not_signed_in');
RESET ROLE;
DO $$ DECLARE tok uuid; BEGIN
 PERFORM set_config('test.actor',test_id(1)::text,true); tok:=invite_project_viewer(test_id(101),'9@test.example');
 PERFORM set_config('test.actor',test_id(9)::text,true);
 PERFORM test_refused(format('SELECT accept_project_viewer(%L)',tok),'invite_email_mismatch');
 PERFORM test_assert(NOT has_function_privilege('anon','public.invite_project_contractor(uuid,text)','EXECUTE'),'anonymous cannot call invitation writer');
 PERFORM test_assert((SELECT bool_and(budget_amount=141407337.524) FROM projects),'BOQ totals unchanged');
 PERFORM test_assert((SELECT milestone_amount=141407337.524 AND status='complete' AND pre_existing FROM project_stages WHERE id=test_id(501)),'historical allocation unchanged');
 PERFORM test_assert((SELECT milestone_amount=0 FROM project_stages WHERE id=test_id(502)),'zero allocation unchanged');
 PERFORM test_assert((SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN('project_viewers','contractor_invites'))=2,'team realtime tables published');
END $$;
-- The anonymous preview explains the role without exposing financial columns.
SELECT set_config('test.preview',(SELECT token::text FROM project_viewers WHERE project_id=test_id(102) AND is_client),false);
SET ROLE anon;
SELECT test_assert((SELECT is_client AND accepted FROM project_viewer_preview(current_setting('test.preview')::uuid)),'anonymous preview reflects named client role');
SELECT test_assert((SELECT array_agg(k ORDER BY k) FROM project_viewer_preview(current_setting('test.preview')::uuid) p,
 jsonb_object_keys(to_jsonb(p)) k)=ARRAY['accepted','invited_by_name','is_client','project_name'],'preview contains no finance or recipient data');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert(NOT can_edit_project_boq(test_id(101)), 'client creator cannot edit BQ');
SELECT test_refused($q$INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(101),test_id(1))$q$,'new row violates row-level security policy');
DO $$ DECLARE n int; BEGIN
 UPDATE project_takeoffs SET inputs='{"sqm":999}' WHERE project_id=test_id(101); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'old client-authored drafts cannot be changed');
END $$;
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT test_assert(can_edit_project_boq(test_id(101)) AND project_team_access(test_id(101))->>'can_edit_boq'='true','assigned contractor can edit BQ');
INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(101),test_id(2));
UPDATE project_takeoffs SET inputs='{"sqm":150}' WHERE project_id=test_id(101) AND created_by=test_id(2);
SELECT test_assert((SELECT count(*) FROM project_takeoffs WHERE project_id=test_id(101) AND inputs='{"sqm":150}')=1,'contractor saves their BQ');
UPDATE project_takeoffs SET status='submitted' WHERE project_id=test_id(101) AND created_by=test_id(2);
DO $$ DECLARE n int; BEGIN
 UPDATE project_takeoffs SET inputs='{"sqm":999}',status='draft' WHERE project_id=test_id(101) AND created_by=test_id(2); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'submitted BQ figures cannot be rewritten by the author');
 DELETE FROM project_takeoffs WHERE project_id=test_id(101) AND created_by=test_id(2); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'submitted BQ cannot be deleted');
END $$;
INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(101),test_id(2));
SELECT test_refused($q$INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(110),test_id(2))$q$,'new row violates row-level security policy');
SELECT set_config('test.actor',test_id(3)::text,false);
SELECT test_assert(NOT can_edit_project_boq(test_id(101)),'observer cannot edit BQ');
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT test_assert(can_edit_project_boq(test_id(101)),'admin may review BQ');
INSERT INTO project_takeoffs(project_id,created_by) VALUES(test_id(101),test_id(4));
RESET ROLE;
SELECT set_config('test.actor',test_id(4)::text,false);
UPDATE contractor_invites SET status='rejected' WHERE project_id=test_id(101) AND contractor_user_id=test_id(2);
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(2)::text,false);
SELECT test_assert(NOT can_edit_project_boq(test_id(101)),'revoked contractor loses BQ access');
DO $$ DECLARE n int; BEGIN
 UPDATE project_takeoffs SET inputs='{"sqm":999}' WHERE project_id=test_id(101) AND status='draft'; GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'row ownership does not preserve revoked BQ editing rights');
END $$;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert((SELECT budget_amount FROM projects WHERE id=test_id(101))=141407337.524,'BQ draft editing does not change confirmed project budget');
RESET ROLE;

-- An account with a global contractor role accepts only observer membership here.
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT invite_project_viewer(test_id(110),'7@test.example',NULL,false);
DO $$ BEGIN
 PERFORM set_config('test.actor',test_id(7)::text,true);
 PERFORM accept_project_viewer((SELECT token FROM project_viewers WHERE project_id=test_id(110)));
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(project_member(test_id(110)) AND NOT is_project_client(test_id(110)) AND NOT is_contractor_on(test_id(110),test_id(7)),'global contractor remains observer on shared project');
SELECT test_assert((SELECT budget_amount FROM projects WHERE id=test_id(110))=141407337.524,'observer sees canonical exact project budget');
SELECT test_assert((SELECT count(*) FROM project_stages WHERE project_id=test_id(110))=1,'observer sees stages');
SELECT test_assert((SELECT count(*) FROM project_substages WHERE project_id=test_id(110))=1,'observer sees work items');
SELECT test_assert((SELECT count(*) FROM project_documents WHERE project_id=test_id(110))=1,'observer sees documents');
SELECT test_assert((SELECT count(*) FROM project_fees WHERE project_id=test_id(110))=1,'observer sees costing');
SELECT test_assert((SELECT count(*) FROM payments WHERE project_id=test_id(110))=1 AND NOT EXISTS(SELECT 1 FROM payments WHERE project_id=test_id(110) AND direction='out'),'observer sees incoming receipts without exposing outgoing releases');
DO $$ DECLARE n int; BEGIN
 UPDATE project_stages SET milestone_amount=999 WHERE project_id=test_id(110); GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM test_assert(n=0,'read membership grants no stage editing');
END $$;
SELECT set_config('test.actor',test_id(8)::text,false);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects WHERE id=test_id(110)) AND NOT EXISTS(SELECT 1 FROM project_documents WHERE project_id=test_id(110)) AND NOT EXISTS(SELECT 1 FROM payments WHERE project_id=test_id(110)),'unrelated account cannot read shared project');
RESET ROLE;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT revoke_project_viewer((SELECT id FROM project_viewers WHERE project_id=test_id(110)));
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(7)::text,false);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects WHERE id=test_id(110)) AND NOT EXISTS(SELECT 1 FROM project_stages WHERE project_id=test_id(110)) AND NOT EXISTS(SELECT 1 FROM payments WHERE project_id=test_id(110)),'revocation removes read access');
RESET ROLE;
SELECT 'PROJECT_TEAM_OK' AS result;
`;
  const sql = [setup,
    fn('supabase/migrations/112_project_viewers.sql', 'project_member'),
    fn('supabase/migrations/112_project_viewers.sql', 'project_viewer_preview'),
    fn('supabase/migrations/174_the_client_approves_the_stage.sql', 'is_project_client'),
    fn('supabase/migrations/086_verifiers.sql', 'is_contractor_on'),
    fn('supabase/migrations/110_contractor_client_consent.sql', 'is_my_clients_project'),
    fn('supabase/migrations/101_primary_contractor_payout.sql', 'contractor_invites_clear_primary'),
    policies, read('supabase/migrations/20261112000200_project_team_permissions.sql'), read('supabase/migrations/20261112000300_boq_editor_access.sql'), read('supabase/migrations/20261112000400_invitation_project_read_access.sql'), tests, read('supabase/migrations/20261113000200_project_invitation_links.sql'), read('supabase/migrations/20261113000200_project_invitation_links.sql'), read('scripts/fixtures/project-invitation-links.sql'),
    read('supabase/migrations/177_lifecycle_sequences.sql'), read('supabase/migrations/178_activation_journeys.sql'),
    "ALTER TABLE projects ADD COLUMN status text DEFAULT 'active'; ALTER TABLE project_viewers ADD COLUMN email_status text DEFAULT 'sent'; CREATE TABLE contractor_onboarding(user_id uuid,client_intent text);",
    read('supabase/migrations/20261113000600_project_links_no_expiry.sql'), read('supabase/migrations/20261113000600_project_links_no_expiry.sql'), read('scripts/fixtures/non-expiring-links.sql'),
    `ALTER TABLE contractor_onboarding ADD PRIMARY KEY(user_id), ADD COLUMN client_intent_at timestamptz, ADD COLUMN updated_at timestamptz;
     ALTER TABLE profiles ADD COLUMN preferred_lang text;
     INSERT INTO user_roles VALUES(test_id(4),'admin');
     CREATE FUNCTION public.assert_own_onboarding() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
     CREATE FUNCTION public.contractor_onboarding_status(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('client_intent',client_intent,'complete',client_intent IS NOT NULL) FROM public.contractor_onboarding WHERE user_id=p_user $$;
     CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,data jsonb);`,
    read('supabase/migrations/20261113000300_lifecycle_delivery.sql'),read('supabase/migrations/20261113000500_lifecycle_delivery_recovery.sql'),
    read('supabase/migrations/20261113000800_groundwork_communications.sql'),read('supabase/migrations/20261113000900_communication_delivery_and_replies.sql'),
    read('supabase/migrations/20261113001000_activation_invitation_priority.sql'),read('scripts/fixtures/project-team-communications.sql'),
  ].join('\n').replace(/\n[\t ]*\n/g, '\n');
  const sqlPath = join(dir, 'regression.sql');
  writeFileSync(sqlPath, sql);
  // Standalone postgres bypasses RLS even after SET ROLE. A private Unix socket
  // lets these tests exercise actual authenticated policies with no TCP listener.
  const launch = spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-h '' -k ${dir} -p 55439 -c max_connections=10`, '-w', 'start'],
    { encoding: 'utf8', timeout: 30000 });
  if (launch.status !== 0) throw new Error(launch.stderr + launch.stdout + readFileSync(join(dir, 'server.log'), 'utf8'));
  started = true;
  const result = spawnSync(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '55439', '-U', userInfo().username, '-d', 'postgres', '-f', sqlPath],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('PROJECT_TEAM_OK')) {
    const lines = output.split('\n');
    const failures = lines.flatMap((line, i) => /ERROR:|FATAL:/.test(line) ? lines.slice(i, i + 9) : []);
    throw new Error(failures.join('\n') || output);
  }
  const psql = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '55439', '-U', userInfo().username, '-d', 'postgres'];
  const query = sql => new Promise((resolve, reject) => {
    const child = spawn(join(bin, 'psql'), [...psql, '-c', sql]);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
  for (const [project, kind] of [[206, 'viewer'], [207, 'contractor'], [208, 'viewer']]) {
    const accept = kind === 'contractor' ? 'accept_contractor_invite' : 'accept_project_viewer';
    const outcomes = await Promise.all([6, 8].map(actor => query(`BEGIN; SET ROLE authenticated;
      SELECT set_config('test.actor',test_id(${actor})::text,false);
      SELECT ${accept}((SELECT token FROM test_links WHERE project_id=test_id(${project})));
      SELECT test_assert(EXISTS(SELECT 1 FROM projects WHERE id=test_id(${project})),'race winner can read project');
      SELECT pg_sleep(0.15); COMMIT;`)));
    if (outcomes.filter(r => r.code === 0).length !== 1 || !outcomes.some(r => /already_accepted|invite_invalid/.test(r.output))) {
      throw new Error(`Single-use ${kind} claim race failed: ${JSON.stringify(outcomes)}`);
    }
    const table = kind === 'contractor' ? 'contractor_invites' : 'project_viewers';
    const predicate = kind === 'contractor' ? "status='accepted' AND is_primary" : 'accepted_at IS NOT NULL AND revoked_at IS NULL';
    const final = await query(`SELECT test_assert((SELECT count(*) FROM ${table} WHERE project_id=test_id(${project}) AND ${predicate})=1,'exactly one race claimant has membership');`);
    if (final.code !== 0) throw new Error(final.output);
  }
  console.log('Project team database regressions passed: both primary roles, observer restrictions, first-contractor acceptance, legacy repairs, staff role changes, recipient matching, idempotence, cancellation, direct-write RLS BQ editor roles, submitted-quote immutability, revoked access, unchanged BOQ allocations, observer chat identity, non-expiring single-use links, communication-trigger upgrade, legacy expiry upgrade, email/link reservation and concurrent claim races.');
} finally {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 10000 });
  rmSync(dir, { recursive: true, force: true });
}
