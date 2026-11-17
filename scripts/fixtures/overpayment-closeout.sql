-- Overpayment carry-over and the close-out gate (20261117000000).
-- Stages 3 and 4 are live at 60,000 XAF each (100 USD at 600); stages 1 and 2 are historical.
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);

-- Nobody has overpaid on these earlier projects: their totals are exactly what they were.
SELECT test_assert((SELECT bool_and(stage_payment_totals(s.id)=stage_payment_own_totals(s.id)) FROM project_stages s WHERE s.project_id IN(test_id(180),test_id(181),test_id(183))),
 'a project where nobody overpaid reads byte-for-byte as before');
CREATE TEMP TABLE carry_stages_before AS SELECT id,to_jsonb(s) AS saved FROM public.project_stages s;
CREATE TEMP TABLE carry_projects_before AS SELECT id,status FROM public.projects;

SELECT test_price_start(260),test_price_start(261),test_price_start(262),test_price_start(263,'boq','contractor'),test_price_start(264);
CREATE FUNCTION public.test_totals(n int,s int) RETURNS jsonb LANGUAGE sql AS $$ SELECT stage_payment_plan_context(test_id(n,s)) $$;
CREATE FUNCTION public.test_num(j jsonb,k text) RETURNS numeric LANGUAGE sql AS $$ SELECT coalesce((j->>k)::numeric,0) $$;
SET ROLE authenticated;

-- ── 260: an overpayment carries to the next stage, and the contractor still decides ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT save_stage_payment_plan(test_id(260,3),'full',NULL,test_totals(260,3)->>'hash');
SELECT test_plan_send(260,3,1,120);
SELECT test_assert(test_num(test_totals(260,4),'carried_in')=0 AND test_num(test_totals(260,4),'remaining')=60000,'a receipt the contractor has not confirmed carries nothing');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(260,3,1,'accept');
SELECT test_assert(test_num(test_totals(260,3),'remaining')=0 AND test_num(test_totals(260,3),'carried_out')=12000 AND test_num(test_totals(260,3),'received')=72000,
 'the overpaid stage is settled and reports what it passed on');
SELECT test_assert(test_num(test_totals(260,4),'carried_in')=12000 AND test_num(test_totals(260,4),'received')=12000 AND test_num(test_totals(260,4),'remaining')=48000,
 'the excess reduces what the next stage owes');
SELECT test_assert((test_totals(260,4)->>'can_confirm_credit')::boolean AND NOT stage_work_ready(test_id(260,4)) AND (SELECT status FROM project_stages WHERE id=test_id(260,4))='locked',
 'carried credit does not start the next stage by itself');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_assert(NOT coalesce((test_totals(260,4)->>'can_confirm_credit')::boolean,false),'the client is not offered the contractor decision');
SELECT test_refused($q$SELECT confirm_stage_credit(test_id(260,4),test_totals(260,4)->>'hash')$q$,'not_primary_contractor');
SELECT test_refused($q$SELECT * FROM project_payment_allocation(test_id(260))$q$,'permission denied');
SELECT test_finish(260,3);
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(260,3))='complete' AND (SELECT status FROM project_stages WHERE id=test_id(260,4))='locked'
 AND (SELECT status FROM projects WHERE id=test_id(260))='active','finishing the overpaid stage leaves the next one waiting for the contractor');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT confirm_stage_credit(test_id(260,4),'old snapshot')$q$,'payment_plan_stale');
SELECT confirm_stage_credit(test_id(260,4),test_totals(260,4)->>'hash');
SELECT confirm_stage_credit(test_id(260,4),'retry after a lost response');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(260,4))='active' AND (SELECT state FROM payments WHERE stage_id=test_id(260,4) AND direction='in')='funded'
 AND (SELECT count(*) FROM stage_credit_confirmations WHERE stage_id=test_id(260,4))=1
 AND (SELECT count(*) FROM project_audit_log WHERE project_id=test_id(260) AND action='funding.carried_credit_confirmed')=1,
 'the contractor accepts carried credit once and the stage opens');
SELECT test_assert(test_num(test_totals(260,4),'carried_in')=12000 AND test_num(test_totals(260,4),'remaining')=48000 AND NOT coalesce((test_totals(260,4)->>'can_confirm_credit')::boolean,false),
 'the credit stays attached to the stage after its tranche reads as funded');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(260,4);
SELECT test_assert((SELECT status='pending_review' AND review_payment_pending FROM project_stages WHERE id=test_id(260,4)),
 'work begun on partial credit waits for its balance like work begun on a partial receipt');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT authorize_stage_progression(test_id(260,4),test_totals(260,4)->>'hash','Balance payable before close-out');

-- ── The final stage is complete, money is owed: the project stays open ──
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(260,4))='complete' AND (SELECT status FROM projects WHERE id=test_id(260))='active',
 'the last stage completes but a project with a balance is not closed');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(260) AND action='project.closeout_blocked')=1,'the held close-out is recorded');
SELECT test_assert((project_closeout_context(test_id(260))->>'all_stages_complete')::boolean AND (project_closeout_context(test_id(260))->>'outstanding')::numeric=48000
 AND NOT (project_closeout_context(test_id(260))->>'can_close')::boolean AND project_closeout_context(test_id(260))->>'currency'='XAF'
 AND jsonb_array_length(project_closeout_context(test_id(260))->'stages')=1 AND (project_closeout_context(test_id(260))->'stages'->0->>'stage_number')::int=4,
 'close-out names the stage and the amount still owed');
SELECT test_refused($q$SELECT close_project(test_id(260))$q$,'closeout_balance_outstanding');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT close_project(test_id(260))$q$,'closeout_balance_outstanding');
SELECT test_plan_send(260,4,1,80);
SELECT test_refused($q$SELECT close_project(test_id(260))$q$,'closeout_receipt_pending');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(260,4,1,'record');
SELECT test_assert((project_closeout_context(test_id(260))->>'outstanding')::numeric=0 AND (project_closeout_context(test_id(260))->>'can_close')::boolean
 AND (SELECT status FROM projects WHERE id=test_id(260))='active','paying the balance makes closing possible without closing by itself');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000003',false);
SELECT test_refused($q$SELECT close_project(test_id(260))$q$,'project_access_required');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT close_project(test_id(260));
SELECT close_project(test_id(260));
SELECT test_assert((SELECT status FROM projects WHERE id=test_id(260))='completed' AND (project_closeout_context(test_id(260))->>'closed')::boolean
 AND (SELECT count(*) FROM project_audit_log WHERE project_id=test_id(260) AND action='project.closed')=1,'the client closes a settled project once');

-- ── 261: older debt first, then a project with nothing owed still completes by itself ──
SELECT save_stage_payment_plan(test_id(261,3),'full',NULL,test_totals(261,3)->>'hash');
SELECT test_plan_send(261,3,1,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(261,3,1,'accept');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(261,3);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT authorize_stage_progression(test_id(261,3),test_totals(261,3)->>'hash','Agreed balance payable later');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(261,3))='complete' AND test_num(test_totals(261,3),'remaining')=30000,'the earlier stage proceeds with a recorded balance');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(261,4,1,150);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(261,4,1,'accept');
SELECT test_assert(test_num(test_totals(261,3),'remaining')=0 AND test_num(test_totals(261,3),'carried_in')=30000 AND test_num(test_totals(261,3),'received')=60000,
 'a later overpayment settles the older balance first');
SELECT test_assert(test_num(test_totals(261,4),'carried_out')=30000 AND test_num(test_totals(261,4),'unused_credit')=0 AND test_num(test_totals(261,4),'remaining')=0,
 'the paying stage reports where its excess went');
SELECT test_assert((project_closeout_context(test_id(261))->>'outstanding')::numeric=0,'nothing is owed once the excess has settled the debt');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(261,4);
SELECT test_assert((SELECT status FROM projects WHERE id=test_id(261))='completed' AND NOT EXISTS(SELECT 1 FROM project_audit_log WHERE project_id=test_id(261) AND action='project.closeout_blocked'),
 'a fully paid project still completes on its final approval, as before');

-- ── 262: flagged money never carries; credit nobody needs is reported, not lost ──
SELECT save_stage_payment_plan(test_id(262,3),'full',NULL,test_totals(262,3)->>'hash');
SELECT test_plan_send(262,3,1,130);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT decide_stage_payment_receipt((SELECT id FROM stage_payment_receipts WHERE path=test_path(262,3,1)),'flag','Not received in my account');
SELECT test_assert(test_num(test_totals(262,4),'carried_in')=0 AND test_num(test_totals(262,3),'remaining')=60000,'a flagged receipt carries nothing');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(262,3,2,130);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(262,3,2,'accept');
SELECT test_assert(test_num(test_totals(262,4),'carried_in')=18000 AND test_num(test_totals(262,4),'remaining')=42000,'the confirmed replacement carries its own excess');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(262,3);
SELECT test_plan_send(262,4,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(262,4,1,'accept');
SELECT test_assert(test_num(test_totals(262,4),'carried_in')=0 AND test_num(test_totals(262,4),'remaining')=0 AND test_num(test_totals(262,4),'received')=60000,
 'a stage paid in full by its own receipts takes no credit');
SELECT test_assert(test_num(test_totals(262,3),'unused_credit')=18000 AND test_num(test_totals(262,3),'carried_out')=0 AND (project_closeout_context(test_id(262))->>'outstanding')::numeric=0,
 'credit that no stage needs stays visible on the stage that holds it');

-- ── 263: reviewed work waiting for its balance is settled by money confirmed elsewhere ──
-- A later stage cannot take receipts while this one is open, so the money can only come
-- from an earlier, finished stage: a late receipt there that turns out to be more than
-- that stage needed.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(263,3);
SELECT test_plan_send(263,3,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(263,3,1,'accept');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(263,3))='complete' AND (SELECT status FROM project_stages WHERE id=test_id(263,4))='active','the paid stage completes and the next opens');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(263,4);
SELECT test_plan_send(263,4,1,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(263,4,1,'accept');
SELECT test_assert((SELECT status='pending_review' AND review_payment_pending FROM project_stages WHERE id=test_id(263,4)) AND test_num(test_totals(263,4),'remaining')=30000,
 'reviewed work waits for the rest of its payment');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_plan_send(263,3,2,50);
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(263,4))='pending_review' AND test_num(test_totals(263,4),'remaining')=30000,'the unconfirmed late receipt settles nothing');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(263,3,2,'record');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(263,4))='complete' AND test_num(test_totals(263,4),'remaining')=0 AND test_num(test_totals(263,4),'carried_in')=30000
 AND test_num(test_totals(263,3),'carried_out')=30000,'confirming money on the earlier stage finishes the stage that was waiting for it');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(263) AND action='stage.payment_settled' AND entity_id=test_id(263,4))=1
 AND (SELECT status FROM projects WHERE id=test_id(263))='completed','the settlement is recorded once and the fully paid project completes');

-- ── 264: carried credit follows a stage price the client later approves ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT save_stage_payment_plan(test_id(264,3),'full',NULL,test_totals(264,3)->>'hash');
SELECT test_plan_send(264,3,1,120);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(264,3,1,'accept');
SELECT test_assert(test_num(test_totals(264,4),'carried_in')=12000 AND test_num(test_totals(264,4),'remaining')=48000,'the excess is credited to the next stage at its current price');
SELECT test_price_propose(264,4,'72000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(264) AND status='pending';
SELECT test_assert(test_num(test_totals(264,4),'stage_amount')=72000 AND test_num(test_totals(264,4),'carried_in')=12000 AND test_num(test_totals(264,4),'remaining')=60000,
 'a raised price keeps the credit and raises only what is still owed');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(264,4,'6000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(264) AND status='pending';
SELECT test_assert(test_num(test_totals(264,4),'stage_amount')=6000 AND test_num(test_totals(264,4),'carried_in')=6000 AND test_num(test_totals(264,4),'remaining')=0,
 'a lowered price takes only the credit it needs');
SELECT test_assert(test_num(test_totals(264,3),'carried_out')=6000 AND test_num(test_totals(264,3),'unused_credit')=6000,'the rest of the excess stays as credit on the stage that holds it');

-- ── Nothing outside these projects moved ──
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM carry_stages_before b JOIN project_stages s ON s.id=b.id WHERE to_jsonb(s)<>b.saved),'no existing stage was changed by the migration or these cases');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM carry_projects_before b JOIN projects p ON p.id=b.id WHERE p.status<>b.status),'no existing project changed status');
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE data->>'financial_event'='carried_credit_confirmed' AND user_id='00000000-0000-0000-0000-000000000001' AND body LIKE 'Your contractor accepted%'),
 'the client is told when carried money is accepted');
SELECT 'OVERPAYMENT_CLOSEOUT_OK' AS result;
