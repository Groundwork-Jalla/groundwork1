RESET ROLE;
CREATE FUNCTION public.test_price_start(n int,p_source text DEFAULT 'boq',p_origin text DEFAULT 'client') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO projects(id,user_id,country,budget_source,budget_currency,budget_fx_rate,budget_amount,budget_usd,budget_precision,current_stage,workflow_origin)
 VALUES(test_id(n),CASE WHEN p_origin='contractor' THEN '00000000-0000-0000-0000-000000000002'::uuid ELSE '00000000-0000-0000-0000-000000000001'::uuid END,'CM',p_source,'XAF',600,180000,300,0,3,p_origin);
 INSERT INTO contractor_invites(project_id,status,contractor_user_id,is_primary) VALUES(test_id(n),'accepted','00000000-0000-0000-0000-000000000002',true);
 IF p_origin='contractor' THEN INSERT INTO project_viewers VALUES(test_id(n),'00000000-0000-0000-0000-000000000001',true,now(),NULL); END IF;
 INSERT INTO project_stages(id,project_id,stage_number,status,pre_existing,budget_pct,payment_milestone_usd,milestone_amount,fixed_amount_usd)
 VALUES(test_id(n,1),test_id(n),1,'complete',true,0,0,0,0),
 (test_id(n,2),test_id(n),2,'complete',true,33.333334,100,60000,NULL),
 (test_id(n,3),test_id(n),3,'locked',false,33.333333,CASE WHEN p_source='boq' THEN 100 ELSE 80 END,CASE WHEN p_source='boq' THEN 60000 ELSE 48000 END,NULL),
 (test_id(n,4),test_id(n),4,'locked',false,33.333333,100,60000,NULL);
 INSERT INTO project_substages(id,stage_id,status,evidence_urls) SELECT test_sub(n,s,k),test_id(n,s),CASE WHEN s<3 THEN 'complete' ELSE 'locked' END,'["proof.jpg"]'::jsonb FROM generate_series(1,4) s CROSS JOIN generate_series(1,2) k;
 INSERT INTO project_fees VALUES(test_id(n),'professional',CASE WHEN p_source='boq' THEN 0 ELSE 20 END);
 UPDATE projects SET tracking_started_at=now() WHERE id=test_id(n);
 PERFORM open_stage_if_settled(test_id(n,3));
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
-- A native total can have decimals even when the newly entered stage price is whole.
SELECT test_price_start(95,'estimate');
UPDATE projects SET country='GB',budget_usd=300.5 WHERE id=test_id(95);
UPDATE project_stages SET payment_milestone_usd=80.5 WHERE id=test_id(95,3);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(95,4,'80');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(95);
SELECT test_assert((SELECT budget_currency='GBP' AND budget_fx_rate=0.79 AND budget_amount=238.395 AND budget_precision>=3 FROM projects WHERE id=test_id(95)),'an integer stage edit preserves pre-existing native budget decimals and freezes its currency');
SELECT test_assert((SELECT milestone_amount=79 AND payment_milestone_usd=100 FROM project_stages WHERE id=test_id(95,2)),'estimated historical USD fact remains unchanged and receives the same native conversion reviewed by the client');
RESET ROLE;
-- Both creator workflows still run after the price-approval guards are installed.
SELECT test_price_start(96),test_price_start(97,'boq','contractor');
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(96,4,'66000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(96);
SELECT test_send(96,3,1,100);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(96,3,1,'accept');
SELECT test_assert(stage_work_ready(test_id(96,3)),'client-created build still requires contractor receipt confirmation before work');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_finish(96,3);
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(96,3))='complete' AND (SELECT status FROM project_stages WHERE id=test_id(96,4))='locked','client-created progression remains sequential after a revised future price');
SELECT test_finish(97,3);
SELECT test_assert((SELECT review_payment_pending FROM project_stages WHERE id=test_id(97,3)),'contractor-created build still reviews its first live work before payment');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(97,3,'72000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(97);
SELECT test_assert((SELECT review_payment_pending AND status='pending_review' FROM project_stages WHERE id=test_id(97,3)),'price approval alone does not settle the reviewed first stage');
SELECT test_send(97,3,1,120);
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_decide(97,3,1,'accept');
SELECT test_assert((SELECT status FROM project_stages WHERE id=test_id(97,3))='complete' AND (SELECT current_stage FROM projects WHERE id=test_id(97))=4 AND (SELECT status FROM project_stages WHERE id=test_id(97,4))='locked','revised same-stage receipt completes contractor-created reviewed work and selects the correct next stage');
-- Account correction cannot promote an existing project client into its contractor.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT admin_set_account_type('00000000-0000-0000-0000-000000000001','contractor','client');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_assert(is_project_client(test_id(91)) AND NOT is_primary_project_contractor(test_id(91)),'converted contractor account retains its primary-client role on its existing project');
SELECT test_assert((SELECT budget_amount=180000.25 FROM projects WHERE id=test_id(91)),'conversion leaves its owned project budget intact');
SELECT test_refused($q$SELECT test_price_propose(91,4,'49000')$q$,'not_primary_contractor');
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(94) AND status='pending';
SELECT test_assert((SELECT budget_amount=186000 FROM projects WHERE id=test_id(94)),'converted account can still approve as the project client');
RESET ROLE;
SELECT 'STAGE_PRICING_OK';
