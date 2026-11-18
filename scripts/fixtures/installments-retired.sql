-- 20261118000200: no stage starts two installments; a stage already on them keeps them.
-- Runs after substage-payments.sql, whose project 276 put stage 3 on two installments
-- BEFORE the retirement migration — the shape every live plan in production has.
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;

-- A plan already on two installments can still be revised.
SELECT save_stage_payment_plan(test_id(276,3),'two_installments',25000,stage_payment_plan_context(test_id(276,3))->>'hash');
SELECT test_assert((SELECT mode='two_installments' AND first_amount=25000 FROM stage_payment_plans
  WHERE stage_id=test_id(276,3) AND superseded_at IS NULL),'an existing installment plan can still be revised');

-- …and turned back into full payment.
SELECT save_stage_payment_plan(test_id(276,3),'full',NULL,stage_payment_plan_context(test_id(276,3))->>'hash');
SELECT test_assert((SELECT mode='full' FROM stage_payment_plans WHERE stage_id=test_id(276,3) AND superseded_at IS NULL),
  'an installment plan can be turned into full payment');

-- Once it has left, it cannot start again.
SELECT test_refused($q$SELECT save_stage_payment_plan(test_id(276,3),'two_installments',20000,stage_payment_plan_context(test_id(276,3))->>'hash')$q$,'installments_retired');
SELECT test_assert((SELECT mode='full' FROM stage_payment_plans WHERE stage_id=test_id(276,3) AND superseded_at IS NULL),
  'the refused split left the full plan in place');

-- Full payment is always allowed, again and again.
SELECT save_stage_payment_plan(test_id(276,3),'full',NULL,stage_payment_plan_context(test_id(276,3))->>'hash');

-- Earlier installment rows are history and are never rewritten.
SELECT test_assert((SELECT count(*) FROM stage_payment_plans WHERE stage_id=test_id(276,3) AND mode='two_installments')=2,
  'both earlier installment plans are kept on record');
RESET ROLE;
SELECT 'INSTALLMENTS_RETIRED_OK' AS result;
