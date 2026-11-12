-- Disposable fixtures; real receipt/progression RPCs and policies are installed by the runner.
CREATE FUNCTION public.test_assert(ok boolean, description text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',description; END IF;
END $$;
CREATE FUNCTION public.test_start(p_number int,p_origin text DEFAULT 'client',p_start int DEFAULT 1,p_zero boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE n int; cost numeric; BEGIN
 INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,current_stage,workflow_origin)
 VALUES(test_id(p_number),CASE WHEN p_origin='contractor' THEN '00000000-0000-0000-0000-000000000002'::uuid ELSE '00000000-0000-0000-0000-000000000001'::uuid END,'US','boq','USD',1,300,300,p_start,'client');
 FOR n IN 1..3 LOOP
  cost:=CASE WHEN n=3 AND p_zero THEN 0 ELSE 100 END;
  INSERT INTO project_stages(id,project_id,stage_number,status,payment_milestone_usd,milestone_amount,payment_status,pre_existing)
  VALUES(test_id(p_number,n),test_id(p_number),n,CASE WHEN n<p_start THEN 'complete' ELSE 'locked' END,cost,cost,CASE WHEN n<p_start OR cost=0 THEN 'paid' ELSE 'unpaid' END,n<p_start);
  INSERT INTO project_substages(id,stage_id,status,evidence_urls) SELECT test_sub(p_number,n,k),test_id(p_number,n),CASE WHEN n<p_start THEN 'complete' ELSE 'locked' END,'["proof.jpg"]'::jsonb FROM generate_series(1,2) k;
  IF n>=p_start AND cost>0 THEN INSERT INTO payments(project_id,stage_id,direction,state,amount) VALUES(test_id(p_number),test_id(p_number,n),'in','expected',cost); END IF;
 END LOOP;
 INSERT INTO contractor_invites VALUES(test_id(p_number),'accepted','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
 PERFORM open_stage_if_settled(test_id(p_number,p_start));
END $$;
CREATE FUNCTION public.test_path(p_number int,p_stage int,p_file int) RETURNS text LANGUAGE sql AS $$ SELECT test_id($1)::text||'/receipts/'||$2||'-'||$3||'.png' $$;
CREATE FUNCTION public.test_proof(p_number int,p_stage int,p_file int,p_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_id uuid; v_path text:=test_path(p_number,p_stage,p_file); BEGIN
 INSERT INTO storage.objects(bucket_id,name) VALUES('evidence',v_path) ON CONFLICT DO NOTHING;
 INSERT INTO receipt_readings(stage_id,project_id,submitted_by,status,path,object_id,object_version,file_sha256,amount,amount_text,currency,confidence)
 SELECT test_id(p_number,p_stage),test_id(p_number),'00000000-0000-0000-0000-000000000001','matched',v_path,id,version,md5(v_path)||md5(v_path),p_amount,p_amount::text,'USD','high' FROM storage.objects WHERE name=v_path
 RETURNING id INTO v_id; RETURN v_id;
END $$;
CREATE FUNCTION public.test_send(p_number int,p_stage int,p_file int,p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE proof uuid; BEGIN
 proof:=test_proof(p_number,p_stage,p_file,p_amount);
 RETURN submit_stage_payment_receipt(test_id(p_number,p_stage),test_path(p_number,p_stage,p_file),p_amount,'USD',1,proof);
END $$;
CREATE FUNCTION public.test_decide(p_number int,p_stage int,p_file int,p_decision text,p_top_up numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT decide_stage_payment_receipt((SELECT id FROM stage_payment_receipts WHERE path=test_path($1,$2,$3)),$4,'Reviewed receipt',$5) $$;
CREATE FUNCTION public.test_finish(p_number int,p_stage int) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 PERFORM approve_substage(test_sub(p_number,p_stage,1));
 r:=approve_substage(test_sub(p_number,p_stage,2)); RETURN r->'stage_approval';
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON public.projects,public.project_stages,public.project_substages,public.payments,public.test_activity TO authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_start(50,'client',1,true),test_start(51,'contractor'),test_start(52,'contractor',2);
SELECT test_assert((SELECT workflow_origin FROM projects WHERE id=test_id(51))='contractor','server derives contractor origin despite supplied client origin');
SELECT test_refused($q$UPDATE projects SET workflow_origin='client' WHERE id=test_id(51)$q$,'workflow_origin_fixed:');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(51,1))='active' AND NOT stage_funding_settled(test_id(51,1)) AND stage_work_ready(test_id(51,1)),'contractor initial evidence opens without inventing payment');
SELECT test_assert((SELECT payment_status FROM project_stages WHERE id=test_id(51,1))='unpaid' AND (SELECT state FROM payments WHERE stage_id=test_id(51,1))='expected','contractor evidence exception remains financially unpaid');
SELECT test_assert((SELECT milestone_amount FROM project_stages WHERE id=test_id(52,1))=100 AND (SELECT status FROM project_stages WHERE id=test_id(52,1))='complete','historical allocation retained');
SELECT test_assert(stage_starts_with_evidence(test_id(52,2)) AND NOT stage_starts_with_evidence(test_id(52,3)),'mid-build initial evidence exception selects first live stage');
-- All public actions below run under a real authenticated role, not the migration owner.
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_assert(row_security_active('stage_payment_receipts'),'real receipt RLS active');
SELECT test_assert(NOT has_function_privilege('authenticated','record_stage_payment_receipt(uuid,text,numeric,text,numeric)','EXECUTE'),'private recording RPC inaccessible');
SELECT test_refused($q$SELECT reserve_receipt_read(test_id(50,1),'00000000-0000-0000-0000-000000000001')$q$,'permission denied');
SELECT test_refused($q$INSERT INTO receipt_readings(stage_id,project_id,submitted_by) VALUES(test_id(50,1),test_id(50),'00000000-0000-0000-0000-000000000001')$q$,'permission denied');
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(50,1),test_path(50,1,1),50,'USD',1)$q$,'receipt_reading_required:');
SELECT test_refused($q$SELECT approve_substage(test_sub(50,1,1))$q$,'wrong_state:');
SELECT test_refused($q$SELECT test_send(50,2,1,50)$q$,'receipt_gated:');
SELECT test_refused($q$SELECT test_send(51,1,1,50)$q$,'receipt_gated:');
-- Small positive amounts have no arbitrary minimum, and mismatches cannot bypass extraction.
SELECT test_send(50,1,1,0.000001);
SELECT test_refused($q$SELECT test_send(50,1,2,100)$q$,'receipt_pending_review:');
SELECT test_refused($q$SELECT decide_stage_payment_receipt((SELECT id FROM stage_payment_receipts WHERE stage_id=test_id(50,1)),'accept')$q$,'not_contractor:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(50,1,1,'needs_top_up',99.999999);
SELECT test_assert((SELECT sum(amount) FROM stage_payment_receipts WHERE stage_id=test_id(50,1) AND decision='received')=0.000001 AND NOT stage_work_ready(test_id(50,1)),'partial received counts money while work stays locked');
SELECT test_decide(50,1,1,'needs_top_up',99.999999);
SELECT test_refused($q$SELECT test_decide(50,1,1,'flag')$q$,'receipt_received:');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_send(50,1,2,80);
SELECT test_assert((SELECT count(*) FROM stage_payment_receipts WHERE stage_id=test_id(50,1))=2,'top-up retains first receipt');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_decide(50,1,1,'accept')$q$,'receipt_pending_review:');
SELECT test_decide(50,1,2,'accept');
SELECT test_decide(50,1,2,'accept');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(50,1))='active' AND stage_work_ready(test_id(50,1)),'contractor may proceed with negotiated amount');
SELECT test_assert((SELECT sum(amount) FROM stage_payment_receipts WHERE stage_id=test_id(50,1) AND decision='received')=80.000001,'decisions never count scheduled amount or duplicate retries');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT submit_stage_payment_receipt(test_id(50,1),test_path(50,1,2),80,'USD',1,(SELECT reading_id FROM stage_payment_receipts WHERE path=test_path(50,1,2)));
SELECT test_finish(50,1);
SELECT test_send(50,2,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(50,2,1,'flag');
SELECT test_assert(NOT stage_work_ready(test_id(50,2)) AND (SELECT count(*) FROM stage_payment_receipts WHERE stage_id=test_id(50,2) AND decision='received')=0,'flagged proof does not fund or open work');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_send(50,2,2,90);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(50,2,2,'needs_top_up',10);
SELECT test_decide(50,2,2,'accept');
SELECT test_assert((SELECT count(*) FROM stage_payment_receipts WHERE stage_id=test_id(50,2))=2 AND (SELECT sum(amount) FROM stage_payment_receipts WHERE stage_id=test_id(50,2) AND decision='received')=90,'proceed after top-up request reuses received money');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(50,2);
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(50,3))='active' AND NOT EXISTS(SELECT 1 FROM payments WHERE stage_id=test_id(50,3)),'zero stage opens with no charge');
SELECT test_finish(50,3);
SELECT test_assert((SELECT status FROM projects WHERE id=test_id(50))='completed','final zero-stage review finishes project');
DO $$ DECLARE r jsonb; BEGIN
 r:=test_finish(51,1);
 PERFORM test_assert(r->>'awaiting_reviewed_stage_payment'='true' AND r->>'next_stage_id'=test_id(51,1)::text,'approval requests the reviewed first stage receipt');
END $$;
SELECT test_assert((SELECT status='pending_review' AND review_payment_pending AND payment_status='unpaid' FROM project_stages WHERE id=test_id(51,1)) AND (SELECT current_stage FROM projects WHERE id=test_id(51))=1,'reviewed stage stays current and unpaid until receipt acceptance');
SELECT test_refused($q$SELECT test_send(51,2,1,100)$q$,'receipt_gated:');
SELECT test_send(51,1,1,30);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT approve_stage(test_id(51,1))$q$,'not_authorized:');
SELECT test_refused($q$SELECT finish_reviewed_stage_payment(test_id(51,1))$q$,'permission denied');
SELECT test_decide(51,1,1,'needs_top_up',70);
SELECT test_assert((SELECT review_payment_pending AND status='pending_review' FROM project_stages WHERE id=test_id(51,1)) AND (SELECT status FROM project_stages WHERE id=test_id(51,2))='locked','partial received first-stage payment does not advance construction');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(51,1);
SELECT test_assert((SELECT count(*) FROM test_activity WHERE project_id=test_id(51) AND event='stage.work_approved')=1,'work approval retry is idempotent');
SELECT test_send(51,1,2,70);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(51,1,2,'accept');
SELECT test_decide(51,1,2,'accept');
SELECT test_assert((SELECT status='complete' AND NOT review_payment_pending AND approved_by='00000000-0000-0000-0000-000000000001' FROM project_stages WHERE id=test_id(51,1)) AND (SELECT current_stage FROM projects WHERE id=test_id(51))=2,'contractor receipt acceptance completes the already reviewed stage and preserves client approval attribution');
SELECT test_assert(NOT stage_starts_with_evidence(test_id(51,2)) AND (SELECT status FROM project_stages WHERE id=test_id(51,2))='locked','the successor follows the ordinary funding gate');
SELECT test_assert((SELECT count(*) FROM test_activity WHERE project_id=test_id(51) AND event='stage.payment_settled')=1 AND (SELECT sum(amount) FROM stage_payment_receipts WHERE project_id=test_id(51) AND decision='received')=100,'first-stage completion and payouts are recorded once');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_send(51,2,1,100);
-- Bind proof to exact actor, stage, file version, currency, amount and expiry.
RESET ROLE;
SELECT test_proof(52,3,1,100);
SELECT test_finish(52,2);
SELECT test_send(52,2,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(52,2,1,'accept');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),99,'USD',1,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)))$q$,'receipt_reading_required:');
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),100,'XAF',600,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)))$q$,'receipt_reading_required:');
UPDATE receipt_readings SET submitted_by='00000000-0000-0000-0000-000000000008' WHERE path=test_path(52,3,1);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),100,'USD',1,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)))$q$,'receipt_reading_required:');
UPDATE receipt_readings SET submitted_by='00000000-0000-0000-0000-000000000001',expires_at=now()-interval '1 second' WHERE path=test_path(52,3,1);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),100,'USD',1,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)))$q$,'receipt_reading_expired');
UPDATE receipt_readings SET expires_at=now()+interval '1 minute' WHERE path=test_path(52,3,1);
UPDATE storage.objects SET version='v2' WHERE name=test_path(52,3,1);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),100,'USD',1,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)))$q$,'receipt_file_changed:');
UPDATE receipt_readings SET object_version='v2' WHERE path=test_path(52,3,1);
SELECT submit_stage_payment_receipt(test_id(52,3),test_path(52,3,1),100,'USD',1,(SELECT id FROM receipt_readings WHERE path=test_path(52,3,1)));
SELECT test_refused($q$DELETE FROM storage.objects WHERE name=test_path(52,3,1)$q$,'receipt_file_recorded:');
SELECT test_refused($q$UPDATE storage.objects SET version='v3' WHERE name=test_path(52,3,1)$q$,'receipt_file_recorded:');
SELECT test_refused($q$UPDATE stage_payment_receipts SET amount=1 WHERE path=test_path(52,3,1)$q$,'receipt_via_rpc:');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000008',false);
SELECT test_assert((SELECT count(*) FROM stage_payment_receipts)=0 AND (SELECT count(*) FROM receipt_readings)=0,'outsider cannot read payment history or readings');
SELECT test_refused($q$SELECT test_decide(52,3,1,'accept')$q$,'not_found:');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'REVIEW_PAYMENTS_OK' AS result;
