RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects WHERE budget_fx_recorded_at IS NOT NULL),'migration does not invent historical budget-rate dates');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM projects p JOIN currency_projects_before b USING(id) WHERE to_jsonb(p)-'budget_fx_recorded_at' IS DISTINCT FROM b.saved),'adding rate metadata changes no saved project values');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM stage_payment_receipts r JOIN currency_receipts_before b USING(id) WHERE to_jsonb(r)-'project_fx_recorded_at' IS DISTINCT FROM b.saved),'adding rate metadata changes no receipt conversions or history');

SELECT set_config('test.actor','00000000-0000-0000-0000-000000000004',false);
SELECT test_price_start(161),test_price_start(162,'estimate');
SELECT test_assert((SELECT budget_fx_recorded_at IS NOT NULL AND budget_fx_recorded_at<=clock_timestamp() FROM projects WHERE id=test_id(161)),'new currency basis gets a server save time');
CREATE TEMP TABLE currency_saved_date AS SELECT id,budget_fx_recorded_at FROM projects WHERE id IN(test_id(161),test_id(162));
UPDATE projects SET budget_fx_recorded_at='2000-01-01',name='Same conversion' WHERE id=test_id(161);
SELECT test_assert((SELECT p.budget_fx_recorded_at=d.budget_fx_recorded_at FROM projects p JOIN currency_saved_date d USING(id) WHERE p.id=test_id(161)),'an unrelated edit cannot fabricate or refresh the conversion save time');

SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT test_send(161,3,1,10);
SELECT test_assert((SELECT r.project_fx_rate=600 AND r.project_amount=6000 AND r.project_fx_recorded_at=p.budget_fx_recorded_at FROM stage_payment_receipts r JOIN projects p ON p.id=r.project_id WHERE r.path=test_path(161,3,1)),'USD receipt carries its saved XAF budget rate and save time');
RESET ROLE;
CREATE TEMP TABLE currency_receipt_snapshot AS SELECT to_jsonb(r) AS saved FROM stage_payment_receipts r WHERE path=test_path(161,3,1);
SELECT attach_receipt_conversion((SELECT reading_id FROM stage_payment_receipts WHERE path=test_path(161,3,1)),9,'EUR',999,'ExchangeRate-API',clock_timestamp());
SELECT test_assert((SELECT r.project_fx_rate=600 AND r.project_fx_recorded_at=p.budget_fx_recorded_at FROM receipt_readings r JOIN projects p ON p.id=r.project_id WHERE r.path=test_path(161,3,1)),'retry cannot replace an already saved currency basis or date');
SELECT set_config('app.stage_receipt_write','on',false);
SELECT test_refused($q$UPDATE stage_payment_receipts SET project_fx_recorded_at='2000-01-01' WHERE path=test_path(161,3,1)$q$,'immutable: receipt conversion date');
SELECT set_config('app.stage_receipt_write','off',false);

SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SELECT test_price_propose(162,3,'54000');
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SELECT decide_stage_prices(id,'approved') FROM stage_price_amendments WHERE project_id=test_id(162) AND status='pending';
SELECT test_send(162,3,1,20);
SELECT test_assert((SELECT project_currency='XAF' AND project_fx_rate=600 AND project_amount=12000 AND project_fx_recorded_at IS NOT NULL FROM stage_payment_receipts WHERE path=test_path(162,3,1)),'an approved estimate uses its saved budget basis even if the caller supplies another project currency');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM stage_payment_receipts r,currency_receipt_snapshot s WHERE to_jsonb(r)=s.saved),'later price decisions do not revalue a saved receipt');
SELECT 'CURRENCY_BASIS_OK' AS result;
