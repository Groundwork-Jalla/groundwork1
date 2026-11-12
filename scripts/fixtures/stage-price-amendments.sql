RESET ROLE;
CREATE FUNCTION public.test_price_start(n int,p_source text DEFAULT 'boq') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,budget_precision,current_stage,workflow_origin)
 VALUES(test_id(n),'00000000-0000-0000-0000-000000000001','CM',p_source,'XAF',600,180000,300,0,3,'client');
 INSERT INTO contractor_invites(project_id,status,contractor_user_id,is_primary) VALUES(test_id(n),'accepted','00000000-0000-0000-0000-000000000002',true);
 INSERT INTO project_stages(id,project_id,stage_number,status,pre_existing,budget_pct,payment_milestone_usd,milestone_amount,fixed_amount_usd)
 VALUES(test_id(n,1),test_id(n),1,'complete',true,0,0,0,0),
 (test_id(n,2),test_id(n),2,'complete',true,33.333334,100,60000,NULL),
 (test_id(n,3),test_id(n),3,'locked',false,33.333333,CASE WHEN p_source='boq' THEN 100 ELSE 80 END,CASE WHEN p_source='boq' THEN 60000 ELSE 48000 END,NULL),
 (test_id(n,4),test_id(n),4,'locked',false,33.333333,100,60000,NULL);
 INSERT INTO project_fees VALUES(test_id(n),'professional',CASE WHEN p_source='boq' THEN 0 ELSE 20 END);
 UPDATE projects SET tracking_started_at=now() WHERE id=test_id(n);
END $$;
CREATE FUNCTION public.test_price_propose(n int,s int,amount text) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
 RETURN propose_stage_prices(test_id(n),jsonb_build_array(jsonb_build_object('stage_id',test_id(n,s),'amount',amount)),stage_pricing_context(test_id(n))->>'base_hash','Negotiated materials');
END $$;
SELECT test_price_start(91),test_price_start(92,'estimate'),test_price_start(93),test_price_start(94);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_price_propose(91,1,'1')$q$,'stage_price_locked');
SELECT test_refused($q$SELECT test_price_propose(91,2,'70000')$q$,'stage_price_locked');
SELECT test_refused($q$SELECT test_price_propose(91,3,'0')$q$,'invalid_stage_prices');
SELECT test_price_propose(91,3,'72000.125');
SELECT test_assert((SELECT budget_amount FROM projects WHERE id=test_id(91))=180000,'proposing prices leaves the agreed budget intact');
SELECT test_refused($q$SELECT test_price_propose(91,4,'66000')$q$,'price_proposal_pending');
SELECT test_refused($q$SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(91)$q$,'not_project_client');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000006',false);
SELECT test_assert((SELECT count(*) FROM stage_price_amendments)=0,'unrelated account sees no proposals');
SELECT test_refused($q$SELECT stage_pricing_context(test_id(91))$q$,'project_access_required');
SELECT test_refused($q$SELECT propose_stage_prices(test_id(91),'[]','fake')$q$,'not_primary_contractor');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(91);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(91);
SELECT test_assert((SELECT budget_amount=192000.125 AND budget_original_amount=180000 AND pricing_revision=1 FROM projects WHERE id=test_id(91)),'client-approved increase preserves original bill and applies exactly once');
SELECT test_assert((SELECT sum(milestone_amount) FROM project_stages WHERE project_id=test_id(91))=192000.125,'revised native stages sum exactly to revised budget');
SELECT test_assert((SELECT sum(payment_milestone_usd) FROM project_stages WHERE project_id=test_id(91))=(SELECT budget_usd FROM projects WHERE id=test_id(91)),'revised USD schedule reconciles exactly');
SELECT test_assert((SELECT milestone_amount=60000 AND payment_milestone_usd=100 AND status='complete' FROM project_stages WHERE id=test_id(91,2)),'historical values and status retained');
SELECT test_assert((SELECT milestone_amount=0 AND payment_milestone_usd=0 FROM project_stages WHERE id=test_id(91,1)),'rule-zero stays zero');
SELECT test_assert((SELECT amount FROM payments WHERE stage_id=test_id(91,3) AND direction='in')=120,'unfunded ledger expectation follows the approved price without inventing a receipt');
SELECT test_assert((SELECT sum(amount_usd) FROM project_fees WHERE project_id=test_id(91))=0,'BOQ fees remain zero after revision');
RESET ROLE;
SELECT test_refused($q$INSERT INTO projects(id,pricing_revision) VALUES(test_id(99),1)$q$,'prices_require_client_approval');
SELECT test_refused($q$UPDATE projects SET budget_amount=1 WHERE id=test_id(91)$q$,'prices_require_client_approval');
SELECT test_refused($q$UPDATE project_stages SET milestone_amount=1 WHERE id=test_id(91,3)$q$,'prices_require_client_approval');
SELECT test_refused($q$UPDATE stage_price_amendments SET new_total=1 WHERE project_id=test_id(91)$q$,'price_proposal_immutable');
SELECT test_refused($q$INSERT INTO project_stages(id,project_id) VALUES(test_id(91,5),test_id(91))$q$,'prices_require_client_approval');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(91,4,'48000.125');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(91) AND status='pending';
SELECT test_assert((SELECT budget_amount=180000.25 AND budget_original_amount=180000 AND pricing_revision=2 FROM projects WHERE id=test_id(91)),'later decreases preserve first original budget');
-- A receipt arriving during client review invalidates the price proposal.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(93,3,'72000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT submit_stage_payment_receipt(test_id(93,3),test_path(93,3,1),100,'USD',1,test_proof(93,3,1,100));
SELECT test_refused($q$SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(93)$q$,'stale_stage_prices');
SELECT decide_stage_prices(id,'declined') FROM stage_price_amendments WHERE project_id=test_id(93);
SELECT test_assert((SELECT budget_amount FROM projects WHERE id=test_id(93))=180000,'declined or stale proposal changes no prices');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT test_price_propose(93,3,'72000')$q$,'stage_price_locked');
SELECT test_price_propose(94,4,'66000');
SELECT decide_stage_prices(id,'withdrawn') FROM stage_price_amendments WHERE project_id=test_id(94);
SELECT test_price_propose(94,4,'66000');
-- Estimates retain their own stored fees rather than acquiring BOQ fee waivers.
SELECT test_price_propose(92,3,'72000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(92);
SELECT test_assert((SELECT budget_usd=340 AND budget_amount=204000 AND (pricing_budget_breakdown->>'construction')::numeric=320 AND (pricing_budget_breakdown->>'professional')::numeric=20 FROM projects WHERE id=test_id(92)),'estimate variation uses revised construction and preserved existing fees');
SELECT test_assert((SELECT count(*) FROM project_audit_log WHERE project_id=test_id(91) AND action='stage_prices.approved')=2,'each approval recorded once');
RESET ROLE;
SELECT 'STAGE_PRICING_OK';
