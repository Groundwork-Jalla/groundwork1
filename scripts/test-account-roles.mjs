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
const dir = mkdtempSync(join(tmpdir(), 'groundwork-account-role-test-'));
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
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}');
INSERT INTO auth.users SELECT test_id(n),n||'@test.example',CASE WHEN n=9 THEN NULL ELSE now() END FROM generate_series(1,10) n;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,updated_at timestamptz DEFAULT now());
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
  const extra = `
CREATE TABLE public.project_audit_log(project_id uuid,stage_id uuid,action text,actor_id uuid,details jsonb,entity_type text,entity_id uuid,person_id uuid);
ALTER TABLE user_roles ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE user_roles ADD PRIMARY KEY(id);
INSERT INTO user_roles(user_id,role) VALUES(test_id(4),'admin');
INSERT INTO profiles(id,full_name) SELECT id,'User' FROM auth.users;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin') $$;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_roles ON user_roles FOR SELECT USING(user_id=auth.uid());
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON profiles FOR SELECT USING(id=auth.uid() OR public.is_admin());
`;
  const sql = [setup,
    fn('supabase/migrations/112_project_viewers.sql', 'project_member'),
    fn('supabase/migrations/112_project_viewers.sql', 'project_viewer_preview'),
    fn('supabase/migrations/174_the_client_approves_the_stage.sql', 'is_project_client'),
    fn('supabase/migrations/086_verifiers.sql', 'is_contractor_on'),
    fn('supabase/migrations/110_contractor_client_consent.sql', 'is_my_clients_project'),
    fn('supabase/migrations/101_primary_contractor_payout.sql', 'contractor_invites_clear_primary'),
    policies, read('supabase/migrations/20261112000200_project_team_permissions.sql'), read('supabase/migrations/20261112000300_boq_editor_access.sql'),
    extra, fn('supabase/migrations/089_activity_model.sql','log_activity'), 'REVOKE ALL ON FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;', read('supabase/migrations/20261113000700_admin_user_roles.sql'), read('supabase/migrations/20261113000700_admin_user_roles.sql'), read('scripts/fixtures/account-roles.sql')
  ].join('\n');
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
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('ACCOUNT_ROLES_OK')) {
    const lines = output.split('\n');
    const failures = lines.flatMap((line, i) => /ERROR:|FATAL:/.test(line) ? lines.slice(i, i + 9) : []);
    throw new Error(failures.join('\n') || output);
  }

  const psql = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '55439', '-U', userInfo().username, '-d', 'postgres'];
  const query = sql => new Promise((resolve, reject) => {
    const child = spawn(join(bin, 'psql'), [...psql, '-c', sql]); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  const outcomes = await Promise.all([4, 8].map(actor => query(`BEGIN; SET ROLE authenticated;
    SELECT set_config('test.actor',test_id(${actor})::text,false);
    SELECT admin_set_user_role(test_id(${actor}),'client','admin'); SELECT pg_sleep(0.15); COMMIT;`)));
  if (outcomes.filter(outcome => outcome.code === 0).length !== 1 || !outcomes.some(outcome => /last_admin/.test(outcome.output))) throw new Error(JSON.stringify(outcomes));
  const remaining = await query("SELECT test_assert((SELECT count(*) FROM user_roles WHERE role='admin')=1,'concurrent demotions retain an admin');");
  if (remaining.code !== 0) throw new Error(remaining.output);
  console.log('Account role database regressions passed: all four roles, explicit client dashboard despite assignments, preserved memberships/budgets, metadata cleanup, audit attribution, realtime notifications, stale edits, self-demotion and concurrent last-admin protection.');
} finally {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 10000 });
  rmSync(dir, { recursive: true, force: true });
}
