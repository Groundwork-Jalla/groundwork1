// Executes the actual migration/RPCs in an isolated PostgreSQL backend. No sockets,
// credentials or production connection are used. Requires PostgreSQL server binaries.
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const bin = process.env.GROUNDWORK_PG_BIN
  ?? [18, 17, 16, 15, 14].map(v => `/usr/lib/postgresql/${v}/bin`).find(p => existsSync(join(p, 'initdb')));
if (!bin) throw new Error('Set GROUNDWORK_PG_BIN to the directory containing initdb and postgres.');
const read = path => readFileSync(join(root, path), 'utf8');
const fn = (path, name) => {
  const source = read(path);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const body = source.indexOf('AS $$', start);
  if (start < 0 || body < 0) throw new Error(`Missing function: ${name}`);
  return source.slice(start, source.indexOf('$$;', body + 5) + 3);
};
const dir = mkdtempSync(join(tmpdir(), 'groundwork-boq-test-'));
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'], { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.admin',true),'false')::boolean $$;
CREATE FUNCTION public.is_my_clients_project(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.partner',true),'false')::boolean $$;
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid NOT NULL,budget_usd numeric(14,2),tracking_started_at timestamptz,joined_at_stage integer,current_stage integer,updated_at timestamptz);
CREATE TABLE public.project_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES projects ON DELETE CASCADE,stage_number integer,stage_key text,budget_pct numeric(10,6),fixed_amount_usd numeric,payment_milestone_usd numeric(14,2),status text DEFAULT 'locked',pre_existing boolean DEFAULT false,pre_existing_recorded_at timestamptz,verification_required boolean DEFAULT false,completed_at timestamptz,payment_status text DEFAULT 'unpaid');
CREATE TABLE public.project_substages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stage_id uuid,project_id uuid,status text,approved_by uuid,approved_at timestamptz);
CREATE TABLE public.project_fees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,kind text,amount_usd numeric,payment_status text DEFAULT 'unpaid',UNIQUE(project_id,kind));
CREATE TABLE public.project_documents(project_id uuid,category text,file_name text);
CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,stage_id uuid,direction text,state text DEFAULT 'expected',amount numeric(14,2) CHECK(amount>0),currency text);
CREATE FUNCTION public.project_payment_status(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'unpaid'::text $$;
CREATE FUNCTION public.test_project(p_id uuid,p_owner uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
INSERT INTO projects(id,user_id) VALUES (p_id,p_owner);
INSERT INTO project_stages(project_id,stage_number,stage_key,budget_pct,fixed_amount_usd)
 SELECT p_id,n,CASE n WHEN 2 THEN 'designCompleted' ELSE 'work' END,
 (ARRAY[0,0,2,8,30,8,17,30,0,5])[n],CASE n WHEN 2 THEN 123 ELSE NULL END FROM generate_series(1,10) n;
INSERT INTO project_substages(stage_id,project_id,status) SELECT id,project_id,'locked' FROM project_stages WHERE project_id=p_id;
END $$;
`;
  const tests = `
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_project('00000000-0000-0000-0000-000000000010',auth.uid());
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000010',1414073374.524,'XAF',600,4,'TOTAL GÉNÉRAL TTC','fixture.xlsx');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
IF (SELECT sum(milestone_amount) FROM project_stages WHERE project_id='00000000-0000-0000-0000-000000000010') <> 1414073374.524 THEN RAISE EXCEPTION 'source sum mismatch'; END IF;
IF (SELECT sum(payment_milestone_usd) FROM project_stages WHERE project_id='00000000-0000-0000-0000-000000000010') <> (SELECT budget_usd FROM projects WHERE id='00000000-0000-0000-0000-000000000010') THEN RAISE EXCEPTION 'USD sum mismatch'; END IF;
IF (SELECT count(*) FROM project_stages WHERE pre_existing AND status='complete') <> 3 THEN RAISE EXCEPTION 'history not complete'; END IF;
IF NOT EXISTS (SELECT 1 FROM project_stages WHERE stage_number=3 AND milestone_amount>0 AND pre_existing) THEN RAISE EXCEPTION 'history value erased'; END IF;
IF EXISTS (SELECT 1 FROM project_stages WHERE budget_pct=0 AND (milestone_amount<>0 OR payment_milestone_usd<>0)) THEN RAISE EXCEPTION 'zero stage changed'; END IF;
IF EXISTS (SELECT 1 FROM project_fees WHERE amount_usd<>0) THEN RAISE EXCEPTION 'extra fee'; END IF;
IF EXISTS (SELECT 1 FROM payments pay JOIN project_stages s ON s.id=pay.stage_id WHERE s.pre_existing) THEN RAISE EXCEPTION 'historical funding requested'; END IF;
END $$;
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000010',1414073374.524,'XAF',600,4,'TOTAL GÉNÉRAL TTC','fixture.xlsx');
SET CONSTRAINTS ALL DEFERRED;
SELECT test_project('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002');
SELECT set_config('test.partner','true',false);
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000020',10000.125,'USD',1,1);
SELECT set_config('test.partner','false',false);
SELECT test_project('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000003');
SELECT set_config('test.admin','true',false);
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000030',10000.125,'EUR',0.9245678901234567,5);
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000030',10000.125,'EUR',0.9245678901234567,5);
SELECT set_config('test.admin','false',false);
DO $$ BEGIN
IF (SELECT budget_fx_rate FROM projects WHERE id='00000000-0000-0000-0000-000000000030') <> 0.924567890123 THEN RAISE EXCEPTION 'FX snapshot changed'; END IF;
IF (SELECT budget_amount FROM projects WHERE id='00000000-0000-0000-0000-000000000020') <> 10000.125 THEN RAISE EXCEPTION 'partner changed source total'; END IF;
BEGIN
PERFORM confirm_boq_budget('00000000-0000-0000-0000-000000000020',10000.125,'USD',1,1);
RAISE EXCEPTION 'unauthorized confirmation succeeded';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'not_allowed:%' THEN RAISE; END IF; END;
PERFORM set_config('test.actor','',true);
BEGIN
PERFORM confirm_boq_budget('00000000-0000-0000-0000-000000000010',1414073374.524,'XAF',600,4);
RAISE EXCEPTION 'anonymous confirmation succeeded';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'not_allowed:%' THEN RAISE; END IF; END;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
BEGIN
UPDATE project_stages SET payment_milestone_usd=payment_milestone_usd+1 WHERE project_id='00000000-0000-0000-0000-000000000010' AND stage_number=4;
RAISE EXCEPTION 'inconsistent stage accepted';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'boq_stage_total_mismatch:%' THEN RAISE; END IF; END;
BEGIN
UPDATE project_fees SET amount_usd=1 WHERE project_id='00000000-0000-0000-0000-000000000010';
RAISE EXCEPTION 'fee accepted';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'boq_has_no_platform_fees' THEN RAISE; END IF; END;
END $$;
SELECT 'BOQ_MIGRATION_OK' AS result;
`;
  const invitationSetup = `
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE TABLE public.project_viewers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token uuid,project_id uuid,email text,user_id uuid,accepted_at timestamptz,revoked_at timestamptz);
CREATE TABLE public.contractor_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token uuid,project_id uuid,email text,status text DEFAULT 'pending',contractor_user_id uuid,accepted_at timestamptz);
CREATE TABLE public.user_roles(user_id uuid,role text,UNIQUE(user_id,role));
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001','Client@Example.com',now()),('00000000-0000-0000-0000-000000000002','builder@example.com',now());
INSERT INTO project_viewers(token,project_id,email) VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010','client@example.com');
INSERT INTO contractor_invites(token,project_id,email) VALUES ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000010','BUILDER@EXAMPLE.COM');
`;
  const invitationTests = `
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
BEGIN
PERFORM accept_project_viewer('00000000-0000-0000-0000-000000000101');
RAISE EXCEPTION 'wrong viewer accepted';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'invite_email_mismatch:%' THEN RAISE; END IF; END;
END $$;
SELECT accept_contractor_invite('00000000-0000-0000-0000-000000000102');
SELECT accept_contractor_invite('00000000-0000-0000-0000-000000000102');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT accept_project_viewer('00000000-0000-0000-0000-000000000101');
SELECT accept_project_viewer('00000000-0000-0000-0000-000000000101');
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM project_viewers WHERE user_id=auth.uid() AND accepted_at IS NOT NULL) THEN RAISE EXCEPTION 'client membership missing'; END IF;
IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id='00000000-0000-0000-0000-000000000002' AND role='contractor') THEN RAISE EXCEPTION 'contractor role missing'; END IF;
IF (SELECT budget_amount FROM projects WHERE id='00000000-0000-0000-0000-000000000010') <> 1414073374.524 THEN RAISE EXCEPTION 'invitation changed budget'; END IF;
BEGIN
PERFORM accept_contractor_invite('00000000-0000-0000-0000-000000000102');
RAISE EXCEPTION 'claimed contractor changed account';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'invite_invalid:%' THEN RAISE; END IF; END;
END $$;
SELECT 'INVITATION_MIGRATION_OK' AS result;
`;
  const legacySharedCheck = fn('supabase/migrations/20261111000200_confirmed_boq_budget.sql','check_boq_budget_schedule')
    .replace(/IF TG_TABLE_NAME = 'projects' THEN[\s\S]*?END IF;/,
      "v_id := CASE WHEN TG_TABLE_NAME='projects' THEN CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END ELSE CASE WHEN TG_OP='DELETE' THEN OLD.project_id ELSE NEW.project_id END END;");
  const reproduceCreationFailure = `
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
 BEGIN
  INSERT INTO projects(id,user_id) VALUES('00000000-0000-0000-0000-000000000040',auth.uid());
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'fixture did not reproduce project creation failure';
 EXCEPTION WHEN undefined_column THEN
  IF SQLERRM NOT LIKE 'record "old" has no field "project_id"%' THEN RAISE; END IF;
 END;
END $$;
`;
  const creationRepairChecks = `
SELECT test_project('00000000-0000-0000-0000-000000000040',auth.uid());
SELECT confirm_boq_budget('00000000-0000-0000-0000-000000000040',141407337.524,'XAF',600,1,'QA confirmed bill','fixture.xlsx');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 IF (SELECT sum(milestone_amount) FROM project_stages WHERE project_id='00000000-0000-0000-0000-000000000040')<>141407337.524 THEN RAISE EXCEPTION 'repair changed BOQ amount'; END IF;
 BEGIN
  UPDATE project_stages SET payment_milestone_usd=payment_milestone_usd+1 WHERE project_id='00000000-0000-0000-0000-000000000040' AND stage_number=4;
  RAISE EXCEPTION 'repair disabled budget reconciliation';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'boq_stage_total_mismatch%' THEN RAISE; END IF; END;
 BEGIN
  UPDATE project_fees SET amount_usd=1 WHERE project_id='00000000-0000-0000-0000-000000000040';
  RAISE EXCEPTION 'repair allowed additional BOQ fee';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'boq_has_no_platform_fees' THEN RAISE; END IF; END;
END $$;
SELECT 'PROJECT_CREATION_REPAIR_OK' AS result;
`;
  const sql = [setup,
    fn('supabase/migrations/090_payments_ledger.sql', 'stages_seed_expected_funding'),
    `CREATE TRIGGER stages_seed_expected_funding AFTER INSERT OR UPDATE OF payment_milestone_usd
       ON public.project_stages FOR EACH ROW EXECUTE FUNCTION public.stages_seed_expected_funding();
     DO $$ BEGIN
       BEGIN
         ALTER TABLE public.project_stages ALTER COLUMN payment_milestone_usd TYPE numeric(24,9);
         RAISE EXCEPTION 'fixture must reproduce the existing trigger dependency';
       EXCEPTION WHEN feature_not_supported THEN NULL;
       END;
     END $$;`,
    fn('supabase/migrations/20261110000000_stages_sum_to_construction.sql', 'apply_budget_milestones'),
    fn('supabase/migrations/20261111000000_a_bill_is_the_whole_project.sql', 'admin_start_project_at_stage'),
    read('supabase/migrations/20261111000200_confirmed_boq_budget.sql'), tests,
    invitationSetup, read('supabase/migrations/20261111000300_invitation_acceptance.sql'), invitationTests,
    legacySharedCheck,reproduceCreationFailure,read('supabase/migrations/20261113001200_project_creation_trigger_records.sql'),
    read('supabase/migrations/20261113001200_project_creation_trigger_records.sql'),creationRepairChecks,
  ].join('\n').replace(/\n[\t ]*\n/g, '\n');
  const sqlPath = join(dir, 'regression.sql');
  writeFileSync(sqlPath, sql);
  const input = openSync(sqlPath, 'r');
  let result;
  try {
    result = spawnSync(join(bin, 'postgres'), ['--single', '-D', dir, '-j', 'postgres'], {
      stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000,
    });
  } finally { closeSync(input); }
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output)
      || !output.includes('BOQ_MIGRATION_OK') || !output.includes('INVITATION_MIGRATION_OK')
      || !output.includes('PROJECT_CREATION_REPAIR_OK')) {
    throw new Error(output);
  }
  console.log('Database regressions passed: exact BoQ allocation, zero stages/fees, historical values, no historical funding, owner/partner/admin access, fixed FX, retries, mutation guards, client/contractor invitation acceptance and the reproduced project-creation trigger failure repaired without removing budget checks.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
