-- Paying a split stage part by part (20261118000100). Stage 3 is 60,000 XAF, split 30,000 / 30,000.
-- 50 USD is 30,000 XAF at 600.
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_price_start(273),test_price_start(274),test_price_start(275,'boq','contractor'),test_price_start(276);
UPDATE project_substages sub SET project_id=s.project_id,substage_number=right(sub.id::text,1)::int,name='Part '||right(sub.id::text,1),
 evidence_urls=CASE WHEN s.stage_number>=3 THEN '[]'::jsonb ELSE sub.evidence_urls END
 FROM project_stages s WHERE s.id=sub.stage_id AND s.project_id IN(test_id(273),test_id(274),test_id(275),test_id(276));
CREATE FUNCTION public.test_split(n int) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
 PERFORM test_bd_propose(n,3,'30000','30000');
 PERFORM set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
 PERFORM decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(n,3) AND status='pending'),'approved');
END $$;
CREATE FUNCTION public.test_part_send(n int,part int,f int,usd numeric) RETURNS jsonb LANGUAGE sql AS $$
 SELECT submit_substage_receipt(test_sub(n,3,part),test_path(n,3,f),usd,'USD',1,test_proof(n,3,f,usd)) $$;
CREATE FUNCTION public.test_parts(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT substage_payment_context(test_id(n,3))->'parts' $$;
CREATE FUNCTION public.test_upload(n int,part int) RETURNS void LANGUAGE sql AS $$
 UPDATE project_substages SET evidence_urls='["work.jpg"]' WHERE id=test_sub(n,3,part) $$;
SET ROLE authenticated;

-- ── 273: the whole journey on a client-created project ──
SELECT test_split(273);
SELECT test_assert((substage_payment_context(test_id(273,3))->>'split')::boolean AND substage_payment_context(test_id(273,3))->>'next_payable'=test_sub(273,3,1)::text
 AND (test_parts(273)->0->>'payable')::boolean AND NOT (test_parts(273)->1->>'payable')::boolean AND NOT stage_work_ready(test_id(273,3)),
 'only the first part can be paid, and nothing can be worked yet');
SELECT test_refused($q$SELECT save_stage_payment_plan(test_id(273,3),'two_installments',10000,stage_payment_plan_context(test_id(273,3))->>'hash')$q$,'stage_paid_by_part');
SELECT test_refused($q$SELECT test_part_send(273,2,1,50)$q$,'part_not_payable');
SELECT test_refused($q$SELECT test_plan_send(273,3,1,50)$q$,'substage_receipt_required');
SELECT test_part_send(273,1,2,50);
SELECT test_assert((SELECT substage_id FROM stage_payment_receipts WHERE path=test_path(273,3,2))=test_sub(273,3,1)
 AND (test_parts(273)->0->>'pending')::numeric=30000 AND NOT (test_parts(273)->0->>'paid')::boolean,'the receipt is filed under its part and waits for the contractor');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(273,3,2,'accept');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(273,3))='active' AND (test_parts(273)->0->>'work_ready')::boolean
 AND NOT (test_parts(273)->1->>'work_ready')::boolean AND NOT (test_parts(273)->1->>'payable')::boolean,
 'the accepted first part opens the stage for that part only');
RESET ROLE;
SELECT test_refused($q$SELECT test_upload(273,2)$q$,'part_not_paid');
SELECT test_upload(273,1);
SELECT test_refused($q$UPDATE stage_payment_receipts SET substage_id=test_sub(273,3,2) WHERE path=test_path(273,3,2)$q$,'receipt_');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT approve_substage(test_sub(273,3,1));
SELECT test_assert((test_parts(273)->1->>'payable')::boolean AND NOT (test_parts(273)->1->>'work_ready')::boolean,'approving the first part opens payment for the second');
SELECT test_part_send(273,2,3,50);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(273,3,3,'record');
SELECT test_assert((test_parts(273)->1->>'work_ready')::boolean,'a recorded payment covers the second part');
RESET ROLE;
SELECT test_upload(273,2);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT approve_substage(test_sub(273,3,2));
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(273,3))='complete' AND (stage_payment_plan_context(test_id(273,3))->>'remaining')::numeric=0,
 'a stage paid part by part completes like any settled stage');

-- ── 274: confirmed money covers the parts in order ──
SELECT test_split(274);
SELECT test_part_send(274,1,1,90);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(274,3,1,'accept');
SELECT test_assert((test_parts(274)->0->>'covered')::numeric=30000 AND (test_parts(274)->1->>'covered')::numeric=24000 AND (test_parts(274)->1->>'remaining')::numeric=6000
 AND NOT (test_parts(274)->1->>'work_ready')::boolean,'an overpayment counts toward the next part, which still waits for the first to be approved');

-- ── 275: a contractor-created project pays a split stage ahead too ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_assert(stage_starts_with_evidence(test_id(275,3)),'an unsplit stage of a contractor-created project still starts with evidence');
SELECT test_split(275);
SELECT test_assert(NOT stage_starts_with_evidence(test_id(275,3)) AND NOT stage_work_ready(test_id(275,3)),'once split, the stage is paid ahead');
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_upload(275,1)$q$,'not_paid');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_part_send(275,1,1,50);
SELECT test_assert((SELECT count(*) FROM stage_payment_receipts WHERE stage_id=test_id(275,3) AND substage_id=test_sub(275,3,1))=1,'the client pays the first part before its work');

-- ── 276: an unsplit stage is untouched ──
SELECT test_assert(NOT (substage_payment_context(test_id(276,3))->>'split')::boolean,'an unsplit stage has no parts to pay');
SELECT test_refused($q$SELECT submit_substage_receipt(test_sub(276,3,1),test_path(276,3,1),50,'USD',1,test_proof(276,3,1,50))$q$,'stage_not_split');
SELECT save_stage_payment_plan(test_id(276,3),'two_installments',20000,stage_payment_plan_context(test_id(276,3))->>'hash');
SELECT test_assert((SELECT count(*) FROM stage_payment_plans WHERE stage_id=test_id(276,3) AND mode='two_installments')=1,'installments still work on an unsplit stage');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_bd_propose(276,3,'30000','30000')$q$,'stage_breakdown_locked');
SELECT 'SUBSTAGE_PAYMENTS_OK' AS result;
