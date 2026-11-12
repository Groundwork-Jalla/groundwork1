-- Zero-cost first stages, final-stage onboarding, pauses, and protected review state.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_start(53,'contractor',3),test_start(54,'contractor'),test_start(56,'contractor');
SELECT mark_stage_paid(test_id(56,2),'Existing future-stage funding');
-- A zero-weight first stage has no financial obligation, including in contractor-led builds.
INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,current_stage)
 VALUES(test_id(55),'00000000-0000-0000-0000-000000000002','US','boq','USD',1,100,100,1);
INSERT INTO project_stages(id,project_id,stage_number,status,payment_milestone_usd,milestone_amount)
 VALUES(test_id(55,1),test_id(55),1,'active',0,0),(test_id(55,2),test_id(55),2,'locked',100,100);
INSERT INTO project_substages(id,stage_id,status,evidence_urls)
 SELECT test_sub(55,n,k),test_id(55,n),'pending','["proof.jpg"]'::jsonb FROM generate_series(1,2) n CROSS JOIN generate_series(1,2) k;
INSERT INTO payments(project_id,stage_id,direction,state,amount) VALUES(test_id(55),test_id(55,2),'in','expected',100);
INSERT INTO contractor_invites VALUES(test_id(55),'accepted','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(55,1);
SELECT test_assert((SELECT status='complete' AND NOT review_payment_pending FROM project_stages WHERE id=test_id(55,1)) AND NOT EXISTS(SELECT 1 FROM payments WHERE stage_id=test_id(55,1)),'zero first stage advances with no receipt or invented charge');
SELECT test_finish(53,3);
SELECT test_assert((SELECT status FROM projects WHERE id=test_id(53))='active' AND (SELECT review_payment_pending FROM project_stages WHERE id=test_id(53,3)),'last live stage waits for its own payment before finishing project');
SELECT test_send(53,3,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(53,3,1,'accept');
SELECT test_assert((SELECT status FROM projects WHERE id=test_id(53))='completed' AND (SELECT status FROM project_stages WHERE id=test_id(53,3))='complete','final reviewed stage completes only after contractor acceptance');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(56,1);
SELECT test_assert((SELECT review_payment_pending FROM project_stages WHERE id=test_id(56,1)) AND (SELECT status FROM project_stages WHERE id=test_id(56,2))='locked','a prefunded successor cannot bypass payment for the reviewed first stage');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT mark_stage_paid(test_id(56,1),'Staff confirmed receipt of cash');
SELECT test_assert((SELECT status='complete' AND NOT review_payment_pending AND approved_by='00000000-0000-0000-0000-000000000001' FROM project_stages WHERE id=test_id(56,1)) AND (SELECT status FROM project_stages WHERE id=test_id(56,2))='active','staff confirmation settles the reviewed stage and opens its prefunded successor without duplicate payment');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM stage_payment_receipts WHERE project_id=test_id(56)) AND (SELECT receipt_amount IS NULL FROM payments WHERE stage_id=test_id(56,1)),'staff confirmation never invents a receipt or actual amount');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(54,1);
SELECT test_send(54,1,1,90);
RESET ROLE;
SELECT test_refused($q$UPDATE project_stages SET review_payment_pending=false WHERE id=test_id(54,1)$q$,'review_payment_via_rpc:');
UPDATE projects SET status='on_hold' WHERE id=test_id(54);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(54,1,1,'accept');
SELECT test_assert((SELECT review_payment_pending AND status='pending_review' FROM project_stages WHERE id=test_id(54,1)) AND (SELECT status FROM project_stages WHERE id=test_id(54,2))='locked','recording real money while paused does not advance work');
RESET ROLE;
SELECT set_config('test.actor','',false);
UPDATE projects SET status='active' WHERE id=test_id(54);
SELECT test_assert((SELECT status='complete' AND NOT review_payment_pending FROM project_stages WHERE id=test_id(54,1)) AND (SELECT current_stage FROM projects WHERE id=test_id(54))=2,'resuming finalizes an already reviewed and paid first stage');
SELECT test_assert((SELECT sum(milestone_amount) FROM project_stages WHERE project_id=test_id(54))=300 AND (SELECT budget_amount FROM projects WHERE id=test_id(54))=300,'reviewed-stage payment never changes BOQ allocations');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'REVIEWED_FIRST_STAGE_OK' AS result;
