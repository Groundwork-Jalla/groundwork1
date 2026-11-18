-- 20261118000300: every revised stage price states what changed and why.
RESET ROLE;
SELECT test_price_start(280);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_refused($q$SELECT propose_stage_prices(test_id(280),jsonb_build_array(jsonb_build_object('stage_id',test_id(280,3),'amount','72000')),stage_pricing_context(test_id(280))->>'base_hash',NULL)$q$,'price_change_reason_required');
SELECT test_refused($q$SELECT propose_stage_prices(test_id(280),jsonb_build_array(jsonb_build_object('stage_id',test_id(280,3),'amount','72000')),stage_pricing_context(test_id(280))->>'base_hash','   ')$q$,'price_change_reason_required');
SELECT test_price_propose(280,3,'72000');
SELECT test_assert((SELECT note='Negotiated materials' AND status='pending' FROM stage_price_amendments WHERE project_id=test_id(280)),
  'a proposal with its reason goes through, reason on record');
RESET ROLE;
SELECT 'PRICE_CHANGE_REASON_OK' AS result;
