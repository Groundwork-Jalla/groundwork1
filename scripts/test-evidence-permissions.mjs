// Real migration/RPC regressions through a private local PostgreSQL Unix socket.
// No TCP listener, production credentials or external service is used.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
const dir = mkdtempSync(join(tmpdir(), 'groundwork-evidence-test-'));
let started = false;
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'],
    { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='00000000-0000-0000-0000-000000000004'::uuid,false) $$;
CREATE FUNCTION public.is_project_client(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='00000000-0000-0000-0000-000000000001'::uuid,false) $$;
CREATE FUNCTION public.is_contractor_on(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce($2='00000000-0000-0000-0000-000000000002'::uuid,false) $$;
CREATE TABLE public.test_activity(project_id uuid,event text,details jsonb);
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO test_activity VALUES($1,$2,$6) $$;
CREATE TABLE storage.objects(bucket_id text,name text,id uuid DEFAULT gen_random_uuid(),version text DEFAULT 'v1',metadata jsonb DEFAULT '{}',UNIQUE(bucket_id,name));
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid,country text,tier text DEFAULT 'jalla_verify',budget_source text,budget_currency text,budget_fx_rate numeric(24,12),budget_amount numeric(24,6),budget_usd numeric(24,9),current_stage integer,status text DEFAULT 'active');
CREATE TABLE public.project_stages(id uuid PRIMARY KEY,project_id uuid REFERENCES projects,stage_number integer,status text DEFAULT 'locked',payment_milestone_usd numeric(24,9),milestone_amount numeric(24,6),payment_status text DEFAULT 'unpaid',pre_existing boolean DEFAULT false,completed_at timestamptz);
CREATE TABLE public.project_substages(id uuid PRIMARY KEY,stage_id uuid,status text,evidence_urls jsonb DEFAULT '[]',approved_by uuid,approved_at timestamptz);
CREATE TABLE public.contractor_invites(project_id uuid,status text,contractor_user_id uuid,invited_by uuid);
CREATE TABLE public.user_roles(user_id uuid,role text);
INSERT INTO user_roles VALUES('00000000-0000-0000-0000-000000000002','contractor');
CREATE FUNCTION public.project_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.is_admin() OR auth.uid() IN('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid) $$;
CREATE TABLE public.site_updates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,stage_id uuid,substage_id uuid,submitted_by uuid,submitted_at timestamptz DEFAULT now(),description text,evidence_paths jsonb DEFAULT '[]',location jsonb,client_ref uuid);
CREATE UNIQUE INDEX site_updates_client_ref_key ON site_updates(client_ref) WHERE client_ref IS NOT NULL;
ALTER TABLE public.project_substages ADD COLUMN project_id uuid;
ALTER TABLE public.contractor_invites ADD COLUMN is_primary boolean DEFAULT false;
CREATE TABLE public.project_viewers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,user_id uuid,is_client boolean DEFAULT false,accepted_at timestamptz,revoked_at timestamptz);
CREATE TABLE public.project_verifiers(project_id uuid,user_id uuid,status text);
CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,stage_id uuid,direction text,state text,amount numeric(14,2) CHECK(amount>0),currency text DEFAULT 'USD',receipt_path text,receipt_uploaded_by uuid,receipt_uploaded_at timestamptz,funding_source text,confirmed_by uuid,confirmed_at timestamptz,authorised_by uuid,authorised_at timestamptz,note text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
CONSTRAINT payments_state_by_direction CHECK((direction='in' AND state IN('expected','receipt_submitted','funded','reconciled')) OR (direction='out' AND state IN('release_authorised','initiated','disbursed','failed','reconciling'))),
CONSTRAINT payments_receipt_has_proof CHECK(state<>'receipt_submitted' OR (receipt_path IS NOT NULL AND receipt_uploaded_by IS NOT NULL AND receipt_uploaded_at IS NOT NULL)));
CREATE UNIQUE INDEX payments_one_tranche_per_stage ON payments(stage_id) WHERE direction='in';
CREATE FUNCTION public.test_id(p_project int,p_stage int DEFAULT 0) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(($1*100+$2)::text,12,'0'))::uuid $$;
CREATE FUNCTION public.test_sub(p_project int,p_stage int,p_sub int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(($1*10000+$2*10+$3)::text,12,'0'))::uuid $$;
CREATE FUNCTION public.test_refused(p_sql text,p_prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE p_sql; SET CONSTRAINTS ALL IMMEDIATE; RAISE EXCEPTION 'TEST_EXPECTED_REFUSAL: %',p_prefix;
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE p_prefix || '%' THEN RAISE; END IF; END;
END $$;
`;
  const triggers = `
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION public.payments_guard();
CREATE TRIGGER payments_project_payment_status AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION public.payments_project_payment_status();
CREATE TRIGGER stages_guard_payment_status BEFORE UPDATE OF payment_status ON project_stages FOR EACH ROW EXECUTE FUNCTION public.stages_guard_payment_status();
CREATE TRIGGER stages_guard_completion BEFORE UPDATE OF status ON project_stages FOR EACH ROW EXECUTE FUNCTION public.stages_guard_completion();
`;
  const sql = [setup,
    read('scripts/fixtures/stage-approval-schema-before.sql'),
    fn('supabase/migrations/086_verifiers.sql', 'is_contractor_on'),
    fn('supabase/migrations/20261112000200_project_team_permissions.sql', 'is_primary_project_contractor'),
    fn('supabase/migrations/20261112000200_project_team_permissions.sql', 'is_project_client'),
    fn('supabase/migrations/112_project_viewers.sql', 'project_member'),
    fn('supabase/migrations/092_storage_member_read.sql', 'try_uuid'),
    fn('supabase/migrations/088_site_updates.sql', 'jsonb_is_string_array'),
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_guard'),
    fn('supabase/migrations/090_payments_ledger.sql', 'project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'stages_guard_payment_status'),
    fn('supabase/migrations/103_join_project_in_progress.sql', 'stages_guard_completion'),
    fn('supabase/migrations/174_the_client_approves_the_stage.sql', 'stage_has_evidence'),
    fn('supabase/migrations/175_receipt_then_contractor_confirms.sql', 'stage_funding_settled'),
    fn('supabase/migrations/132_paid_opens_the_stage.sql', 'open_stage_if_settled'), triggers,
    read('supabase/migrations/20261112000000_receipt_payment_amounts.sql'),
    read('supabase/migrations/20261112000100_ordered_stage_progression.sql'), read('supabase/migrations/20261112000500_review_payment_workflow.sql'),
    read('supabase/migrations/20261112000600_receipt_amount_reading.sql'),
    read('supabase/migrations/20261112000700_reviewed_first_stage_payment.sql'),
    read('supabase/migrations/20261112000800_contractor_stage_evidence.sql'),
    read('scripts/fixtures/stage-approval-schema-reproduce.sql'),
    read('supabase/migrations/20261112000900_stage_approval_metadata.sql'),
    read('scripts/fixtures/stage-approval-schema-after.sql'),
    read('scripts/fixtures/contractor-stage-evidence.sql'),
    `CREATE TEMP TABLE stage_approval_rerun_snapshot AS SELECT id,to_jsonb(s) AS saved FROM public.project_stages s;`,
    read('supabase/migrations/20261112000900_stage_approval_metadata.sql'),
    read('scripts/fixtures/stage-approval-schema-final.sql'),
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
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('CONTRACTOR_EVIDENCE_OK')) {
    const lines = output.split('\n');
    const failures = lines.flatMap((line, i) => /ERROR:|FATAL:/.test(line) ? lines.slice(i, i + 9) : []);
    throw new Error(failures.join('\n') || output);
  }
  console.log('Stage evidence database regressions passed: contractor-only RPC/index/storage writes, client reviews and receipts, read access, creator and account-role differences, revoked/pending/observer/verifier roles, approved-proof protection, retries and existing stage/payment gates., legacy stage-schema repair, approval metadata guards and idempotent schema upgrades');
} finally {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8', timeout: 10000 });
  rmSync(dir, { recursive: true, force: true });
}
