// Test the real legacy bootstrap on fresh, repeated and upgraded schemas.
// Everything runs in a disposable local database, without external credentials.
import { existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir,userInfo } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const bin=process.env.GROUNDWORK_PG_BIN??[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`).find(p=>existsSync(join(p,'initdb')));
if(!bin)throw new Error('Set GROUNDWORK_PG_BIN to the directory containing initdb and postgres.');
const migration=readFileSync(join(root,'supabase/migrations/009_admin.sql'),'utf8');
const dir=mkdtempSync(join(tmpdir(),'groundwork-admin-bootstrap-'));
let started=false;
try {
  const init=spawnSync(join(bin,'initdb'),['-D',dir,'-A','trust','--no-locale','--no-sync'],{encoding:'utf8',timeout:30000});
  if(init.status!==0)throw new Error(init.stderr||init.stdout);
  const setup=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA other_schema;
CREATE FUNCTION public.test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES(test_id(1)),(test_id(2)),(test_id(4));
CREATE TABLE public.user_roles(user_id uuid,role text);
INSERT INTO user_roles VALUES(test_id(1),'homeowner'),(test_id(2),'contractor'),(test_id(4),'admin');
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_roles ON user_roles FOR SELECT USING(user_id=auth.uid());
CREATE TABLE other_schema.contractors(id uuid PRIMARY KEY);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projects','project_stages','project_substages','project_messages','project_documents','project_audit_log','contractor_invites','profiles'] LOOP
  EXECUTE format('CREATE TABLE public.%I(id uuid PRIMARY KEY,actor_id uuid)',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
CREATE FUNCTION test_assert(ok boolean,description text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',description; END IF; END $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
`;
  const seeded=`
SELECT test_assert(to_regclass('public.notifications') IS NOT NULL,'fresh bootstrap creates notification storage');
SELECT test_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.notifications'::regclass),'notification RLS enabled');
SELECT test_assert((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.is_admin()'::regprocedure),'fresh admin helper has fixed search path');
SELECT test_assert(to_regclass('public.contractors') IS NULL,'same-named table in another schema does not require a public directory');
INSERT INTO projects(id) VALUES(test_id(10));
INSERT INTO notifications(id,user_id,type,title,body) VALUES(test_id(11),test_id(1),'info','Saved notice','Retain this notification'),(test_id(12),test_id(2),'info','Other user','Other notification');
ALTER POLICY users_own_notifications ON notifications USING(user_id=auth.uid() AND type<>'internal');
CREATE TEMP TABLE saved_policy AS SELECT oid,pg_get_expr(polqual,polrelid) AS predicate FROM pg_policy WHERE polname='users_own_notifications' AND polrelid='public.notifications'::regclass;
-- A partly configured legacy bootstrap can have one missing policy.
DROP POLICY admin_select_all_projects ON projects;
`;
  const replayed=`
SELECT test_assert((SELECT count(*)=1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='admin_select_all_projects'),'missing legacy policy restored once');
SELECT test_assert((SELECT count(*)=2 FROM pg_policies WHERE schemaname='public' AND tablename='notifications'),'replay creates no duplicate notification policy');
SELECT test_assert((SELECT p.oid=s.oid AND pg_get_expr(p.polqual,p.polrelid)=s.predicate FROM pg_policy p CROSS JOIN saved_policy s WHERE p.polname='users_own_notifications' AND p.polrelid='public.notifications'::regclass),'existing policy definition and identity preserved');
SELECT test_assert((SELECT count(*)=2 FROM notifications),'existing notifications preserved');
CREATE TABLE public.contractors(id uuid PRIMARY KEY);
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
`;
  const permissions=`
SELECT test_assert((SELECT count(*)=2 FROM pg_policies WHERE schemaname='public' AND tablename='contractors'),'optional public contractor policies installed once');
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO anon,authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(1)::text,false);
SELECT test_assert(NOT is_admin(),'ordinary member stays non-admin');
SELECT test_assert((SELECT count(*)=1 FROM notifications),'member sees own notifications');
SELECT test_assert((SELECT count(*)=0 FROM projects),'ordinary member gets no admin project read');
DO $$ BEGIN
 BEGIN
  INSERT INTO notifications(user_id,type,title,body) VALUES(test_id(2),'info','Unauthorized','Another user');
  RAISE EXCEPTION 'TEST_FAILED: cross-user notification insert accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('test.actor',test_id(4)::text,false);
SELECT test_assert(is_admin(),'admin role recognized through user_roles RLS');
SELECT test_assert((SELECT count(*)=1 FROM projects),'admin reads project');
INSERT INTO notifications(user_id,type,title,body) VALUES(test_id(2),'info','Admin notice','Authorized');
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.actor','',false);
DO $$ BEGIN
 BEGIN
  INSERT INTO notifications(user_id,type,title,body) VALUES(test_id(2),'info','Anonymous','Unauthorized');
  RAISE EXCEPTION 'TEST_FAILED: anonymous notification insert accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Mirror the later migration's removal of browser audit writes and helper hardening.
DROP POLICY admin_insert_audit_log ON project_audit_log;
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='2s' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin') $$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC,anon;
CREATE TEMP TABLE upgraded_helper AS SELECT pg_get_functiondef(oid) AS definition,proacl FROM pg_proc WHERE oid='public.is_admin()'::regprocedure;
CREATE TEMP TABLE upgraded_policies AS SELECT oid,polname,polrelid,polqual,polwithcheck FROM pg_policy;
`;
  const upgraded=`
SELECT test_assert(NOT EXISTS(SELECT 1 FROM pg_policy WHERE polname='admin_insert_audit_log' AND polrelid='public.project_audit_log'::regclass),'replay does not resurrect deliberately removed browser audit writes');
SELECT test_assert((SELECT pg_get_functiondef(p.oid)=s.definition AND p.proacl IS NOT DISTINCT FROM s.proacl FROM pg_proc p CROSS JOIN upgraded_helper s WHERE p.oid='public.is_admin()'::regprocedure),'newer helper definition and grants survive legacy replay');
SELECT test_assert(NOT EXISTS((SELECT oid,polname,polrelid,polqual::text,polwithcheck::text FROM pg_policy EXCEPT SELECT oid,polname,polrelid,polqual::text,polwithcheck::text FROM upgraded_policies) UNION ALL (SELECT oid,polname,polrelid,polqual::text,polwithcheck::text FROM upgraded_policies EXCEPT SELECT oid,polname,polrelid,polqual::text,polwithcheck::text FROM pg_policy)),'upgraded policies remain unchanged');
SELECT test_assert((SELECT count(*)=3 FROM notifications),'replay on upgraded database preserves notification rows');
SELECT 'ADMIN_BOOTSTRAP_OK';
`;
  const sql=join(dir,'regression.sql');
  writeFileSync(sql,[setup,migration,seeded,migration,migration,replayed,migration,migration,permissions,migration,migration,upgraded].join('\n'));
  const launch=spawnSync(join(bin,'pg_ctl'),['-D',dir,'-l',join(dir,'server.log'),'-o',`-h '' -k ${dir} -p 55439`,'-w','start'],{encoding:'utf8',timeout:30000});
  if(launch.status!==0)throw new Error(launch.stderr||launch.stdout);started=true;
  const result=spawnSync(join(bin,'psql'),['-X','-v','ON_ERROR_STOP=1','-h',dir,'-p','55439','-U',userInfo().username,'-d','postgres','-f',sql],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  if(result.error)throw result.error;
  const output=result.stdout+result.stderr;
  if(result.status!==0||!output.includes('ADMIN_BOOTSTRAP_OK'))throw new Error(output);
  console.log('Admin bootstrap database checks passed: fresh install, existing policy replay, missing legacy policy recovery, optional contractor schema, notification privacy, admin access, preserved data and modern permission hardening.');
} finally {
  if(started)spawnSync(join(bin,'pg_ctl'),['-D',dir,'-m','immediate','-w','stop'],{encoding:'utf8',timeout:10000});
  rmSync(dir,{recursive:true,force:true});
}
