RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_price_start(180),test_price_start(181),test_price_start(182,'boq','contractor'),test_price_start(183),test_price_start(184),test_price_start(185),test_price_start(186),test_price_start(187),test_price_start(188);
CREATE FUNCTION public.test_plan_send(n int,s int,f int,usd numeric,installment int DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$ SELECT submit_stage_installment_receipt(test_id(n,s),test_path(n,s,f),usd,'USD',1,test_proof(n,s,f,usd),installment) $$;
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT submit_stage_payment_receipt(test_id(180,3),'fake',1,'USD',1,NULL)$q$,'permission denied');
SELECT save_stage_payment_plan(test_id(180,3),'two_installments',30000,stage_payment_plan_context(test_id(180,3))->>'hash');
SELECT test_plan_send(180,3,1,20),test_plan_send(180,3,2,30);
SELECT test_refused($q$SELECT save_stage_payment_plan(test_id(180,3),'full',NULL,stage_payment_plan_context(test_id(180,3))->>'hash')$q$,'payment_plan_locked');
SELECT test_assert((SELECT count(*)=2 AND bool_and(installment_number=1) FROM stage_payment_receipts WHERE stage_id=test_id(180,3)),'several vendor receipts belong to the first installment without overwriting each other');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_decide(180,3,1,'accept')$q$,'payment_plan_review_required');
SELECT decide_stage_payment_plan(test_id(180,3),(stage_payment_plan_context(test_id(180,3))->'plan'->>'id')::uuid,true,stage_payment_plan_context(test_id(180,3))->>'hash');
SELECT test_decide(180,3,1,'record');
SELECT test_assert(NOT stage_work_ready(test_id(180,3)),'acknowledging money does not grant work permission');
SELECT test_decide(180,3,2,'accept');
SELECT test_assert(stage_work_ready(test_id(180,3)) AND NOT (stage_payment_plan_context(test_id(180,3))->>'progression_authorized')::boolean,'accepted first installment opens current work while the next stage waits for settlement');
SELECT test_refused($q$SELECT test_decide(180,3,1,'needs_top_up',1000)$q$,'top_up_exceeds_balance');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(180,3);
SELECT test_assert((SELECT status='pending_review' AND review_payment_pending FROM project_stages WHERE id=test_id(180,3)) AND (SELECT current_stage FROM projects WHERE id=test_id(180))=3,'client-approved current work waits for the second installment');
SELECT test_plan_send(180,3,3,10,2),test_plan_send(180,3,4,40,2);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(180,3,3,'record'),test_decide(180,3,4,'record');
SELECT test_assert((SELECT status='complete' FROM project_stages WHERE id=test_id(180,3)) AND (SELECT current_stage FROM projects WHERE id=test_id(180))=4,'final received installment finishes reviewed work even when the ledger was already funded');
SELECT test_assert((SELECT count(*)=4 AND sum(project_amount)=60000 AND count(*) FILTER(WHERE installment_number=2)=2 FROM stage_payment_receipts WHERE stage_id=test_id(180,3) AND decision='received'),'four receipts in two installments reconcile to one stage total');

-- Full-payment mode also separates partial receipt acceptance from a debt waiver.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT save_stage_payment_plan(test_id(181,3),'full',NULL,stage_payment_plan_context(test_id(181,3))->>'hash');
SELECT test_plan_send(181,3,1,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(181,3,1,'accept');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(181,3);
SELECT test_refused($q$SELECT authorize_stage_progression(test_id(181,3),stage_payment_plan_context(test_id(181,3))->>'hash')$q$,'not_primary_contractor');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT authorize_stage_progression(test_id(181,3),'old snapshot')$q$,'payment_plan_stale');
SELECT authorize_stage_progression(test_id(181,3),stage_payment_plan_context(test_id(181,3))->>'hash','Agreed balance payable later');
SELECT authorize_stage_progression(test_id(181,3),'retry after a lost response','Agreed balance payable later');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(181) AND action='funding.progression_with_balance_authorized')=1,'retry does not repeat progression or its audit event');
SELECT test_assert((SELECT status='complete' FROM project_stages WHERE id=test_id(181,3)) AND (stage_payment_plan_context(test_id(181,3))->>'remaining')::numeric=30000,'explicit progression keeps the actual unpaid balance');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(181,3,2,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(181,3,2,'accept');
SELECT test_assert((stage_payment_plan_context(test_id(181,3))->>'remaining')::numeric=0 AND (SELECT current_stage FROM projects WHERE id=test_id(181))=4,'paying a late balance does not reopen work or skip the next stage');

-- Contractor-origin stages retain evidence, client approval, then payment.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(182,3);
SELECT save_stage_payment_plan(test_id(182,3),'two_installments',30000,stage_payment_plan_context(test_id(182,3))->>'hash');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT decide_stage_payment_plan(test_id(182,3),(stage_payment_plan_context(test_id(182,3))->'plan'->>'id')::uuid,true,stage_payment_plan_context(test_id(182,3))->>'hash');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(182,3,1,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(182,3,1,'accept');
SELECT test_assert((SELECT review_payment_pending FROM project_stages WHERE id=test_id(182,3)),'contractor-origin partial receipt does not complete reviewed work by itself');
SELECT authorize_stage_progression(test_id(182,3),stage_payment_plan_context(test_id(182,3))->>'hash');
SELECT test_assert((SELECT status='active' FROM project_stages WHERE id=test_id(182,4)) AND (stage_payment_plan_context(test_id(182,3))->>'remaining')::numeric=30000,'contractor override opens next evidence stage while keeping the debt');

-- An accepted current-stage permission must not turn into a progression grant on replay.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(183,3,1,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(183,3,1,'accept');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(183,3);

-- Even full receipt acknowledgement leaves the separate work decision intact.
SELECT test_plan_send(185,3,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(185,3,1,'record');
SELECT test_assert((stage_payment_plan_context(test_id(185,3))->>'remaining')::numeric=0 AND NOT stage_work_ready(test_id(185,3)),'fully received money does not independently grant work permission');
SELECT test_decide(185,3,1,'accept');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(185,3);
SELECT test_assert((SELECT status='complete' FROM project_stages WHERE id=test_id(185,3)),'fully settled and authorized work proceeds only after client approval');

-- A recorded receipt can be reviewed later without counting its amount twice.
SELECT test_plan_send(186,3,1,30);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(186,3,1,'record');
SELECT test_decide(186,3,1,'needs_top_up',20);
SELECT test_assert((stage_payment_plan_context(test_id(186,3))->>'received')::numeric=18000 AND NOT stage_work_ready(test_id(186,3)),'later additional-payment request does not duplicate the received amount or authorize work');
SELECT test_decide(186,3,1,'accept');
SELECT test_assert(stage_work_ready(test_id(186,3)),'contractor can later authorize work against an already recorded receipt');

-- Replacing a pending vendor file keeps its installment and immutable history.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT save_stage_payment_plan(test_id(187,3),'two_installments',30000,stage_payment_plan_context(test_id(187,3))->>'hash');
SELECT test_plan_send(187,3,1,50,2);
SELECT submit_stage_installment_receipt(test_id(187,3),test_path(187,3,2),60,'USD',1,test_proof(187,3,2,60),1,
 (SELECT id FROM stage_payment_receipts WHERE stage_id=test_id(187,3) AND path=test_path(187,3,1)));
SELECT test_assert((SELECT count(*)=2 AND bool_and(installment_number=2) AND count(*) FILTER(WHERE replaced_by IS NULL)=1 FROM stage_payment_receipts WHERE stage_id=test_id(187,3)),'corrected receipt stays in its original installment and retains replaced proof');

-- A client-approved zero price must not get stuck behind an obsolete payment plan.
SELECT save_stage_payment_plan(test_id(188,3),'two_installments',30000,stage_payment_plan_context(test_id(188,3))->>'hash');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(188,3,'0');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(188) AND status='pending';
SELECT test_assert(stage_work_ready(test_id(188,3)) AND (stage_payment_plan_context(test_id(188,3))->>'progression_authorized')::boolean,'zero-cost approved work requires no payment-plan acceptance or fabricated receipt');
SELECT test_finish(188,3);
SELECT test_assert((SELECT status='complete' FROM project_stages WHERE id=test_id(188,3)),'client can approve a revised zero-cost stage');

-- A plan changed in another tab invalidates a contractor's second confirmation.
SELECT save_stage_payment_plan(test_id(184,3),'two_installments',20000,stage_payment_plan_context(test_id(184,3))->>'hash');
RESET ROLE;
CREATE TEMP TABLE payment_plan_old_hash AS SELECT stage_payment_plan_context(test_id(184,3))->>'hash' AS hash;
SET ROLE authenticated;
SELECT save_stage_payment_plan(test_id(184,3),'two_installments',30000,stage_payment_plan_context(test_id(184,3))->>'hash');
SELECT test_assert((SELECT count(*)=2 AND count(*) FILTER(WHERE superseded_at IS NULL)=1 AND count(*) FILTER(WHERE first_amount=20000)=1 FROM stage_payment_plans WHERE stage_id=test_id(184,3)),'revising an unsubmitted plan retains the earlier proposed amounts');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
RESET ROLE;
SELECT test_refused($q$SELECT decide_stage_payment_plan(test_id(184,3),(stage_payment_plan_context(test_id(184,3))->'plan'->>'id')::uuid,true,(SELECT hash FROM payment_plan_old_hash))$q$,'payment_plan_stale');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000006',false);
SELECT test_refused($q$SELECT save_stage_payment_plan(test_id(184,3),'full',NULL,'fake')$q$,'not_client');
SELECT test_refused($q$SELECT decide_stage_payment_plan(test_id(184,3),NULL,true,'fake')$q$,'not_primary_contractor');
SELECT test_refused($q$SELECT authorize_stage_progression(test_id(184,3),'fake')$q$,'not_primary_contractor');
SELECT test_assert((SELECT count(*) FROM stage_payment_plans)=0,'unrelated users cannot read payment plans');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE data->>'financial_event'='payment_plan_proposed' AND body LIKE 'Votre%' AND data->>'project_tab'='work'),'contractor receives a plan review link in their language');
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE data->>'financial_event'='payment_plan_accepted' AND body LIKE 'Your contractor%' AND data->>'project_tab'='stages'),'client receives the accepted-plan next step');
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE data->>'financial_event'='progression_with_balance_authorized' AND body LIKE '%30000.000000 XAF%' AND data->>'project_tab'='stages'),'progression notification keeps the outstanding native balance visible');
SELECT 'STAGE_PAYMENT_PLANS_OK' AS result;
