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
const dir = mkdtempSync(join(tmpdir(), 'groundwork-lifecycle-test-'));
let started = false;
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'], { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
CREATE FUNCTION public.test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()=public.test_id(4),false) $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
INSERT INTO auth.users SELECT test_id(n),n||'@test.example' FROM generate_series(1,8) n;
CREATE TABLE public.user_roles(user_id uuid,role text);
INSERT INTO user_roles VALUES(test_id(2),'contractor'),(test_id(6),'contractor');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,preferred_lang text);
INSERT INTO profiles SELECT test_id(n),'User '||n,'en' FROM generate_series(1,8) n;
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid,status text DEFAULT 'active');
INSERT INTO projects(id,user_id) VALUES(test_id(100),test_id(1)),(test_id(101),test_id(2));
CREATE TABLE public.contractor_onboarding(user_id uuid PRIMARY KEY,client_intent text);
CREATE TABLE public.contractor_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token uuid UNIQUE DEFAULT gen_random_uuid(),
 project_id uuid,invited_by uuid,email text,status text DEFAULT 'pending',contractor_user_id uuid,is_primary boolean DEFAULT false,
 email_status text DEFAULT 'sent',is_share_link boolean DEFAULT false,expires_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE public.project_viewers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token uuid UNIQUE DEFAULT gen_random_uuid(),
 project_id uuid,invited_by uuid,email text,user_id uuid,is_client boolean DEFAULT false,accepted_at timestamptz,revoked_at timestamptz,
 email_status text DEFAULT 'sent',is_share_link boolean DEFAULT false,expires_at timestamptz,invited_at timestamptz DEFAULT now());
CREATE FUNCTION public.test_assert(ok boolean,description text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',description; END IF; END $$;
CREATE FUNCTION public.test_refused(statement text,prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; RAISE EXCEPTION 'TEST_EXPECTED_REFUSAL: %',prefix;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE prefix||'%' THEN RAISE; END IF; END;
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
`;
  const sql = [setup, read('supabase/migrations/177_lifecycle_sequences.sql'), read('supabase/migrations/178_activation_journeys.sql'), read('supabase/migrations/20261113000300_lifecycle_delivery.sql'), read('supabase/migrations/20261113000300_lifecycle_delivery.sql'), read('supabase/migrations/20261113000400_lifecycle_language_copy.sql'), `
INSERT INTO lifecycle_sequences(key,name,trigger_event) VALUES('legacy_recovery','Existing journey','test');
INSERT INTO lifecycle_enrollments(id,sequence_key,email) VALUES(test_id(900),'legacy_recovery','existing@test.example');
INSERT INTO lifecycle_deliveries(enrollment_id,position,payload) VALUES(test_id(900),1,'{"text":"Existing snapshot"}');
ALTER TABLE lifecycle_deliveries DROP COLUMN worker_token;
`, read('supabase/migrations/20261113000500_lifecycle_delivery_recovery.sql'), read('supabase/migrations/20261113000500_lifecycle_delivery_recovery.sql'), "UPDATE lifecycle_sequence_steps SET subject_en='Staff English',subject_fr='Français personnalisé' WHERE code='CS01';", read('supabase/migrations/20261113000400_lifecycle_language_copy.sql'), 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;', read('scripts/fixtures/lifecycle-delivery.sql'), `
ALTER TABLE contractor_onboarding ADD COLUMN client_intent_at timestamptz, ADD COLUMN updated_at timestamptz;
CREATE FUNCTION public.assert_own_onboarding() RETURNS uuid LANGUAGE plpgsql STABLE AS $$ BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='contractor') THEN RAISE EXCEPTION 'not_contractor'; END IF; RETURN auth.uid(); END $$;
CREATE FUNCTION public.contractor_onboarding_status(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('client_intent',client_intent,'complete',true) FROM public.contractor_onboarding WHERE user_id=p_user $$;
INSERT INTO user_roles VALUES(test_id(4),'admin');
ALTER TABLE projects ADD COLUMN name text DEFAULT 'Test project';
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,data jsonb);
`, read('supabase/migrations/20261113000800_groundwork_communications.sql'),read('supabase/migrations/20261113000900_communication_delivery_and_replies.sql'),
read('supabase/migrations/20261113000800_groundwork_communications.sql'),read('supabase/migrations/20261113000900_communication_delivery_and_replies.sql'),
read('supabase/migrations/20261113001000_activation_invitation_priority.sql'),read('supabase/migrations/20261113001000_activation_invitation_priority.sql'),
read('scripts/fixtures/groundwork-communications.sql'),
read('scripts/fixtures/communication-upgrade-setup.sql'),read('supabase/migrations/20261113001100_communication_schema_repair.sql'),
read('supabase/migrations/20261113001100_communication_schema_repair.sql'),read('scripts/fixtures/communication-upgrade-checks.sql'),
read('scripts/fixtures/communication-tracking-setup.sql'),read('supabase/migrations/20261113001300_communication_tracking.sql'),
read('supabase/migrations/20261113001300_communication_tracking.sql'),read('scripts/fixtures/communication-tracking.sql')].join('\n');
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
  if (result.error) throw result.error;
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('LIFECYCLE_DELIVERY_OK') || !output.includes('GROUNDWORK_COMMUNICATIONS_OK') || !output.includes('COMMUNICATION_UPGRADE_OK') || !output.includes('COMMUNICATION_TRACKING_OK')) {
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
  const claims = await Promise.all([1, 2].map(() => query(`BEGIN; SET ROLE service_role;
    SELECT coalesce((claim_lifecycle_enrollment(test_id(290))->>'processing_token') IS NOT NULL,false) AS claimed;
    SELECT pg_sleep(0.15); COMMIT;`)));
  if (claims.some(result => result.code !== 0) || claims.filter(result => /\n t\s*\n/.test(result.output)).length !== 1) {
    throw new Error('Concurrent delivery claim regression: '+JSON.stringify(claims));
  }
  console.log('Lifecycle delivery database regressions passed: migration replay, service-only access, single-worker claims, immutable retry payloads, stale leases, atomic send history, entry-based deadlines, authoritative action checks, preferences, invitation priority, verified replies, staff contact history, role changes, early callbacks, uncertain-send review, Day-7 qualification and per-project follow-ups.');
} finally {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 10000 });
  rmSync(dir, { recursive: true, force: true });
}
