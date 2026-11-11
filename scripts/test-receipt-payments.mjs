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
const dir = mkdtempSync(join(tmpdir(), 'groundwork-receipts-test-'));
try {
  const init = spawnSync(join(bin, 'initdb'), ['-D', dir, '-A', 'trust', '--no-locale', '--no-sync'],
    { encoding: 'utf8', timeout: 30000 });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const setup = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='00000000-0000-0000-0000-000000000004'::uuid $$;
CREATE FUNCTION public.is_project_client(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION public.is_contractor_on(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $2='00000000-0000-0000-0000-000000000002'::uuid $$;
CREATE TABLE public.test_activity(project_id uuid,event text,details jsonb);
CREATE FUNCTION public.log_activity(uuid,text,text,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO test_activity VALUES($1,$2,$6) $$;
CREATE TABLE storage.objects(bucket_id text,name text,UNIQUE(bucket_id,name));
CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid,country text,budget_source text,budget_currency text,budget_fx_rate numeric(24,12),budget_amount numeric(24,6),budget_usd numeric(24,9),current_stage integer,status text DEFAULT 'active');
CREATE TABLE public.project_stages(id uuid PRIMARY KEY,project_id uuid REFERENCES projects,stage_number integer,status text DEFAULT 'locked',payment_milestone_usd numeric(24,9),payment_status text DEFAULT 'unpaid',pre_existing boolean DEFAULT false);
CREATE TABLE public.project_substages(stage_id uuid,status text);
CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid,stage_id uuid,direction text,state text,amount numeric(14,2) CHECK(amount>0),currency text DEFAULT 'USD',receipt_path text,receipt_uploaded_by uuid,receipt_uploaded_at timestamptz,funding_source text,confirmed_by uuid,confirmed_at timestamptz,authorised_by uuid,authorised_at timestamptz,note text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
CONSTRAINT payments_state_by_direction CHECK((direction='in' AND state IN('expected','receipt_submitted','funded','reconciled')) OR (direction='out' AND state IN('release_authorised','initiated','disbursed','failed','reconciling'))),
CONSTRAINT payments_receipt_has_proof CHECK(state<>'receipt_submitted' OR (receipt_path IS NOT NULL AND receipt_uploaded_by IS NOT NULL AND receipt_uploaded_at IS NOT NULL)));
CREATE UNIQUE INDEX payments_one_tranche_per_stage ON payments(stage_id) WHERE direction='in';
CREATE FUNCTION public.test_refused(p_sql text,p_prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE p_sql; RAISE EXCEPTION 'TEST_EXPECTED_REFUSAL: %',p_prefix;
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE p_prefix || '%' THEN RAISE; END IF; END;
END $$;
INSERT INTO projects VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CM','boq','XAF',600,600000,1000,1,'active');
INSERT INTO projects VALUES('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','US','estimate',NULL,NULL,NULL,1000,1,'active');
INSERT INTO project_stages(id,project_id,stage_number,payment_milestone_usd)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000010',n-100,100 FROM generate_series(101,107) n;
INSERT INTO project_stages(id,project_id,stage_number,payment_milestone_usd)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000020',n-107,100 FROM generate_series(108,109) n;
INSERT INTO project_substages SELECT id,'locked' FROM project_stages;
INSERT INTO payments(project_id,stage_id,direction,state,amount) SELECT project_id,id,'in','expected',100 FROM project_stages;
-- Actual legacy data precedes the new columns and is never inferred from amount.
UPDATE payments SET state='receipt_submitted',receipt_path='00000000-0000-0000-0000-000000000010/receipts/legacy.pdf',receipt_uploaded_by='00000000-0000-0000-0000-000000000001',receipt_uploaded_at=now() WHERE stage_id='00000000-0000-0000-0000-000000000104';
UPDATE payments SET state='funded',receipt_path='00000000-0000-0000-0000-000000000010/receipts/confirmed-legacy.pdf',receipt_uploaded_by='00000000-0000-0000-0000-000000000001',receipt_uploaded_at=now(),funding_source='contractor_confirmed',confirmed_by='00000000-0000-0000-0000-000000000002',confirmed_at=now() WHERE stage_id='00000000-0000-0000-0000-000000000105';
UPDATE project_stages SET pre_existing=true,status='complete' WHERE id='00000000-0000-0000-0000-000000000106';
INSERT INTO storage.objects VALUES('evidence','00000000-0000-0000-0000-000000000010/receipts/one.pdf'),('evidence','00000000-0000-0000-0000-000000000010/receipts/two.pdf'),('evidence','00000000-0000-0000-0000-000000000020/receipts/one.pdf');
`;
  const triggers = `
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION public.payments_guard();
CREATE TRIGGER payments_project_payment_status AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION public.payments_project_payment_status();
CREATE TRIGGER stages_guard_payment_status BEFORE UPDATE OF payment_status ON project_stages FOR EACH ROW EXECUTE FUNCTION public.stages_guard_payment_status();
-- Reproduce the old guard's refusal of the handshake before applying the repair.
SELECT set_config('app.payments_write','on',false);
SELECT test_refused($q$UPDATE payments SET state='receipt_submitted',receipt_path='old.pdf',receipt_uploaded_by='00000000-0000-0000-0000-000000000001',receipt_uploaded_at=now() WHERE stage_id='00000000-0000-0000-0000-000000000101'$q$,'wrong_state:');
SELECT set_config('app.payments_write','off',false);
`;
  const tests = `
CREATE FUNCTION public.test_confirm(p_stage uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE; BEGIN
  SELECT * INTO p FROM payments WHERE stage_id=p_stage AND direction='in';
  RETURN confirm_stage_payment(p_stage,NULL,p.receipt_path,p.receipt_uploaded_at);
END $$;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM payments WHERE receipt_amount IS NOT NULL) THEN RAISE EXCEPTION 'legacy amounts invented'; END IF;
END $$;
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','old.pdf')$q$,'amount_required:');
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101')$q$,'not_contractor:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000003',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',6000,'XAF',600)$q$,'not_client:');
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101')$q$,'not_contractor:');
SELECT set_config('test.actor','',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','x',6000,'XAF',600)$q$,'not_signed_in');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101')$q$,'no_receipt:');
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000104')$q$,'amount_required:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',0,'XAF',600)$q$,'invalid_receipt_amount:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',-1,'XAF',600)$q$,'invalid_receipt_amount:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf','NaN'::numeric,'XAF',600)$q$,'invalid_receipt_amount:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',1000000000001,'XAF',600)$q$,'invalid_receipt_amount:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',1.1234567,'XAF',600)$q$,'invalid_receipt_amount:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',6000,'USD',1)$q$,'receipt_currency_mismatch:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000020/receipts/one.pdf',6000,'XAF',600)$q$,'invalid_receipt_path:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/missing.pdf',6000,'XAF',600)$q$,'no_receipt:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000010/receipts/one.pdf',6000,'XAF',600)$q$,'nothing_expected:');
-- Under the scheduled stage price, with an untrusted browser FX value.
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',6000,'XAF',123);
CREATE TABLE test_reviewed_receipt AS SELECT receipt_path,receipt_uploaded_at FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000101';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000101' AND state='receipt_submitted' AND receipt_amount=6000 AND receipt_amount_usd=10 AND receipt_fx_rate=600 AND amount=100) THEN RAISE EXCEPTION 'actual versus scheduled amount drift'; END IF;
  IF stage_funding_settled('00000000-0000-0000-0000-000000000101') THEN RAISE EXCEPTION 'receipt upload settled stage'; END IF;
  IF (SELECT status FROM project_stages WHERE id='00000000-0000-0000-0000-000000000101')<>'locked' THEN RAISE EXCEPTION 'receipt upload opened stage'; END IF;
END $$;
-- A pending receipt may be corrected. An identical retry records no second event.
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/two.pdf',7500.125,'XAF',600);
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/two.pdf',7500.125,'XAF',999);
DO $$ BEGIN
  IF (SELECT count(*) FROM test_activity WHERE event='funding.receipt_submitted')<>2 THEN RAISE EXCEPTION 'receipt retry duplicated event'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000101' AND receipt_amount_usd=12.500208333) THEN RAISE EXCEPTION 'receipt precision lost'; END IF;
END $$;
-- Correcting the amount while retaining the same file also invalidates an old
-- review, including multiple submissions inside one transaction.
CREATE TABLE test_reviewed_same_path AS SELECT receipt_path,receipt_uploaded_at FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000101';
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/two.pdf',7500.126,'XAF',600);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101')$q$,'stale_receipt:');
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101',NULL,receipt_path,receipt_uploaded_at) FROM test_reviewed_receipt$q$,'stale_receipt:');
SELECT test_refused($q$SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000101',NULL,receipt_path,receipt_uploaded_at) FROM test_reviewed_same_path$q$,'stale_receipt:');
SELECT test_confirm('00000000-0000-0000-0000-000000000101');
SELECT test_confirm('00000000-0000-0000-0000-000000000101');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM project_stages WHERE id='00000000-0000-0000-0000-000000000101' AND status='active' AND payment_status='paid' AND payment_milestone_usd=100) THEN RAISE EXCEPTION 'acknowledgment did not open stage'; END IF;
  IF (SELECT count(*) FROM test_activity WHERE event='funding.received')<>1 THEN RAISE EXCEPTION 'confirmation retry duplicated payout'; END IF;
  IF (SELECT budget_amount FROM projects WHERE id='00000000-0000-0000-0000-000000000010')<>600000 THEN RAISE EXCEPTION 'receipt changed contract'; END IF;
END $$;
SELECT test_refused($q$UPDATE payments SET receipt_amount=9000,receipt_amount_usd=15 WHERE stage_id='00000000-0000-0000-0000-000000000101'$q$,'immutable:');
SELECT test_refused($q$UPDATE payments SET amount=101 WHERE stage_id='00000000-0000-0000-0000-000000000101'$q$,'immutable:');
SELECT test_refused($q$UPDATE payments SET state='reconciled' WHERE stage_id='00000000-0000-0000-0000-000000000101'$q$,'payments_via_rpc:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000010/receipts/one.pdf',6000,'XAF',600)$q$,'nothing_expected:');
-- Above schedule is also valid when both parties agree. Planned amounts stay put.
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000010/receipts/one.pdf',120000,'XAF',600);
SELECT test_refused($q$UPDATE payments SET receipt_amount=180000,receipt_amount_usd=300 WHERE stage_id='00000000-0000-0000-0000-000000000102'$q$,'receipt_via_rpc:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_confirm('00000000-0000-0000-0000-000000000102');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000102' AND receipt_amount_usd=200 AND amount=100) THEN RAISE EXCEPTION 'above-schedule receipt changed plan'; END IF;
  IF (SELECT sum(receipt_amount_usd) FROM payments WHERE state IN('funded','reconciled'))<>212.50021 THEN RAISE EXCEPTION 'confirmed receipt sum wrong'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000105' AND state='funded' AND receipt_amount IS NULL) THEN RAISE EXCEPTION 'legacy confirmation changed'; END IF;
END $$;
-- Admin cash fallback still works, without inventing a receipt or its amount.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT confirm_stage_payment('00000000-0000-0000-0000-000000000103');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000103' AND state='funded' AND receipt_amount IS NULL AND funding_source='staff_confirmed') THEN RAISE EXCEPTION 'cash fallback fabricated receipt'; END IF;
END $$;
-- The client can repair a previously submitted receipt with unknown amount.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000010/receipts/two.pdf',18000,'XAF',600);
-- Non-BoQ receipts retain their supplied conversion snapshot, including exact USD.
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000020/receipts/one.pdf',12.5,'USD',2)$q$,'invalid_receipt_rate:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000020/receipts/one.pdf',12.5,'EUR',0)$q$,'invalid_receipt_rate:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000020/receipts/one.pdf',12.5,'EUR','NaN'::numeric)$q$,'invalid_receipt_rate:');
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000020/receipts/one.pdf',12.123456,'USD',1);
SELECT submit_stage_payment_receipt('00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000020/receipts/one.pdf',9.999999,'EUR',0.9);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000108' AND receipt_amount_usd=12.123456 AND receipt_currency='USD') THEN RAISE EXCEPTION 'USD receipt precision lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payments WHERE stage_id='00000000-0000-0000-0000-000000000109' AND receipt_fx_rate=0.9 AND receipt_amount_usd=11.11111) THEN RAISE EXCEPTION 'estimate snapshot lost'; END IF;
END $$;
SELECT 'RECEIPT_MIGRATION_OK' AS result;
`;
  const sql = [setup,
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_guard'),
    fn('supabase/migrations/090_payments_ledger.sql', 'project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'payments_project_payment_status'),
    fn('supabase/migrations/090_payments_ledger.sql', 'stages_guard_payment_status'),
    fn('supabase/migrations/175_receipt_then_contractor_confirms.sql', 'stage_funding_settled'),
    fn('supabase/migrations/132_paid_opens_the_stage.sql', 'open_stage_if_settled'),
    triggers,
    read('supabase/migrations/20261112000000_receipt_payment_amounts.sql'), tests,
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
  if (result.status !== 0 || /\b(?:ERROR|FATAL):/.test(output) || !output.includes('RECEIPT_MIGRATION_OK')) throw new Error(output);
  console.log('Receipt database regressions passed: real ledger guards/projection, actual under/overpayments, immutable confirmed amounts, native precision and locked FX, actor/file validation, legacy unknowns, cash fallback, retries and receipt/acknowledgment stage gate.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
