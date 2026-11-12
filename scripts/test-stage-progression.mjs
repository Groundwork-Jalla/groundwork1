// Real migration/RPC regression in an isolated single-user PostgreSQL backend.
// No listener, production credentials or external service is used.
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const dir = mkdtempSync(join(tmpdir(), 'groundwork-stages-test-'));
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'],
    { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='00000000-0000-0000-0000-000000000004'::uuid,false) $$;
CREATE FUNCTION public.is_project_client(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='00000000-0000-0000-0000-000000000001'::uuid,false) $$;
CREATE FUNCTION public.is_contractor_on(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce($2='00000000-0000-0000-0000-000000000002'::uuid,false) $$;
CREATE TABLE public.test_activity(project_id uuid,event text,details jsonb);
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO test_activity VALUES($1,$2,$6) $$;
CREATE TABLE storage.objects(bucket_id text,name text,UNIQUE(bucket_id,name));
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid,country text,tier text DEFAULT 'jalla_verify',budget_source text,budget_currency text,budget_fx_rate numeric(24,12),budget_amount numeric(24,6),budget_usd numeric(24,9),current_stage integer,status text DEFAULT 'active');
CREATE TABLE public.project_stages(id uuid PRIMARY KEY,project_id uuid REFERENCES projects,stage_number integer,status text DEFAULT 'locked',payment_milestone_usd numeric(24,9),milestone_amount numeric(24,6),payment_status text DEFAULT 'unpaid',pre_existing boolean DEFAULT false,completed_at timestamptz);
CREATE TABLE public.project_substages(id uuid PRIMARY KEY,stage_id uuid,status text,evidence_urls jsonb DEFAULT '[]',approved_by uuid,approved_at timestamptz);
CREATE TABLE public.contractor_invites(project_id uuid,status text);
CREATE TABLE public.site_updates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stage_id uuid,description text);
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
  const tests = `
CREATE FUNCTION public.test_start(p_number int,p_count int,p_start int DEFAULT 1,p_costs numeric[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE n int; c numeric; BEGIN
 INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,current_stage)
 VALUES(test_id(p_number),'00000000-0000-0000-0000-000000000001','US','boq','USD',1,p_count*100,p_count*100,p_start);
 FOR n IN 1..p_count LOOP
   c:=coalesce(p_costs[n],CASE WHEN n=1 THEN 0 ELSE 100 END);
   INSERT INTO project_stages(id,project_id,stage_number,status,payment_milestone_usd,milestone_amount,payment_status,pre_existing)
   VALUES(test_id(p_number,n),test_id(p_number),n,CASE WHEN n<p_start THEN 'complete' WHEN n=p_start THEN 'active' ELSE 'locked' END,c,c,CASE WHEN round(c,2)<=0 OR n<p_start THEN 'paid' ELSE 'unpaid' END,n<p_start);
   INSERT INTO project_substages(id,stage_id,status,evidence_urls) SELECT test_sub(p_number,n,k),test_id(p_number,n),CASE WHEN n<p_start THEN 'complete' WHEN n=p_start THEN 'pending' ELSE 'locked' END,'["proof.jpg"]'::jsonb FROM generate_series(1,2) k;
   IF round(c,2)>0 AND n>=p_start THEN INSERT INTO payments(project_id,stage_id,direction,state,amount) VALUES(test_id(p_number),test_id(p_number,n),'in','expected',round(c,2)); END IF;
 END LOOP;
 INSERT INTO contractor_invites VALUES(test_id(p_number),'accepted');
 INSERT INTO storage.objects VALUES('evidence',test_id(p_number)::text||'/receipts/proof.pdf');
END $$;
CREATE FUNCTION public.test_submit(p_number int,p_stage int,p_amount numeric DEFAULT 100) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
 PERFORM submit_stage_payment_receipt(test_id(p_number,p_stage),test_id(p_number)::text||'/receipts/proof.pdf',p_amount,'USD',1);
END $$;
CREATE FUNCTION public.test_confirm(p_number int,p_stage int) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE p payments%ROWTYPE; BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000002',true);
 SELECT * INTO p FROM payments WHERE stage_id=test_id(p_number,p_stage) AND direction='in';
 RETURN confirm_stage_payment(p.stage_id,NULL,p.receipt_path,p.receipt_uploaded_at);
END $$;
CREATE FUNCTION public.test_finish(p_number int,p_stage int) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000001',true);
 PERFORM approve_substage(test_sub(p_number,p_stage,1));
 r:=approve_substage(test_sub(p_number,p_stage,2));
 RETURN r->'stage_approval';
END $$;
SELECT test_start(10,10,1,ARRAY[0,100,0,100,100,100,100,100,100,100]::numeric[]);
-- Prepayment is real money, but cannot start stage four before earlier work.
SELECT test_submit(10,4,120);
DO $$ DECLARE r jsonb; BEGIN
 r:=test_confirm(10,4);
 IF r->>'opened'<>'false' OR (SELECT status FROM project_stages WHERE id=test_id(10,4))<>'locked' THEN RAISE EXCEPTION 'future prepayment opened work'; END IF;
 IF (SELECT current_stage FROM projects WHERE id=test_id(10))<>1 THEN RAISE EXCEPTION 'future prepayment moved current stage'; END IF;
END $$;
-- Client and admin are separate from contractor/observer approval rights.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(10,1,1))$q$,'not_authorized:');
SELECT test_refused($q$SELECT approve_stage(test_id(10,1))$q$,'not_authorized:');
SELECT set_config('test.actor','',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(10,1,1))$q$,'not_signed_in');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$UPDATE project_substages SET status='complete' WHERE id=test_sub(10,1,1)$q$,'approve_substage_via_rpc:');
-- Evidence must belong to the very update being reviewed.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
UPDATE project_substages SET evidence_urls='[]' WHERE id=test_sub(10,1,1);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(10,1,1))$q$,'no_evidence:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
UPDATE project_substages SET evidence_urls='["proof.jpg"]' WHERE id=test_sub(10,1,1);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE r jsonb; BEGIN
 r:=approve_substage(test_sub(10,1,1));
 IF r->'stage_approval'<>'null'::jsonb OR (SELECT status FROM project_stages WHERE id=test_id(10,1))<>'active' THEN RAISE EXCEPTION 'nonfinal update advanced stage'; END IF;
 r:=approve_substage(test_sub(10,1,2));
 IF r->'stage_approval'->>'next_stage_id'<>test_id(10,2)::text OR r->'stage_approval'->>'awaiting_payment'<>'true' THEN RAISE EXCEPTION 'final update lost exact payment target'; END IF;
 IF (SELECT status FROM project_stages WHERE id=test_id(10,2))<>'locked' THEN RAISE EXCEPTION 'unpaid successor opened'; END IF;
 r:=approve_substage(test_sub(10,1,2));
 IF r->'stage_approval'->>'already_approved'<>'true' THEN RAISE EXCEPTION 'approval retry not idempotent'; END IF;
 IF (SELECT count(*) FROM test_activity WHERE event='stage.approved')<>1 THEN RAISE EXCEPTION 'approval retry duplicated audit'; END IF;
END $$;
-- Deferrable direct-write checks catch future activation and two-step reopening.
SELECT test_refused($q$UPDATE project_stages SET status='active' WHERE id=test_id(10,4)$q$,'stage_out_of_order:');
SELECT test_refused($q$UPDATE project_stages SET status='locked' WHERE id=test_id(10,1)$q$,'stage_complete:');
SELECT test_submit(10,2,80);
SELECT test_confirm(10,2);
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(10,2);
 IF r->>'next_stage_id'<>test_id(10,3)::text OR r->>'awaiting_payment'<>'false' THEN RAISE EXCEPTION 'zero-cost successor not selected'; END IF;
 IF (SELECT status FROM project_stages WHERE id=test_id(10,3))<>'active' THEN RAISE EXCEPTION 'zero-cost stage stayed locked'; END IF;
 IF EXISTS(SELECT 1 FROM payments WHERE stage_id=test_id(10,3)) THEN RAISE EXCEPTION 'zero-cost stage billed'; END IF;
 r:=test_finish(10,3);
 IF r->>'next_stage_id'<>test_id(10,4)::text OR (SELECT status FROM project_stages WHERE id=test_id(10,4))<>'active' THEN RAISE EXCEPTION 'prepaid successor did not open after prior approval'; END IF;
 IF (SELECT count(*) FROM payments WHERE stage_id=test_id(10,4))<>1 THEN RAISE EXCEPTION 'prepayment billed twice'; END IF;
END $$;
DO $$ DECLARE n int; r jsonb; BEGIN
 FOR n IN 4..10 LOOP
  IF n>4 THEN PERFORM test_submit(10,n,100); PERFORM test_confirm(10,n); END IF;
  r:=test_finish(10,n);
 END LOOP;
 IF r->>'is_final'<>'true' OR r->'next_stage_id'<>'null'::jsonb OR r->'next_stage_number'<>'null'::jsonb THEN RAISE EXCEPTION 'final approval invented next stage'; END IF;
 IF (SELECT status FROM projects WHERE id=test_id(10))<>'completed' OR (SELECT count(*) FROM project_stages WHERE project_id=test_id(10) AND status='complete')<>10 THEN RAISE EXCEPTION 'whole project did not complete'; END IF;
 r:=approve_stage(test_id(10,10));
 IF r->>'already_approved'<>'true' OR r->>'is_final'<>'true' THEN RAISE EXCEPTION 'final retry changed outcome'; END IF;
 IF (SELECT count(*) FROM test_activity WHERE project_id=test_id(10) AND event='stage.approved')<>10 THEN RAISE EXCEPTION 'project approvals duplicated'; END IF;
END $$;
-- Initial active stages may be unpaid, but neither work nor approval may proceed.
SELECT test_start(20,3,1,ARRAY[100,100,100]::numeric[]);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(20,1,1))$q$,'not_paid:');
SELECT test_refused($q$UPDATE project_substages SET evidence_urls='["new.jpg"]' WHERE id=test_sub(20,1,1)$q$,'not_paid:');
SELECT test_refused($q$UPDATE project_substages SET status='pending_review' WHERE id=test_sub(20,1,1)$q$,'not_paid:');
SELECT test_refused($q$INSERT INTO site_updates(stage_id,description) VALUES(test_id(20,1),'work started')$q$,'not_paid:');
SELECT test_submit(20,1,100);
SELECT test_confirm(20,1);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
UPDATE project_substages SET evidence_urls='["new.jpg"]' WHERE id=test_sub(20,1,1);
INSERT INTO site_updates(stage_id,description) VALUES(test_id(20,1),'work started');
-- Hold is not lifted by a legitimate payment acknowledgment.
SELECT test_start(30,3);
UPDATE projects SET status='on_hold' WHERE id=test_id(30);
SELECT test_submit(30,2,100);
DO $$ BEGIN
 PERFORM test_confirm(30,2);
 IF (SELECT status FROM project_stages WHERE id=test_id(30,2))<>'locked' OR (SELECT status FROM projects WHERE id=test_id(30))<>'on_hold' THEN RAISE EXCEPTION 'payment resumed held project'; END IF;
END $$;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT approve_stage(test_id(30,1))$q$,'project_paused:');
SELECT test_refused($q$SELECT approve_substage(test_sub(30,1,1))$q$,'project_paused:');
-- Both legacy admin funding paths respect order too.
SELECT test_start(40,3);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT mark_stage_paid(test_id(40,2));
SELECT confirm_funding(id) FROM payments WHERE stage_id=test_id(40,3);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM project_stages WHERE project_id=test_id(40) AND stage_number>1 AND status<>'locked') THEN RAISE EXCEPTION 'admin prepayment bypassed order'; END IF;
END $$;
-- Mid-build history keeps its source value and never acquires funding requests.
SELECT test_start(50,6,4,ARRAY[10,20,30,0,100,0]::numeric[]);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(50,1,1))$q$,'historical_stage:');
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(50,4);
 IF r->>'next_stage_number'<>'5' OR r->>'awaiting_payment'<>'true' THEN RAISE EXCEPTION 'mid-build successor wrong'; END IF;
 IF (SELECT sum(milestone_amount) FROM project_stages WHERE project_id=test_id(50) AND pre_existing)<>60 THEN RAISE EXCEPTION 'historical value changed'; END IF;
 IF EXISTS(SELECT 1 FROM payments p JOIN project_stages s ON s.id=p.stage_id WHERE s.project_id=test_id(50) AND s.pre_existing) THEN RAISE EXCEPTION 'historical funding requested'; END IF;
END $$;
-- A sub-cent USD allocation follows the existing no-tranche policy without
-- changing the source allocation or skipping its work approval.
SELECT test_start(60,2,1,ARRAY[0,0.004]::numeric[]);
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(60,1);
 IF r->>'awaiting_payment'<>'false' OR (SELECT status FROM project_stages WHERE id=test_id(60,2))<>'active' THEN RAISE EXCEPTION 'sub-cent stage stranded'; END IF;
 IF (SELECT milestone_amount FROM project_stages WHERE id=test_id(60,2))<>0.004 OR EXISTS(SELECT 1 FROM payments WHERE stage_id=test_id(60,2)) THEN RAISE EXCEPTION 'sub-cent allocation changed'; END IF;
END $$;
-- Finality/next target follows actual stored stage numbers rather than hardcoded10.
-- Initial free/sub-cent stages can have an older unpaid projection despite no
-- money being owed; the ledger rule must permit work and synchronize approval.
SELECT test_start(80,2,1,ARRAY[0.004,100]::numeric[]);
SELECT set_config('app.payments_projection','on',true);
UPDATE project_stages SET payment_status='unpaid' WHERE id=test_id(80,1);
SELECT set_config('app.payments_projection','off',true);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
INSERT INTO site_updates(stage_id,description) VALUES(test_id(80,1),'free stage work');
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(80,1);
 IF r->>'awaiting_payment'<>'true' OR (SELECT payment_status FROM project_stages WHERE id=test_id(80,1))<>'paid' THEN RAISE EXCEPTION 'free initial stage blocked by legacy unpaid flag'; END IF;
 IF (SELECT milestone_amount FROM project_stages WHERE id=test_id(80,1))<>0.004 THEN RAISE EXCEPTION 'free initial allocation changed'; END IF;
END $$;
-- Confirmed funding is authoritative even if an old projection was partial.
SELECT test_start(90,2,1,ARRAY[100,100]::numeric[]);
SELECT test_submit(90,1,95);
SELECT test_confirm(90,1);
SELECT set_config('app.payments_projection','on',true);
UPDATE project_stages SET payment_status='partial' WHERE id=test_id(90,1);
SELECT set_config('app.payments_projection','off',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(90,1);
 IF r->>'next_stage_number'<>'2' OR (SELECT payment_status FROM project_stages WHERE id=test_id(90,1))<>'paid' THEN RAISE EXCEPTION 'confirmed funding blocked by legacy projection'; END IF;
END $$;
-- A legacy paid flag without an incoming row is not evidence of actual funding.
SELECT test_start(100,2,1,ARRAY[100,100]::numeric[]);
DELETE FROM payments WHERE stage_id=test_id(100,1);
SELECT set_config('app.payments_projection','on',true);
UPDATE project_stages SET payment_status='paid' WHERE id=test_id(100,1);
SELECT set_config('app.payments_projection','off',true);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT approve_substage(test_sub(100,1,1))$q$,'not_paid:');
SELECT test_refused($q$INSERT INTO site_updates(stage_id,description) VALUES(test_id(100,1),'unfunded work')$q$,'not_paid:');
SELECT test_start(110,2);
UPDATE project_stages SET payment_milestone_usd=NULL WHERE id=test_id(110,1);
SELECT test_refused($q$SELECT approve_substage(test_sub(110,1,1))$q$,'not_paid:');

-- Finality/next target follows actual stored stage numbers rather than hardcoded10.
SELECT test_start(70,2);
UPDATE project_stages SET stage_number=4 WHERE id=test_id(70,2);
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(70,1);
 IF r->>'next_stage_number'<>'4' THEN RAISE EXCEPTION 'noncontiguous schedule lost actual next stage'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'
   AND tablename IN ('projects','project_stages','project_substages','payments'))<>4 THEN
   RAISE EXCEPTION 'progression realtime tables missing';
 END IF;
END $$;
SELECT 'STAGE_PROGRESSION_OK' AS result;
`;
  const sql = [setup,
    read('scripts/fixtures/stage-approval-schema-before.sql'),
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_guard'),
    fn('supabase/migrations/090_payments_ledger.sql', 'project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'stages_guard_payment_status'),
    fn('supabase/migrations/103_join_project_in_progress.sql', 'stages_guard_completion'),
    fn('supabase/migrations/174_the_client_approves_the_stage.sql', 'stage_has_evidence'),
    fn('supabase/migrations/175_receipt_then_contractor_confirms.sql', 'stage_funding_settled'),
    fn('supabase/migrations/132_paid_opens_the_stage.sql', 'open_stage_if_settled'), triggers,
    read('supabase/migrations/20261112000000_receipt_payment_amounts.sql'),
    read('supabase/migrations/20261112000100_ordered_stage_progression.sql'),
    read('scripts/fixtures/stage-approval-schema-reproduce.sql'),
    read('supabase/migrations/20261112000900_stage_approval_metadata.sql'),
    read('scripts/fixtures/stage-approval-schema-after.sql'),
    tests,
    `CREATE TEMP TABLE stage_approval_rerun_snapshot AS SELECT id,to_jsonb(s) AS saved FROM public.project_stages s;`,
    read('supabase/migrations/20261112000900_stage_approval_metadata.sql'),
    read('scripts/fixtures/stage-approval-schema-final.sql'),
  ].join('\n').replace(/\n[\t ]*\n/g, '\n');
  const sqlPath = join(dir, 'regression.sql');
  writeFileSync(sqlPath, sql);
  const input = openSync(sqlPath, 'r');
  let result;
  try {
    result = spawnSync(join(bin, 'postgres'), ['--single', '-D', dir, '-j', 'postgres'],
      { stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  } finally { closeSync(input); }
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('STAGE_PROGRESSION_OK')) throw new Error(output);
  console.log('Stage database regressions passed: atomic final-update approval, ordered receipt prompts, paid-only work, prepayment without early opening, historical/zero/sub-cent allocations, idempotent finality, direct-write guards and admin funding paths.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
