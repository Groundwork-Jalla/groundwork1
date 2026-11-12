RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_start(61,'client'),test_start(62,'contractor');
UPDATE projects SET budget_currency='XAF',budget_fx_rate=600,budget_amount=180000 WHERE id IN(test_id(61),test_id(62));
UPDATE project_stages SET milestone_amount=60000 WHERE project_id IN(test_id(61),test_id(62));
CREATE FUNCTION public.test_currency_proof(p_number int,p_file int,p_amount numeric,p_currency text,p_rate numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_id uuid; v_path text:=test_path(p_number,1,p_file); BEGIN
 INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',v_path);
 INSERT INTO receipt_readings(stage_id,project_id,submitted_by,status,path,object_id,object_version,file_sha256,amount,amount_text,currency,confidence)
 SELECT test_id(p_number,1),test_id(p_number),'00000000-0000-0000-0000-000000000001','matched',v_path,id,version,md5(v_path)||md5(v_path),p_amount,p_amount::text,p_currency,'high' FROM storage.objects WHERE name=v_path RETURNING id INTO v_id;
 PERFORM attach_receipt_conversion(v_id,p_rate,'USD',1,'ExchangeRate-API',now());
 RETURN v_id;
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT attach_receipt_conversion(NULL,1,'USD',1,'USD',now())$q$,'permission denied');
-- Selecting XAF preserves the exact source amount and the locked project FX.
SELECT submit_stage_payment_receipt(test_id(61,1),test_path(61,1,1),18000,'XAF',600,test_currency_proof(61,1,18000,'XAF',999));
SELECT test_assert((SELECT amount=18000 AND fx_rate=600 AND amount_usd=30 AND project_currency='XAF' AND project_fx_rate=600 AND project_amount=18000 FROM stage_payment_receipts WHERE path=test_path(61,1,1)),'native receipt uses its exact amount and project conversion rather than a supplied quote');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(61,1,1,'needs_top_up',42000);
SELECT test_assert(NOT stage_work_ready(test_id(61,1)),'partial payment does not itself unlock work');
-- USD is an actual transaction currency on the same XAF project, not a label change.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT submit_stage_payment_receipt(test_id(61,1),test_path(61,1,2),50,'USD',1,test_currency_proof(61,2,50,'USD',999));
SELECT test_assert((SELECT amount=50 AND fx_rate=1 AND amount_usd=50 AND project_amount=30000 FROM stage_payment_receipts WHERE path=test_path(61,1,2)),'USD receipt retains dollars and saved XAF equivalent');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(61,1,2,'needs_top_up',20);
SELECT test_assert((SELECT sum(project_amount) FROM stage_payment_receipts WHERE stage_id=test_id(61,1) AND decision='received')=48000 AND (SELECT status FROM project_stages WHERE id=test_id(61,1))='locked','confirmed partial receipts subtract from allocation while contractor keeps the stage locked');
-- A third currency uses its own server-attested rate; client-supplied rates are rejected.
RESET ROLE;
SELECT test_currency_proof(61,3,16,'EUR',0.8);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(61,1),test_path(61,1,3),16,'EUR',1,(SELECT id FROM receipt_readings WHERE path=test_path(61,1,3)))$q$,'receipt_rate_mismatch:');
SELECT submit_stage_payment_receipt(test_id(61,1),test_path(61,1,3),16,'EUR',0.8,(SELECT id FROM receipt_readings WHERE path=test_path(61,1,3)));
SELECT test_assert((SELECT amount=16 AND currency='EUR' AND amount_usd=20 AND project_amount=12000 AND fx_source='ExchangeRate-API' FROM stage_payment_receipts WHERE path=test_path(61,1,3)),'foreign receipt is converted by its verified snapshot');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(61,1,3,'accept'); SELECT test_decide(61,1,3,'accept');
SELECT test_assert(stage_work_ready(test_id(61,1)) AND (SELECT sum(project_amount) FROM stage_payment_receipts WHERE stage_id=test_id(61,1) AND decision='received')=60000 AND (SELECT sum(amount_usd) FROM stage_payment_receipts WHERE stage_id=test_id(61,1) AND decision='received')=100,'mixed-currency receipts reconcile to the stage budget once and only contractor acceptance opens work');
-- Retries freeze the first conversion, and receipt history cannot rewrite it.
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 r:=attach_receipt_conversion((SELECT id FROM receipt_readings WHERE path=test_path(61,1,3)),0.5,'USD',2,'ExchangeRate-API',now());
 PERFORM test_assert((r->>'fx_rate')::numeric=0.8 AND (r->>'project_fx_rate')::numeric=600,'retry retains its original receipt conversion');
 PERFORM set_config('app.stage_receipt_write','on',true);
 PERFORM test_refused($q$UPDATE stage_payment_receipts SET project_amount=1 WHERE path=test_path(61,1,3)$q$,'receipt_immutable:');
 PERFORM set_config('app.stage_receipt_write','off',true);
END $$;
-- Contractor-created projects still request the reviewed first stage's own payment.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(62,1);
SELECT submit_stage_payment_receipt(test_id(62,1),test_path(62,1,1),100,'USD',1,test_currency_proof(62,1,100,'USD',1));
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(62,1,1,'accept');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(62,1))='complete' AND (SELECT current_stage FROM projects WHERE id=test_id(62))=2 AND (SELECT status FROM project_stages WHERE id=test_id(62,2))='locked','multi-currency receipt confirmation preserves reviewed-first-stage progression');
SELECT test_assert((SELECT budget_amount FROM projects WHERE id=test_id(62))=180000 AND (SELECT sum(milestone_amount) FROM project_stages WHERE project_id=test_id(62))=180000,'transaction currencies do not alter the confirmed BOQ or its allocations');
RESET ROLE;
SELECT 'MULTICURRENCY_RECEIPTS_OK' AS result;
