-- Sub-stage price breakdowns (20261118000000). Stages 3 and 4 are live at 60,000 XAF.
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_price_start(270),test_price_start(271),test_price_start(272);
UPDATE project_substages sub SET project_id=s.project_id,substage_number=right(sub.id::text,1)::int,name='Seeded part '||right(sub.id::text,1),
 evidence_urls=CASE WHEN s.stage_number>=3 THEN '[]'::jsonb ELSE sub.evidence_urls END
 FROM project_stages s WHERE s.id=sub.stage_id AND s.project_id IN(test_id(270),test_id(271),test_id(272));
CREATE FUNCTION public.test_bd(n int,s int) RETURNS jsonb LANGUAGE sql AS $$ SELECT stage_breakdown_context(test_id(n,s)) $$;
CREATE FUNCTION public.test_bd_propose(n int,s int,a1 text,a2 text,extra jsonb DEFAULT '[]') RETURNS uuid LANGUAGE sql AS $$
 SELECT propose_stage_breakdown(test_id(n,s),jsonb_build_array(jsonb_build_object('substage_id',test_sub(n,s,1),'amount',a1),
  jsonb_build_object('substage_id',test_sub(n,s,2),'amount',a2))||extra,test_bd(n,s)->>'base_hash','Wall in two lifts') $$;
SET ROLE authenticated;

-- ── 270: the contractor proposes, the client approves, a sub-stage is added ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_assert(NOT (test_bd(270,3)->>'split')::boolean AND (test_bd(270,3)->>'editable')::boolean AND (test_bd(270,3)->>'can_decide')::boolean
 AND NOT (test_bd(270,3)->>'can_propose')::boolean AND jsonb_array_length(test_bd(270,3)->'substages')=2 AND test_bd(270,3)->>'stage_amount'='60000.000000',
 'an unsplit stage reads as one price the client may decide on but not propose');
SELECT test_refused($q$SELECT test_bd_propose(270,3,'30000','30000')$q$,'not_primary_contractor');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_assert((test_bd(270,3)->>'can_propose')::boolean AND NOT (test_bd(270,3)->>'can_decide')::boolean,'the primary contractor may propose and not decide');
SELECT test_refused($q$SELECT test_bd_propose(270,3,'30000','20000')$q$,'breakdown_total_mismatch');
SELECT test_refused($q$SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','60000')),test_bd(270,3)->>'base_hash')$q$,'breakdown_incomplete');
SELECT test_refused($q$SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','30000'),jsonb_build_object('substage_id',test_sub(270,3,1),'amount','30000')),test_bd(270,3)->>'base_hash')$q$,'invalid_stage_breakdown');
SELECT test_refused($q$SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,4,1),'amount','30000'),jsonb_build_object('substage_id',test_sub(270,3,2),'amount','30000')),test_bd(270,3)->>'base_hash')$q$,'invalid_stage_breakdown');
SELECT test_refused($q$SELECT test_bd_propose(270,3,'30000','20000',jsonb_build_array(jsonb_build_object('name','  ','amount','10000')))$q$,'invalid_stage_breakdown');
SELECT test_refused($q$SELECT test_bd_propose(270,3,'-1','60001')$q$,'invalid_stage_breakdown');
SELECT test_refused($q$SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','30000'),jsonb_build_object('substage_id',test_sub(270,3,2),'amount','30000')),'old snapshot')$q$,'stale_stage_breakdown');
SELECT test_bd_propose(270,3,'20000','30000',jsonb_build_array(jsonb_build_object('name','Fence while the permit is pending','amount','10000')));
SELECT test_refused($q$SELECT test_bd_propose(270,3,'30000','30000')$q$,'breakdown_proposal_pending');
SELECT test_assert(NOT (test_bd(270,3)->>'split')::boolean AND NOT (test_bd(270,3)->>'can_propose')::boolean
 AND (SELECT count(*) FROM project_substages WHERE stage_id=test_id(270,3))=2 AND (SELECT bool_and(price_amount IS NULL) FROM project_substages WHERE stage_id=test_id(270,3)),
 'a proposal changes nothing on the stage by itself');
SELECT test_refused($q$SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3)),'approved')$q$,'not_project_client');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3)),'withdrawn')$q$,'not_proposer');
SELECT test_assert((SELECT count(*) FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000001' AND type='project.breakdown_proposed')=1,'the client is told a breakdown is waiting');
SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3)),'approved');
SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3)),'approved');
SELECT test_assert((test_bd(270,3)->>'split')::boolean AND (SELECT price_amount FROM project_substages WHERE id=test_sub(270,3,1))=20000
 AND (SELECT price_amount FROM project_substages WHERE id=test_sub(270,3,2))=30000
 AND (SELECT count(*) FROM project_substages WHERE stage_id=test_id(270,3) AND added_by_breakdown IS NOT NULL AND name='Fence while the permit is pending'
  AND price_amount=10000 AND substage_number=3 AND status='locked' AND project_id=test_id(270))=1,
 'approval prices every sub-stage and adds the new one after the existing ones');
SELECT test_assert((SELECT paid_by_part FROM project_stages WHERE id=test_id(270,3)) AND NOT (SELECT paid_by_part FROM project_stages WHERE id=test_id(270,4)),
 'the stage row says it is paid by part');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(270) AND action IN('stage_breakdown.proposed','stage_breakdown.approved'))=2,
 'the proposal and the approval are each recorded once');
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000002' AND type='project.breakdown_approved' AND data->>'stage_id'=test_id(270,3)::text)=1
 AND NOT EXISTS(SELECT 1 FROM notifications WHERE user_id='00000000-0000-0000-0000-000000000001' AND type='project.breakdown_approved'),'the contractor is told it was approved; the client who approved is not');
SET ROLE authenticated;
SELECT test_assert((SELECT sum(milestone_amount) FROM project_stages WHERE project_id=test_id(270))=180000 AND (SELECT milestone_amount FROM project_stages WHERE id=test_id(270,3))=60000,
 'a breakdown never changes the stage price or the project total');

-- Nothing writes a price outside the breakdown: checked as the table owner, past every policy.
RESET ROLE;
SELECT test_refused($q$UPDATE project_substages SET price_amount=1 WHERE id=test_sub(270,3,1)$q$,'stage_breakdown_requires_approval');
SELECT test_refused($q$INSERT INTO project_substages(id,stage_id,status) VALUES(gen_random_uuid(),test_id(270,3),'locked')$q$,'stage_breakdown_requires_approval');
SELECT test_refused($q$INSERT INTO project_substages(id,stage_id,status,price_amount) VALUES(gen_random_uuid(),test_id(270,4),'locked',5)$q$,'stage_breakdown_requires_approval');
SELECT test_refused($q$DELETE FROM project_substages WHERE id=test_sub(270,3,2)$q$,'stage_breakdown_requires_approval');
SELECT test_refused($q$UPDATE stage_breakdown_proposals SET lines='[]' WHERE stage_id=test_id(270,3)$q$,'breakdown_proposal_immutable');
SELECT test_refused($q$UPDATE project_stages SET paid_by_part=false WHERE id=test_id(270,3)$q$,'stage_breakdown_requires_approval');
SET ROLE authenticated;

-- A revision keeps the history and is again the client's decision.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','20000'),jsonb_build_object('substage_id',test_sub(270,3,2),'amount','30000'),jsonb_build_object('substage_id',(SELECT id FROM project_substages WHERE stage_id=test_id(270,3) AND substage_number=3),'amount','10000')),test_bd(270,3)->>'base_hash')$q$,'no_breakdown_changes');
SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','25000'),jsonb_build_object('substage_id',test_sub(270,3,2),'amount','25000'),jsonb_build_object('substage_id',(SELECT id FROM project_substages WHERE stage_id=test_id(270,3) AND substage_number=3),'amount','10000')),test_bd(270,3)->>'base_hash');
SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3) AND status='pending'),'withdrawn');
SELECT test_assert((SELECT count(*) FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3))=2 AND jsonb_array_length(test_bd(270,3)->'history')=2
 AND test_bd(270,3)->'history'->0->>'status'='withdrawn' AND (SELECT price_amount FROM project_substages WHERE id=test_sub(270,3,1))=20000,
 'a withdrawn revision stays in the history and changes nothing');
SELECT propose_stage_breakdown(test_id(270,3),jsonb_build_array(jsonb_build_object('substage_id',test_sub(270,3,1),'amount','25000'),jsonb_build_object('substage_id',test_sub(270,3,2),'amount','25000'),jsonb_build_object('substage_id',(SELECT id FROM project_substages WHERE stage_id=test_id(270,3) AND substage_number=3),'amount','10000')),test_bd(270,3)->>'base_hash');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3) AND status='pending'),'declined');
SELECT test_assert((SELECT price_amount FROM project_substages WHERE id=test_sub(270,3,1))=20000 AND (test_bd(270,3)->>'split')::boolean,'a declined revision keeps the approved breakdown');

-- ── 271: a new stage price clears a breakdown that no longer adds up ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_bd_propose(271,4,'40000','20000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(271,4)),'approved');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(271,3,'66000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices((SELECT id FROM stage_price_amendments WHERE project_id=test_id(271) AND status='pending'),'approved');
SELECT test_assert((test_bd(271,4)->>'split')::boolean AND (SELECT price_amount FROM project_substages WHERE id=test_sub(271,4,1))=40000,
 'repricing another stage leaves this breakdown alone');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(271,4,'72000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices((SELECT id FROM stage_price_amendments WHERE project_id=test_id(271) AND status='pending'),'approved');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT test_assert(NOT (test_bd(271,4)->>'split')::boolean AND NOT (SELECT paid_by_part FROM project_stages WHERE id=test_id(271,4)) AND (SELECT bool_and(price_amount IS NULL) FROM project_substages WHERE stage_id=test_id(271,4))
 AND (SELECT count(*) FROM project_audit_log WHERE project_id=test_id(271) AND action='stage_breakdown.cleared')=1 AND test_bd(271,4)->>'stage_amount'='72000.000000',
 'a new stage price clears the breakdown it no longer matches, and says so');

-- ── 272: a paid stage keeps its breakdown; a stale proposal cannot be approved ──
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_bd_propose(272,4,'10000','50000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
RESET ROLE;
SELECT set_config('app.substage_pricing_write','on',false);
UPDATE project_substages SET name='Renamed by admin' WHERE id=test_sub(272,4,1);
SELECT set_config('app.substage_pricing_write','off',false);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_refused($q$SELECT decide_stage_breakdown((SELECT id FROM stage_breakdown_proposals WHERE stage_id=test_id(272,4)),'approved')$q$,'stale_stage_breakdown');
SELECT test_assert((test_bd(272,4)->'history'->0->>'stale')::boolean,'the client sees that the proposal is out of date');
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
UPDATE project_substages SET evidence_urls='["early.jpg"]' WHERE id=test_sub(271,3,1);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_assert(NOT (test_bd(271,3)->>'editable')::boolean,'work uploaded on any part closes the breakdown');
SELECT save_stage_payment_plan(test_id(272,3),'full',NULL,stage_payment_plan_context(test_id(272,3))->>'hash');
SELECT test_plan_send(272,3,1,50);
SELECT test_assert(NOT (test_bd(272,3)->>'editable')::boolean AND NOT (test_bd(272,3)->>'can_decide')::boolean,'a stage with a receipt keeps its price breakdown');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_bd_propose(272,3,'30000','30000')$q$,'stage_breakdown_locked');

-- A cascade still runs through priced sub-stages: the stub's keys do not cascade, so the
-- order Postgres would use is replayed by hand: proposals, then the stage, then its rows.
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
ALTER TABLE project_stages DISABLE TRIGGER USER;
DELETE FROM stage_breakdown_proposals WHERE stage_id=test_id(270,3);
SELECT test_assert((SELECT count(*) FROM project_substages WHERE stage_id=test_id(270,3) AND price_amount IS NOT NULL)=3,'removing a proposal leaves the approved prices in place');
SELECT test_refused($q$DELETE FROM project_substages WHERE stage_id=test_id(270,3)$q$,'stage_breakdown_requires_approval');
DELETE FROM project_stages WHERE id=test_id(270,3);
DELETE FROM project_substages WHERE stage_id=test_id(270,3);
ALTER TABLE project_stages ENABLE TRIGGER USER;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM project_substages WHERE stage_id=test_id(270,3)),'a deleted stage takes its priced sub-stages with it');
SELECT 'STAGE_BREAKDOWN_OK' AS result;
