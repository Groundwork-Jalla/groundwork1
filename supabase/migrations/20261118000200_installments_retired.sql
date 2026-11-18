-- Two installments are retired; a stage is paid in full, or part by part.
--
-- 17 Nov 2026 (stand-up and afternoon session): paying a stage "in two installments" is
-- replaced by the sub-stage payment flow (20261118000100). A homeowner who wants to pay a
-- stage in parts now gets a price for each part of the work, proposed by the contractor and
-- approved by them, and pays each part before its work. Two installments were an arbitrary
-- cut of the stage price with nothing to say what each half paid for.
--
-- What stops, and what does not:
--   · No stage can START a two-installment plan any more.
--   · A stage whose current plan is already two installments keeps it, exactly as before:
--     it can be revised, accepted or declined, receipts are filed against its installments,
--     and it can be turned back into full payment. Receipts and money already recorded
--     against an installment are never touched. Once a stage leaves two installments it
--     cannot go back.
--
-- This is a trigger rather than a change to save_stage_payment_plan so the rule holds for
-- every writer, and that function's body (and its can_edit / stale-hash checks) is not
-- re-declared here. save_stage_payment_plan supersedes the current plan before inserting
-- the new one, so "the plan this replaces" is the most recent earlier row for the stage.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_installments_retired()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_previous text;
BEGIN
 IF NEW.mode IS DISTINCT FROM 'two_installments' THEN RETURN NEW; END IF;
 SELECT p.mode INTO v_previous FROM public.stage_payment_plans p
  WHERE p.stage_id=NEW.stage_id AND p.id<>NEW.id
  ORDER BY p.proposed_at DESC, p.id DESC LIMIT 1;
 IF v_previous IS DISTINCT FROM 'two_installments' THEN
  RAISE EXCEPTION 'installments_retired' USING HINT='Pay the stage in full, or ask the contractor to propose a price for each part.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_installments_retired() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS stage_payment_plan_installments_retired ON public.stage_payment_plans;
CREATE TRIGGER stage_payment_plan_installments_retired BEFORE INSERT ON public.stage_payment_plans
 FOR EACH ROW EXECUTE FUNCTION public.guard_installments_retired();

COMMIT;

-- Verify (read-only):
--   SELECT tgname FROM pg_trigger WHERE tgname='stage_payment_plan_installments_retired';
--   -- stages still on two installments, which keep working:
--   SELECT count(*) FROM public.stage_payment_plans WHERE superseded_at IS NULL AND mode='two_installments';
