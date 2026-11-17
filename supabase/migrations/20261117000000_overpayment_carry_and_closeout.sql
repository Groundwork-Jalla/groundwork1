-- Money paid above a stage's price carries to the stages that still need it, and a
-- project cannot close while a recorded balance is outstanding.
--
-- Apply after 20261114000300_stage_payment_plans.sql. It changes no receipt, no stage
-- status and no recorded amount; a project where nobody has overpaid reads exactly as
-- it did before (the totals for such a stage are returned byte-for-byte unchanged).
--
-- ── What was wrong ───────────────────────────────────────────────────────────────────
-- A stage's balance was `greatest(price - received, 0)`. Anything paid above the price
-- was dropped by that `greatest`: a 6,000,000 receipt against a 5,239,300 stage left the
-- stage settled and the other 760,700 counted nowhere, so the client was asked for the
-- next stage in full. And approving the final stage marked the project `completed`
-- whatever was still owed, after which the stage that carried the debt could not be
-- settled inside the product at all.
--
-- ── The rule (agreed 17 November 2026) ───────────────────────────────────────────────
--  1. Only money the contractor has confirmed as received carries. Pending and flagged
--     receipts carry nothing.
--  2. It cascades: what one stage cannot absorb moves on to the next.
--  3. Older debt first. A stage that was allowed to proceed with a balance is settled
--     before any future stage is reduced.
--  4. Credit is not permission. Carried money reduces what is owed; whether work may
--     start, and whether the build may move on, stay the contractor's own decisions.
--  5. A project closes by an explicit action, refused while any recorded balance or any
--     undecided receipt remains.
--
-- ── How it is built ──────────────────────────────────────────────────────────────────
-- Every balance decision in the product already reads `stage_payment_totals`. That
-- function is renamed to `stage_payment_own_totals` (its body is untouched) and a new
-- `stage_payment_totals` adds the carried amounts on top. Nothing that calls it changes.
--
-- If 20261114000300 is ever replayed after this file, replay this file again: that
-- migration's CREATE OR REPLACE would put the uncarried body back under the public name.
BEGIN;

DO $$ BEGIN
 IF to_regprocedure('public.stage_payment_own_totals(uuid)') IS NULL THEN
  ALTER FUNCTION public.stage_payment_totals(uuid) RENAME TO stage_payment_own_totals;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.stage_payment_own_totals(uuid) FROM PUBLIC,anon,authenticated;

-- The contractor's acknowledgement that money carried from elsewhere is enough to begin
-- a stage. It is the counterpart of accepting a receipt, for a stage that has none. It is
-- also what keeps the credit attached to that stage once its tranche reads as funded.
CREATE TABLE IF NOT EXISTS public.stage_credit_confirmations(
 stage_id uuid PRIMARY KEY REFERENCES public.project_stages ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES public.projects ON DELETE CASCADE,
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),stage_amount numeric(24,6),
 carried_at_confirmation numeric(24,6) NOT NULL CHECK(carried_at_confirmation>0),
 balance_at_confirmation numeric(24,6),
 confirmed_by uuid,confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.stage_credit_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_credit_confirmation_member_read ON public.stage_credit_confirmations;
CREATE POLICY stage_credit_confirmation_member_read ON public.stage_credit_confirmations FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.stage_credit_confirmations TO authenticated;

-- One pass over the project, in stage order.
--   surplus  what a stage's own confirmed receipts exceed its price by
--   need     what a stage still lacks and may take from the pool
-- The pool is every stage's surplus; it is handed out oldest stage first, which is both
-- "older debt first" and "then the next stage, then the one after".
--
-- A stage may take from the pool when its amounts are known, it is not historical, it has
-- a price, and one of:
--   · it is complete AND money was recorded against it (a real, measured debt), or
--   · it is not complete AND it is not already funded outside the receipt flow.
-- A completed stage with no receipt and no confirmed credit was settled some other way
-- (the ledger, staff, before receipts existed). Nothing here claims it is owed.
CREATE OR REPLACE FUNCTION public.project_payment_allocation(p_project uuid)
RETURNS TABLE(stage_id uuid,stage_number integer,due numeric,own_received numeric,known boolean,tracked boolean,
 carried_in numeric,carried_out numeric,unused_credit numeric,remaining numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE s record;t jsonb;n integer:=0;i integer;pool numeric:=0;used numeric:=0;take numeric;has_receipt boolean;confirmed boolean;
 ids uuid[]:='{}';nums integer[]:='{}';dues numeric[]:='{}';owns numeric[]:='{}';knowns boolean[]:='{}';tracks boolean[]:='{}';
 needs numeric[]:='{}';surplus numeric[]:='{}';ins numeric[]:='{}';outs numeric[]:='{}';
BEGIN
 FOR s IN SELECT st.id,st.stage_number AS num,st.status,coalesce(st.pre_existing,false) AS pre
   FROM public.project_stages st WHERE st.project_id=p_project ORDER BY st.stage_number,st.id LOOP
  t:=public.stage_payment_own_totals(s.id);
  n:=n+1;ids[n]:=s.id;nums[n]:=s.num;dues[n]:=greatest(coalesce((t->>'stage_amount')::numeric,0),0);
  knowns[n]:=(t->>'received') IS NOT NULL;owns[n]:=coalesce((t->>'received')::numeric,0);
  has_receipt:=EXISTS(SELECT 1 FROM public.stage_payment_receipts r WHERE r.stage_id=s.id AND r.replaced_by IS NULL AND r.decision<>'flagged');
  confirmed:=EXISTS(SELECT 1 FROM public.stage_credit_confirmations c WHERE c.stage_id=s.id);
  tracks[n]:=has_receipt OR confirmed;
  surplus[n]:=CASE WHEN knowns[n] THEN greatest(owns[n]-dues[n],0) ELSE 0 END;
  needs[n]:=CASE
   WHEN NOT knowns[n] OR s.pre OR dues[n]<=0 OR owns[n]>=dues[n] THEN 0
   WHEN s.status='complete' THEN CASE WHEN owns[n]>0 OR confirmed THEN dues[n]-owns[n] ELSE 0 END
   WHEN NOT has_receipt AND NOT confirmed AND coalesce(public.stage_funding_settled(s.id),false) THEN 0
   ELSE dues[n]-owns[n] END;
  pool:=pool+surplus[n];ins[n]:=0;outs[n]:=0;
 END LOOP;
 FOR i IN 1..n LOOP take:=least(needs[i],pool);ins[i]:=take;pool:=pool-take;used:=used+take; END LOOP;
 -- Which stages the carried money came from, earliest surplus first. What is left on a
 -- stage after that is credit nobody has needed yet.
 FOR i IN 1..n LOOP take:=least(surplus[i],used);outs[i]:=take;used:=used-take; END LOOP;
 FOR i IN 1..n LOOP
  stage_id:=ids[i];stage_number:=nums[i];due:=dues[i];own_received:=owns[i];known:=knowns[i];
  carried_in:=ins[i];carried_out:=outs[i];unused_credit:=surplus[i]-outs[i];tracked:=tracks[i] OR ins[i]>0;
  remaining:=CASE WHEN knowns[i] THEN greatest(dues[i]-owns[i]-ins[i],0) END;
  RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.project_payment_allocation(uuid) FROM PUBLIC,anon,authenticated;

-- The public totals: a stage's own receipts, plus what was carried to it.
-- With no carried amount in or out the own totals are returned untouched, so their hash,
-- and every confirmation a person is in the middle of, is exactly what it was.
CREATE OR REPLACE FUNCTION public.stage_payment_totals(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;a record;s public.project_stages%ROWTYPE;can boolean:=false;BEGIN
 t:=public.stage_payment_own_totals(p_stage);
 SELECT * INTO a FROM public.project_payment_allocation((t->>'project_id')::uuid) x WHERE x.stage_id=p_stage;
 IF NOT FOUND OR (a.carried_in=0 AND a.carried_out=0 AND a.unused_credit=0) THEN RETURN t; END IF;
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 -- Offered to the primary contractor only, and only where there is no receipt of the
 -- client's own waiting for the same decision.
 can:=a.carried_in>0 AND auth.uid() IS NOT NULL AND s.status<>'complete' AND NOT coalesce(s.pre_existing,false)
  AND NOT coalesce(public.stage_funding_settled(p_stage),false)
  AND NOT EXISTS(SELECT 1 FROM public.stage_credit_confirmations WHERE stage_id=p_stage)
  AND NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=p_stage AND replaced_by IS NULL AND decision='pending')
  AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans WHERE stage_id=p_stage AND status<>'accepted' AND superseded_at IS NULL)
  AND EXISTS(SELECT 1 FROM public.projects WHERE id=s.project_id AND status='active')
  AND coalesce(public.is_primary_project_contractor(s.project_id),false);
 RETURN t||jsonb_build_object(
  'own_received',t->>'received','carried_in',a.carried_in::text,'carried_out',a.carried_out::text,'unused_credit',a.unused_credit::text,
  'received',CASE WHEN a.known THEN (a.own_received+a.carried_in)::text END,
  'remaining',CASE WHEN a.known THEN a.remaining::text END,
  'can_confirm_credit',can,
  'hash',md5((t->>'hash')||'|carried:'||a.carried_in::text||':'||a.carried_out::text||':'||a.unused_credit::text));
END $$;
REVOKE ALL ON FUNCTION public.stage_payment_totals(uuid) FROM PUBLIC,anon,authenticated;

-- "No receipt at all" has always meant this stage is not being paid through receipts, so
-- its balance does not hold the build back. A stage begun on carried credit IS being paid
-- through them, so it now waits for its balance or the contractor's explicit decision,
-- exactly like a stage begun on a partial receipt.
CREATE OR REPLACE FUNCTION public.stage_progression_authorized(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;BEGIN
 t:=public.stage_payment_totals(p_stage);
 IF coalesce((t->>'stage_amount')::numeric<=0,false) THEN RETURN true; END IF;
 IF NOT coalesce(public.stage_funding_settled(p_stage),false) THEN RETURN false; END IF;
 RETURN coalesce((t->>'remaining')::numeric=0,false)
  OR EXISTS(SELECT 1 FROM public.stage_progression_authorizations a WHERE a.stage_id=p_stage
   AND a.currency=t->>'currency' AND a.stage_amount IS NOT DISTINCT FROM (t->>'stage_amount')::numeric)
  OR (NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=p_stage)
   AND NOT EXISTS(SELECT 1 FROM public.stage_credit_confirmations WHERE stage_id=p_stage));
END $$;
REVOKE ALL ON FUNCTION public.stage_progression_authorized(uuid) FROM PUBLIC,anon,authenticated;

-- The contractor accepts carried money as enough to begin this stage.
CREATE OR REPLACE FUNCTION public.confirm_stage_credit(p_stage uuid,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;c jsonb;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_primary_project_contractor(s.project_id) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 c:=public.stage_payment_plan_context(p_stage);
 -- A retry after a lost response finds the decision already recorded.
 IF EXISTS(SELECT 1 FROM public.stage_credit_confirmations WHERE stage_id=p_stage) THEN RETURN c; END IF;
 IF p_expected_hash IS DISTINCT FROM c->>'hash' THEN RAISE EXCEPTION 'payment_plan_stale'; END IF;
 IF NOT coalesce((c->>'can_confirm_credit')::boolean,false) THEN RAISE EXCEPTION 'credit_not_available'; END IF;
 INSERT INTO public.stage_credit_confirmations(stage_id,project_id,currency,stage_amount,carried_at_confirmation,balance_at_confirmation,confirmed_by)
 VALUES(p_stage,s.project_id,c->>'currency',(c->>'stage_amount')::numeric,(c->>'carried_in')::numeric,(c->>'remaining')::numeric,auth.uid());
 PERFORM public.log_activity(s.project_id,'funding.carried_credit_confirmed','project_stage',p_stage,auth.uid(),
  jsonb_build_object('stage_amount',c->>'stage_amount','carried_in',c->>'carried_in','remaining',c->>'remaining','currency',c->>'currency'));
 PERFORM set_config('app.payments_write','on',true);
 UPDATE public.payments SET state='funded',funding_source='contractor_confirmed',confirmed_by=auth.uid(),confirmed_at=clock_timestamp()
 WHERE stage_id=p_stage AND direction='in' AND state NOT IN('funded','reconciled');
 PERFORM set_config('app.payments_write','off',true);
 IF NOT coalesce(public.stage_funding_settled(p_stage),false) THEN RAISE EXCEPTION 'payment_record_missing'; END IF;
 PERFORM public.open_stage_if_settled(p_stage);
 PERFORM public.finish_reviewed_stage_payment(p_stage);
 RETURN public.stage_payment_plan_context(p_stage);
END $$;
REVOKE ALL ON FUNCTION public.confirm_stage_credit(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_stage_credit(uuid,text) TO authenticated;

-- Confirming a receipt on one stage can now settle another stage's balance. If that other
-- stage is reviewed work waiting only for its money, it finishes, the same way it would
-- have had the last receipt been its own. `finish_reviewed_stage_payment` decides; it
-- does nothing unless that stage's own conditions are all met.
CREATE OR REPLACE FUNCTION public.settle_reviewed_stages_after_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_stage uuid;BEGIN
 IF NEW.decision='received' AND OLD.decision IS DISTINCT FROM NEW.decision THEN
  FOR v_stage IN SELECT st.id FROM public.project_stages st WHERE st.project_id=NEW.project_id AND st.id<>NEW.stage_id
    AND st.review_payment_pending AND st.status<>'complete' ORDER BY st.stage_number LOOP
   PERFORM public.finish_reviewed_stage_payment(v_stage);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.settle_reviewed_stages_after_receipt() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS receipt_settles_carried_balance ON public.stage_payment_receipts;
CREATE TRIGGER receipt_settles_carried_balance AFTER UPDATE OF decision ON public.stage_payment_receipts
 FOR EACH ROW EXECUTE FUNCTION public.settle_reviewed_stages_after_receipt();

-- What a project still owes, by the same arithmetic as each stage's own balance.
-- Only stages being paid through receipts or carried credit can owe anything here.
CREATE OR REPLACE FUNCTION public.project_outstanding(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_first uuid;v_code text;v_total numeric;v_rows jsonb;v_pending integer;BEGIN
 SELECT id INTO v_first FROM public.project_stages WHERE project_id=p_project ORDER BY stage_number,id LIMIT 1;
 IF v_first IS NULL THEN RETURN jsonb_build_object('currency',NULL,'outstanding','0','pending_receipts',0,'stages','[]'::jsonb); END IF;
 v_code:=public.stage_payment_own_totals(v_first)->>'currency';
 SELECT coalesce(sum(a.remaining),0),coalesce(jsonb_agg(jsonb_build_object('stage_id',a.stage_id,'stage_number',a.stage_number,'remaining',a.remaining::text) ORDER BY a.stage_number),'[]'::jsonb)
  INTO v_total,v_rows FROM public.project_payment_allocation(p_project) a WHERE a.tracked AND a.known AND a.remaining>0;
 SELECT count(*) INTO v_pending FROM public.stage_payment_receipts r WHERE r.project_id=p_project AND r.replaced_by IS NULL AND r.decision='pending';
 RETURN jsonb_build_object('currency',v_code,'outstanding',v_total::text,'pending_receipts',v_pending,'stages',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.project_outstanding(uuid) FROM PUBLIC,anon,authenticated;

-- What the close-out panel shows, and whether this person may close the project now.
CREATE OR REPLACE FUNCTION public.project_closeout_context(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.projects%ROWTYPE;o jsonb;v_complete boolean;v_role boolean;BEGIN
 SELECT * INTO p FROM public.projects WHERE id=p_project;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_admin() OR public.project_member(p_project)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 o:=public.project_outstanding(p_project);
 v_complete:=EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=p_project)
  AND NOT EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=p_project AND status<>'complete');
 v_role:=public.is_admin() OR coalesce(public.is_project_client(p_project),false) OR coalesce(public.is_primary_project_contractor(p_project),false);
 RETURN o||jsonb_build_object('project_id',p_project,'status',p.status,'closed',p.status='completed','all_stages_complete',v_complete,
  'can_close',p.status='active' AND v_complete AND v_role AND (o->>'outstanding')::numeric=0 AND (o->>'pending_receipts')::integer=0);
END $$;
REVOKE ALL ON FUNCTION public.project_closeout_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_closeout_context(uuid) TO authenticated;

-- Closing is a decision somebody makes, and the only way a project with a history of
-- balances becomes `completed`.
CREATE OR REPLACE FUNCTION public.close_project(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 PERFORM public.lock_project_stage_progression(p_project);
 c:=public.project_closeout_context(p_project);
 IF (c->>'closed')::boolean THEN RETURN c; END IF;
 IF NOT(public.is_admin() OR coalesce(public.is_project_client(p_project),false) OR coalesce(public.is_primary_project_contractor(p_project),false)) THEN RAISE EXCEPTION 'not_authorized: only the client, the primary contractor or an administrator may close a project'; END IF;
 IF c->>'status'<>'active' THEN RAISE EXCEPTION 'project_paused: this project is not open'; END IF;
 IF NOT (c->>'all_stages_complete')::boolean THEN RAISE EXCEPTION 'closeout_stages_incomplete: finish every stage before closing the project'; END IF;
 IF (c->>'pending_receipts')::integer>0 THEN RAISE EXCEPTION 'closeout_receipt_pending: a receipt is waiting for the contractor'; END IF;
 IF (c->>'outstanding')::numeric>0 THEN RAISE EXCEPTION 'closeout_balance_outstanding: % % is still owed',c->>'outstanding',c->>'currency'; END IF;
 PERFORM set_config('app.project_closeout','on',true);
 UPDATE public.projects SET status='completed' WHERE id=p_project;
 PERFORM set_config('app.project_closeout','off',true);
 PERFORM public.log_activity(p_project,'project.closed','project',p_project,auth.uid(),jsonb_build_object('currency',c->>'currency'));
 RETURN public.project_closeout_context(p_project);
END $$;
REVOKE ALL ON FUNCTION public.close_project(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_project(uuid) TO authenticated;

-- Approving the last stage used to mark the project `completed` in the same statement.
-- It still does when nothing is owed. When something is, the stage completes and the
-- project stays open, so the balance can be paid and the project then closed on purpose.
-- Held here rather than inside `approve_stage` so that every path to `completed` meets
-- the same rule, whichever version of that function is installed.
CREATE OR REPLACE FUNCTION public.guard_project_closeout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o jsonb;BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
   AND current_setting('app.project_closeout',true) IS DISTINCT FROM 'on' THEN
  o:=public.project_outstanding(NEW.id);
  IF (o->>'outstanding')::numeric>0 OR (o->>'pending_receipts')::integer>0 THEN
   NEW.status:=OLD.status;
   PERFORM public.log_activity(NEW.id,'project.closeout_blocked','project',NEW.id,auth.uid(),
    jsonb_build_object('outstanding',o->>'outstanding','currency',o->>'currency','pending_receipts',o->'pending_receipts'));
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_project_closeout() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS project_closeout_guard ON public.projects;
CREATE TRIGGER project_closeout_guard BEFORE UPDATE OF status ON public.projects
 FOR EACH ROW EXECUTE FUNCTION public.guard_project_closeout();

-- Tell the client when the contractor has accepted carried money for a stage.
CREATE OR REPLACE FUNCTION public.notify_stage_credit_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person record;stage_no text;actor uuid:=auth.uid();BEGIN
 IF to_regclass('public.notifications') IS NULL THEN RETURN NEW; END IF;
 SELECT stage_number::text INTO stage_no FROM public.project_stages WHERE id=NEW.stage_id;
 FOR person IN
  SELECT DISTINCT candidates.id,coalesce(pr.preferred_lang,'en') AS lang FROM (
   SELECT p.user_id AS id FROM public.projects p WHERE p.id=NEW.project_id AND p.workflow_origin='client'
   UNION SELECT v.user_id FROM public.project_viewers v WHERE v.project_id=NEW.project_id AND v.is_client AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL
  ) candidates LEFT JOIN public.profiles pr ON pr.id=candidates.id WHERE candidates.id IS NOT NULL AND candidates.id IS DISTINCT FROM actor
 LOOP
  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(person.id,'project.financial_review',
   CASE WHEN person.lang='fr' THEN 'Paiement et prix du projet' ELSE 'Project payment and pricing' END,
   CASE WHEN person.lang='fr'
    THEN 'Votre entrepreneur a accepté le montant reporté de vos paiements précédents pour cette étape. Le solde éventuel reste enregistré.'
    ELSE 'Your contractor accepted the amount carried forward from your earlier payments for this stage. Any balance remains recorded.' END,
   jsonb_strip_nulls(jsonb_build_object('project_id',NEW.project_id,'stage_number',stage_no,'role','client','project_tab','stages','financial_event','carried_credit_confirmed')));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_stage_credit_confirmation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage_credit_confirmation_notification ON public.stage_credit_confirmations;
CREATE TRIGGER stage_credit_confirmation_notification AFTER INSERT ON public.stage_credit_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.notify_stage_credit_confirmation();

NOTIFY pgrst,'reload schema';
COMMIT;
