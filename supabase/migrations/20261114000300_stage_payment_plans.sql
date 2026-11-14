-- Full payment or two installments; any number of independently verified receipts.
-- Work permission and permission to progress with debt are separate decisions.
BEGIN;
CREATE TABLE IF NOT EXISTS public.stage_payment_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES public.projects ON DELETE CASCADE,
 stage_id uuid NOT NULL REFERENCES public.project_stages ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN('full','two_installments')),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),stage_amount numeric(24,6) NOT NULL CHECK(stage_amount>0 AND stage_amount<=1e12),
 first_amount numeric(24,6) NOT NULL CHECK(first_amount>0),
 status text NOT NULL CHECK(status IN('proposed','accepted','declined')),
 proposed_by uuid NOT NULL,proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),decided_by uuid,decided_at timestamptz,superseded_at timestamptz,
 CHECK((mode='full' AND first_amount=stage_amount) OR (mode='two_installments' AND first_amount<stage_amount)),
 CHECK((status='proposed')=(decided_at IS NULL)),CHECK((decided_at IS NULL)=(decided_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS stage_payment_plan_current ON public.stage_payment_plans(stage_id) WHERE superseded_at IS NULL;
ALTER TABLE public.stage_payment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_payment_plan_member_read ON public.stage_payment_plans;
CREATE POLICY stage_payment_plan_member_read ON public.stage_payment_plans FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.stage_payment_plans TO authenticated;

SELECT set_config('app.capture_prior_stage_permissions',CASE WHEN to_regclass('public.stage_progression_authorizations') IS NULL THEN 'yes' ELSE 'no' END,true);
CREATE TABLE IF NOT EXISTS public.stage_progression_authorizations(
 stage_id uuid PRIMARY KEY REFERENCES public.project_stages ON DELETE CASCADE,project_id uuid NOT NULL REFERENCES public.projects ON DELETE CASCADE,
 currency text NOT NULL,stage_amount numeric(24,6),balance_at_decision numeric(24,6),
 authorized_by uuid,authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),note text CHECK(length(note)<=2000),
 source text NOT NULL CHECK(source IN('explicit','prior_receipt_permission'))
);
ALTER TABLE public.stage_progression_authorizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_progression_authorization_member_read ON public.stage_progression_authorizations;
CREATE POLICY stage_progression_authorization_member_read ON public.stage_progression_authorizations FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.stage_progression_authorizations TO authenticated;

ALTER TABLE public.stage_payment_receipts
 ADD COLUMN IF NOT EXISTS payment_plan_id uuid REFERENCES public.stage_payment_plans,
 ADD COLUMN IF NOT EXISTS installment_number smallint CHECK(installment_number IN(1,2));

CREATE OR REPLACE FUNCTION public.stage_payment_totals(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;p public.projects%ROWTYPE;basis jsonb;code text;rate numeric;due numeric;
 received numeric;pending numeric;known boolean;pending_known boolean;rows jsonb;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 SELECT * INTO STRICT p FROM public.projects WHERE id=s.project_id;
 IF (p.budget_source='boq' OR p.pricing_revision>0) AND p.budget_currency IS NOT NULL AND p.budget_fx_rate>0 THEN
  code:=p.budget_currency;rate:=p.budget_fx_rate;
 ELSE
  basis:='{"CM":["XAF",600],"CI":["XOF",600],"SN":["XOF",600],"TG":["XOF",600],"BJ":["XOF",600],"NG":["NGN",1600],"GH":["GHS",16],"KE":["KES",130],"UG":["UGX",3700],"TZ":["TZS",2500],"RW":["RWF",1300],"ET":["ETB",57],"ZA":["ZAR",18],"ZM":["ZMW",28],"ZW":["USD",1],"MZ":["MZN",64],"BW":["BWP",14],"CD":["CDF",2800],"MA":["MAD",10],"EG":["EGP",48],"GB":["GBP",0.79],"US":["USD",1]}'::jsonb->upper(coalesce(p.country,''));
  code:=coalesce(basis->>0,'USD');rate:=coalesce((basis->>1)::numeric,1);
 END IF;
 due:=CASE WHEN p.budget_source='boq' OR p.pricing_revision>0 THEN coalesce(s.milestone_amount,round(s.payment_milestone_usd*rate,6)) ELSE round(s.payment_milestone_usd*rate,6) END;
 SELECT coalesce(sum(amount) FILTER(WHERE decision='received'),0),coalesce(sum(amount) FILTER(WHERE decision='pending'),0),
  coalesce(bool_and(amount IS NOT NULL) FILTER(WHERE decision='received'),true),coalesce(bool_and(amount IS NOT NULL) FILTER(WHERE decision='pending'),true),
  coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'decision',decision,'allows_work',allows_work,'installment',installment_number,'plan_id',payment_plan_id) ORDER BY id),'[]'::jsonb)
 INTO received,pending,known,pending_known,rows FROM (
  SELECT r.id,r.decision,r.allows_work,r.installment_number,r.payment_plan_id,
   CASE WHEN r.legacy_unknown THEN NULL WHEN r.project_currency=code THEN r.project_amount WHEN r.currency=code THEN r.amount ELSE round(r.amount_usd*rate,6) END AS amount
  FROM public.stage_payment_receipts r WHERE r.stage_id=p_stage AND r.replaced_by IS NULL AND r.decision<>'flagged'
 ) amounts;
 RETURN jsonb_build_object('stage_id',p_stage,'project_id',p.id,'currency',code,'fx_rate',rate::text,'stage_amount',due::text,
  'received',CASE WHEN known THEN received::text END,'pending',CASE WHEN pending_known THEN pending::text END,
  'remaining',CASE WHEN known THEN greatest(due-received,0)::text END,'receipts',rows,
  'hash',md5(jsonb_build_object('stage',p_stage,'due',due,'currency',code,'rate',rate,'state',p.status,'stage_state',s.status,'reviewed',s.review_payment_pending,'rows',rows)::text));
END $$;
REVOKE ALL ON FUNCTION public.stage_payment_totals(uuid) FROM PUBLIC,anon,authenticated;

-- Retain permissions explicitly recorded by the previous receipt confirmation flow.
-- This does not fabricate paid money, change work status, or change a receipt.
INSERT INTO public.stage_progression_authorizations(stage_id,project_id,currency,stage_amount,balance_at_decision,authorized_by,authorized_at,source,note)
 SELECT DISTINCT ON(r.stage_id) r.stage_id,r.project_id,t->>'currency',(t->>'stage_amount')::numeric,(t->>'remaining')::numeric,
 r.decided_by,coalesce(r.decided_at,r.submitted_at),'prior_receipt_permission','Work/progression permission recorded before separate progression confirmations.'
 FROM public.stage_payment_receipts r CROSS JOIN LATERAL public.stage_payment_totals(r.stage_id) t
 WHERE r.allows_work AND r.decision='received' AND r.replaced_by IS NULL AND current_setting('app.capture_prior_stage_permissions',true)='yes'
 ORDER BY r.stage_id,r.decided_at DESC NULLS LAST,r.id
 ON CONFLICT(stage_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.stage_progression_authorized(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;BEGIN
 t:=public.stage_payment_totals(p_stage);
 IF coalesce((t->>'stage_amount')::numeric<=0,false) THEN RETURN true; END IF;
 IF NOT coalesce(public.stage_funding_settled(p_stage),false) THEN RETURN false; END IF;
 RETURN coalesce((t->>'remaining')::numeric=0,false)
  OR EXISTS(SELECT 1 FROM public.stage_progression_authorizations a WHERE a.stage_id=p_stage
   AND a.currency=t->>'currency' AND a.stage_amount IS NOT DISTINCT FROM (t->>'stage_amount')::numeric)
  OR NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=p_stage);
END $$;
REVOKE ALL ON FUNCTION public.stage_progression_authorized(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.stage_payment_plan_context(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;s public.project_stages%ROWTYPE;plan public.stage_payment_plans%ROWTYPE;editable boolean;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_admin() OR public.project_member(s.project_id)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 t:=public.stage_payment_totals(p_stage);
 SELECT * INTO plan FROM public.stage_payment_plans WHERE stage_id=p_stage AND superseded_at IS NULL;
 editable:=NOT coalesce(s.pre_existing,false) AND s.status<>'complete'
  AND EXISTS(SELECT 1 FROM public.projects WHERE id=s.project_id AND status='active')
  AND (t->>'stage_amount')::numeric>0 AND NOT public.stage_funding_settled(p_stage)
  AND (NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=p_stage) OR plan.status='declined');
 RETURN t||jsonb_build_object('hash',md5((t->>'hash')||coalesce(to_jsonb(plan)::text,'')),'plan',CASE WHEN plan.id IS NOT NULL THEN jsonb_build_object('id',plan.id,'mode',plan.mode,'currency',plan.currency,
  'stage_amount',plan.stage_amount::text,'first_amount',plan.first_amount::text,'status',plan.status,'proposed_at',plan.proposed_at,'decided_at',plan.decided_at) END,
  'work_authorized',public.stage_work_ready(p_stage),'progression_authorized',public.stage_progression_authorized(p_stage),
  'can_edit',editable AND public.is_project_client(s.project_id),
  'can_decide',coalesce(plan.status='proposed' AND (t->>'stage_amount')::numeric>0 AND s.status<>'complete'
    AND public.is_primary_project_contractor(s.project_id)
    AND EXISTS(SELECT 1 FROM public.projects WHERE id=s.project_id AND status='active'),false),
  'can_authorize_progression',public.is_primary_project_contractor(s.project_id) AND s.review_payment_pending
    AND (t->>'remaining')::numeric>0 AND (t->>'received')::numeric>0 AND NOT public.stage_progression_authorized(p_stage)
    AND (plan.id IS NULL OR plan.status='accepted')
    AND EXISTS(SELECT 1 FROM public.projects WHERE id=s.project_id AND status='active'));
END $$;
REVOKE ALL ON FUNCTION public.stage_payment_plan_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stage_payment_plan_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_stage_payment_plan(p_stage uuid,p_mode text,p_first_amount numeric,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;s public.project_stages%ROWTYPE;v_first numeric;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_project_client(s.project_id) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 c:=public.stage_payment_plan_context(p_stage);
 IF NOT (c->>'can_edit')::boolean THEN RAISE EXCEPTION 'payment_plan_locked'; END IF;
 IF p_expected_hash IS DISTINCT FROM c->>'hash' THEN RAISE EXCEPTION 'payment_plan_stale'; END IF;
 v_first:=CASE WHEN p_mode='full' THEN (c->>'stage_amount')::numeric ELSE p_first_amount END;
 IF p_mode IS NULL OR p_mode NOT IN('full','two_installments') OR v_first IS NULL OR v_first::text IN('NaN','Infinity','-Infinity')
  OR v_first<=0 OR v_first<>round(v_first,6) OR v_first>(c->>'stage_amount')::numeric
  OR (p_mode='two_installments' AND v_first>=(c->>'stage_amount')::numeric) THEN RAISE EXCEPTION 'invalid_payment_plan'; END IF;
 UPDATE public.stage_payment_plans SET superseded_at=clock_timestamp() WHERE stage_id=p_stage AND superseded_at IS NULL;
 INSERT INTO public.stage_payment_plans(stage_id,project_id,mode,currency,stage_amount,first_amount,status,proposed_by,decided_by,decided_at)
 VALUES(p_stage,s.project_id,p_mode,c->>'currency',(c->>'stage_amount')::numeric,v_first,CASE WHEN p_mode='full' THEN 'accepted' ELSE 'proposed' END,auth.uid(),CASE WHEN p_mode='full' THEN auth.uid() END,CASE WHEN p_mode='full' THEN clock_timestamp() END);
 PERFORM public.log_activity(s.project_id,'funding.payment_plan_proposed','project_stage',p_stage,auth.uid(),jsonb_build_object('mode',p_mode,'first_amount',v_first,'stage_amount',c->>'stage_amount','currency',c->>'currency'));
 RETURN public.stage_payment_plan_context(p_stage);
END $$;
REVOKE ALL ON FUNCTION public.save_stage_payment_plan(uuid,text,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_stage_payment_plan(uuid,text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_stage_payment_plan(p_stage uuid,p_plan uuid,p_accept boolean,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;c jsonb;plan public.stage_payment_plans%ROWTYPE;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_primary_project_contractor(s.project_id) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 SELECT * INTO plan FROM public.stage_payment_plans WHERE id=p_plan AND stage_id=p_stage AND superseded_at IS NULL FOR UPDATE;
 IF NOT FOUND OR p_accept IS NULL THEN RAISE EXCEPTION 'payment_plan_required'; END IF;
 IF plan.status=(CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END) THEN RETURN public.stage_payment_plan_context(p_stage); END IF;
 c:=public.stage_payment_plan_context(p_stage);
 IF plan.status<>'proposed' OR p_expected_hash IS DISTINCT FROM c->>'hash'
  OR plan.currency IS DISTINCT FROM c->>'currency'
  OR NOT EXISTS(SELECT 1 FROM public.projects WHERE id=s.project_id AND status='active') THEN RAISE EXCEPTION 'payment_plan_stale'; END IF;
 UPDATE public.stage_payment_plans SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=plan.id;
 PERFORM public.log_activity(s.project_id,'funding.payment_plan_decided','project_stage',p_stage,auth.uid(),jsonb_build_object('plan_id',plan.id,'accepted',p_accept,'first_amount',plan.first_amount,'stage_amount',plan.stage_amount,'currency',plan.currency));
 IF p_accept THEN PERFORM public.open_stage_if_settled(p_stage);PERFORM public.finish_reviewed_stage_payment(p_stage); END IF;
 RETURN public.stage_payment_plan_context(p_stage);
END $$;
REVOKE ALL ON FUNCTION public.decide_stage_payment_plan(uuid,uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stage_payment_plan(uuid,uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.authorize_stage_progression(p_stage uuid,p_expected_hash text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;c jsonb;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_primary_project_contractor(s.project_id) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);c:=public.stage_payment_plan_context(p_stage);
 IF (c->>'progression_authorized')::boolean AND EXISTS(
  SELECT 1 FROM public.stage_progression_authorizations WHERE stage_id=p_stage AND source='explicit'
   AND authorized_by=auth.uid()) THEN RETURN c; END IF;
 IF p_expected_hash IS DISTINCT FROM c->>'hash' THEN RAISE EXCEPTION 'payment_plan_stale'; END IF;
 IF NOT (c->>'can_authorize_progression')::boolean OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'progression_not_ready'; END IF;
 INSERT INTO public.stage_progression_authorizations(stage_id,project_id,currency,stage_amount,balance_at_decision,authorized_by,note,source)
 VALUES(p_stage,s.project_id,c->>'currency',(c->>'stage_amount')::numeric,(c->>'remaining')::numeric,auth.uid(),nullif(btrim(p_note),''),'explicit')
 ON CONFLICT(stage_id) DO UPDATE SET currency=EXCLUDED.currency,stage_amount=EXCLUDED.stage_amount,balance_at_decision=EXCLUDED.balance_at_decision,
 authorized_by=EXCLUDED.authorized_by,authorized_at=clock_timestamp(),note=EXCLUDED.note,source='explicit';
 PERFORM public.log_activity(s.project_id,'funding.progression_with_balance_authorized','project_stage',p_stage,auth.uid(),jsonb_build_object('stage_amount',c->>'stage_amount','outstanding_balance',c->>'remaining','currency',c->>'currency','note',p_note));
 PERFORM set_config('app.payments_write','on',true);
 UPDATE public.payments SET state='funded',funding_source='contractor_confirmed',confirmed_by=auth.uid(),confirmed_at=clock_timestamp()
 WHERE stage_id=p_stage AND direction='in' AND state NOT IN('funded','reconciled');
 PERFORM set_config('app.payments_write','off',true);
 PERFORM public.finish_reviewed_stage_payment(p_stage);
 RETURN public.stage_payment_plan_context(p_stage);
END $$;
REVOKE ALL ON FUNCTION public.authorize_stage_progression(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_stage_progression(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_stage_installment_receipt(p_stage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric,p_reading uuid,p_installment integer DEFAULT NULL,p_replaces uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;plan public.stage_payment_plans%ROWTYPE;r public.stage_payment_receipts%ROWTYPE;
 result jsonb;c jsonb;v_id uuid;v_installment integer;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_project_client(s.project_id) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 SELECT * INTO plan FROM public.stage_payment_plans WHERE stage_id=p_stage AND superseded_at IS NULL;
 IF plan.status='declined' THEN RAISE EXCEPTION 'payment_plan_declined'; END IF;
 v_installment:=CASE WHEN plan.mode='two_installments' THEN p_installment ELSE coalesce(p_installment,1) END;
 IF p_replaces IS NOT NULL THEN
  SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_replaces AND stage_id=p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale_receipt'; END IF;
  v_installment:=coalesce(r.installment_number,1);
 END IF;
 IF v_installment IS NULL OR v_installment NOT IN(1,2) OR (v_installment=2 AND coalesce(plan.mode,'full')<>'two_installments') THEN RAISE EXCEPTION 'invalid_installment'; END IF;
 IF p_replaces IS NULL THEN result:=public.submit_stage_payment_receipt(p_stage,p_path,p_amount,p_currency,p_fx_rate,p_reading);
 ELSE result:=public.replace_stage_payment_receipt(p_replaces,p_stage,p_path,p_amount,p_currency,p_fx_rate,p_reading);END IF;
 SELECT * INTO r FROM public.stage_payment_receipts WHERE reading_id=p_reading FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt_reading_required'; END IF;
 IF r.installment_number IS NOT NULL THEN
  IF r.installment_number<>v_installment OR r.payment_plan_id IS DISTINCT FROM plan.id THEN RAISE EXCEPTION 'receipt_immutable: installment stays recorded'; END IF;
 ELSE
  PERFORM set_config('app.installment_write','on',true);
  PERFORM set_config('app.stage_receipt_write','on',true);
  UPDATE public.stage_payment_receipts SET payment_plan_id=plan.id,installment_number=v_installment WHERE id=r.id;
  PERFORM set_config('app.stage_receipt_write','off',true);
  PERFORM set_config('app.installment_write','off',true);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.submit_stage_installment_receipt(uuid,text,numeric,text,numeric,uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_installment_receipt(uuid,text,numeric,text,numeric,uuid,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric,uuid),public.replace_stage_payment_receipt(uuid,uuid,text,numeric,text,numeric,uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.guard_receipt_installment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF ROW(NEW.payment_plan_id,NEW.installment_number) IS DISTINCT FROM ROW(OLD.payment_plan_id,OLD.installment_number) THEN
  IF OLD.installment_number IS NOT NULL OR current_setting('app.installment_write',true) IS DISTINCT FROM 'on' THEN
   RAISE EXCEPTION 'receipt_immutable: installment stays recorded';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_receipt_installment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS receipt_installment_guard ON public.stage_payment_receipts;
CREATE TRIGGER receipt_installment_guard BEFORE UPDATE ON public.stage_payment_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_installment();

-- Progression functions and notification copy follow below.

CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (s.payment_milestone_usd=0 AND coalesce(s.milestone_amount,0)=0)
   OR (coalesce(public.stage_funding_settled(s.id),false)
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans WHERE stage_id=s.id AND status<>'accepted' AND superseded_at IS NULL))
   OR (coalesce(public.stage_starts_with_evidence(s.id),false) AND NOT s.review_payment_pending AND s.status<>'complete')
 FROM public.project_stages s WHERE s.id=p_stage;
$$;

CREATE OR REPLACE FUNCTION public.guard_review_payment_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF (TG_OP='INSERT' AND NEW.review_payment_pending)
    OR (TG_OP='UPDATE' AND NEW.review_payment_pending IS DISTINCT FROM OLD.review_payment_pending) THEN
   IF current_setting('app.review_payment_write',true) IS DISTINCT FROM 'on' THEN
     RAISE EXCEPTION 'review_payment_via_rpc: use stage approval and receipt confirmation';
   END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.review_payment_pending AND NEW.status='complete' AND NOT public.stage_progression_authorized(NEW.id) AND NOT public.is_admin() THEN
   RAISE EXCEPTION 'reviewed_stage_payment_required: confirm the reviewed stage payment before proceeding';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid; v_stage public.project_stages%ROWTYPE; v_project public.projects%ROWTYPE;
  v_admin boolean := public.is_admin(); v_next public.project_stages%ROWTYPE;
  v_final boolean; v_already boolean; v_now timestamptz := now();
  v_settlement boolean := coalesce(current_setting('app.review_payment_settlement',true)='on',false);
BEGIN
  IF auth.uid() IS NULL AND NOT v_settlement THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_project FROM public.projects WHERE id = v_project_id;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage AND project_id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  v_settlement := v_settlement AND v_stage.review_payment_pending AND public.stage_progression_authorized(p_stage);
  IF NOT v_admin AND NOT public.is_project_client(v_project_id) AND NOT v_settlement THEN
    RAISE EXCEPTION 'not_authorized: only an administrator or the project client may approve a stage';
  END IF;
  IF coalesce(v_stage.pre_existing, false) THEN RAISE EXCEPTION 'historical_stage: this stage was completed before joining'; END IF;
  v_already := v_stage.status = 'complete';
  IF NOT v_already THEN
    IF v_project.status IN ('on_hold', 'completed') THEN RAISE EXCEPTION 'project_paused: this project is not open for progression'; END IF;
    IF v_stage.status NOT IN ('active', 'pending_review') THEN RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status; END IF;
    IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN
      RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first';
    END IF;
    IF NOT v_admin THEN
      IF NOT v_stage.review_payment_pending AND NOT coalesce(public.stage_work_ready(p_stage), false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
      IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN RAISE EXCEPTION 'substages_not_ready: not all substages are complete'; END IF;
      IF EXISTS (SELECT 1 FROM public.contractor_invites WHERE project_id = v_project_id AND status = 'accepted')
         AND NOT public.stage_has_evidence(p_stage) THEN RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review'; END IF;
    END IF;
    -- Approved work stays on this stage until settlement or an explicit progression decision.
    IF NOT public.stage_progression_authorized(p_stage) AND NOT v_admin THEN
      IF NOT v_stage.review_payment_pending THEN
        PERFORM set_config('app.approve_stage','on',true);
        IF v_admin THEN
          UPDATE public.project_substages SET status='complete',approved_by=auth.uid(),approved_at=v_now
            WHERE stage_id=p_stage AND status<>'complete';
        END IF;
        PERFORM set_config('app.review_payment_write','on',true);
        UPDATE public.project_stages SET status='pending_review',review_payment_pending=true,
          approved_by=auth.uid(),approved_at=v_now WHERE id=p_stage;
        PERFORM set_config('app.review_payment_write','off',true);
        PERFORM set_config('app.approve_stage','off',true);
        UPDATE public.projects SET current_stage=v_stage.stage_number WHERE id=v_project_id;
        PERFORM public.log_activity(v_project_id,'stage.work_approved','project_stage',p_stage,auth.uid(),
          jsonb_build_object('stage_number',v_stage.stage_number,'awaiting_payment_for_stage',v_stage.stage_number));
      END IF;
      RETURN jsonb_build_object('project_id',v_project_id,'stage_id',p_stage,'stage_number',v_stage.stage_number,
        'is_final',false,'next_stage_id',p_stage,'next_stage_number',v_stage.stage_number,
        'next_stage_status','pending_review','awaiting_payment',true,'awaiting_reviewed_stage_payment',true,
        'verification_id',NULL,'already_approved',v_stage.review_payment_pending);
    END IF;
    -- The ledger is authoritative; synchronize an older or rounded projection
    -- without fabricating funding for an administrator's explicit override.
    IF coalesce(public.stage_funding_settled(p_stage), false) THEN
      PERFORM set_config('app.payments_projection', 'on', true);
      UPDATE public.project_stages SET payment_status = 'paid' WHERE id = p_stage;
      PERFORM set_config('app.payments_projection', 'off', true);
    END IF;
    PERFORM set_config('app.approve_stage', 'on', true);
    IF v_admin THEN
      UPDATE public.project_substages SET status = 'complete', approved_by = auth.uid(), approved_at = v_now
        WHERE stage_id = p_stage AND status <> 'complete';
    END IF;
    PERFORM set_config('app.review_payment_write','on',true);
    UPDATE public.project_stages SET status = 'complete', completed_at = v_now, review_payment_pending=false,
      approved_by = CASE WHEN v_settlement THEN v_stage.approved_by ELSE auth.uid() END,
      approved_at = CASE WHEN v_settlement THEN v_stage.approved_at ELSE v_now END WHERE id = p_stage;
    PERFORM set_config('app.review_payment_write','off',true);
    PERFORM set_config('app.approve_stage', 'off', true);
  END IF;
  -- On a retry, point at the current remaining work rather than reopening an
  -- already completed successor or repeating the approval/audit event.
  SELECT * INTO v_next FROM public.project_stages
    WHERE project_id = v_project_id AND status <> 'complete' ORDER BY stage_number LIMIT 1;
  v_final := v_next.id IS NULL;
  IF NOT v_already THEN
    IF NOT v_final THEN
      PERFORM public.open_stage_if_settled(v_next.id);
      IF NOT coalesce(public.stage_work_ready(v_next.id), false) THEN
        PERFORM public.log_activity(v_project_id, 'stage.awaiting_payment', 'project_stage', v_next.id, NULL,
          jsonb_build_object('stage_number', v_next.stage_number));
      END IF;
    END IF;
    UPDATE public.projects SET current_stage = CASE WHEN v_final THEN v_stage.stage_number ELSE v_next.stage_number END,
      status = CASE WHEN v_final THEN 'completed' ELSE status END WHERE id = v_project_id;
    IF v_settlement THEN
      PERFORM public.log_activity(v_project_id,'stage.payment_settled','project_stage',p_stage,v_stage.approved_by,
        jsonb_build_object('stage_number',v_stage.stage_number,'work_approved_by',v_stage.approved_by,
          'work_approved_at',v_stage.approved_at,'payment_confirmed_by',auth.uid()));
    ELSE
    PERFORM public.log_activity(v_project_id, 'stage.approved', 'project_stage', p_stage, CASE WHEN v_settlement THEN v_stage.approved_by ELSE auth.uid() END,
      jsonb_build_object('stage_number', v_stage.stage_number, 'tier', v_project.tier,
        'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'client' END));
    END IF;
  END IF;
  IF v_next.id IS NOT NULL THEN
    SELECT * INTO v_next FROM public.project_stages WHERE id = v_next.id;
  END IF;
  RETURN jsonb_build_object('project_id', v_project_id, 'stage_id', p_stage, 'stage_number', v_stage.stage_number,
    'is_final', v_final, 'next_stage_id', v_next.id, 'next_stage_number', v_next.stage_number,
    'next_stage_status', v_next.status,
    'awaiting_payment', (v_next.id IS NOT NULL AND NOT coalesce(public.stage_work_ready(v_next.id), false)),
    'verification_id', NULL, 'already_approved', v_already);
END $$;
CREATE OR REPLACE FUNCTION public.finish_reviewed_stage_payment(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid; s public.project_stages%ROWTYPE; BEGIN
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage FOR UPDATE;
 IF NOT s.review_payment_pending OR NOT public.stage_progression_authorized(p_stage) OR s.status='complete'
   OR EXISTS(SELECT 1 FROM public.projects WHERE id=v_project AND status<>'active') THEN RETURN false; END IF;
 IF s.approved_by IS NULL OR s.approved_at IS NULL
   OR EXISTS(SELECT 1 FROM public.project_substages WHERE stage_id=p_stage AND status<>'complete') THEN
   RAISE EXCEPTION 'reviewed_stage_approval_required';
 END IF;
 PERFORM set_config('app.review_payment_settlement','on',true);
 PERFORM public.approve_stage(p_stage);
 PERFORM set_config('app.review_payment_settlement','off',true);
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.decide_stage_payment_receipt(p_receipt uuid,p_decision text,p_note text DEFAULT NULL,p_top_up numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.stage_payment_receipts%ROWTYPE; v_project uuid; pay public.payments%ROWTYPE; v_opened boolean:=false; BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_payment_receipts WHERE id=p_receipt;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_receipt FOR UPDATE;
 IF NOT public.is_admin() AND NOT public.is_primary_project_contractor(v_project) THEN RAISE EXCEPTION 'not_contractor'; END IF;
 IF r.replaced_by IS NOT NULL THEN RAISE EXCEPTION 'stale_receipt'; END IF;
 IF p_decision='accept' AND EXISTS(SELECT 1 FROM public.stage_payment_plans WHERE stage_id=r.stage_id AND status<>'accepted' AND superseded_at IS NULL) THEN RAISE EXCEPTION 'payment_plan_review_required'; END IF;
 IF r.decision='received' AND p_decision='record' AND NOT r.allows_work THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
 IF p_decision IS NULL OR p_decision NOT IN('accept','record','needs_top_up','flag') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_note'; END IF;
 IF p_decision='needs_top_up' AND (p_top_up IS NULL OR p_top_up::text IN('NaN','Infinity','-Infinity') OR p_top_up<=0 OR p_top_up>1e12 OR p_top_up<>round(p_top_up,6)) THEN RAISE EXCEPTION 'invalid_top_up'; END IF;
 IF p_decision='flag' AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
 IF p_decision='needs_top_up' THEN
  DECLARE t jsonb:=public.stage_payment_totals(r.stage_id); extra numeric; due numeric; BEGIN
   due:=(t->>'remaining')::numeric;
   IF r.decision='pending' THEN due:=due-CASE WHEN r.project_currency=t->>'currency' THEN r.project_amount WHEN r.currency=t->>'currency' THEN r.amount ELSE round(r.amount_usd*(t->>'fx_rate')::numeric,6) END; END IF;
   extra:=round(p_top_up/r.fx_rate*(t->>'fx_rate')::numeric,6);
   IF due IS NULL OR extra>greatest(due,0) THEN RAISE EXCEPTION 'top_up_exceeds_balance'; END IF;
  END;
 END IF;
 IF r.allows_work THEN
  IF p_decision='accept' THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
  RAISE EXCEPTION 'receipt_accepted';
 END IF;
 IF r.decision='flagged' THEN
  IF p_decision='flag' THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
  RAISE EXCEPTION 'receipt_flagged';
 END IF;
 IF r.legacy_unknown THEN RAISE EXCEPTION 'amount_required'; END IF;
 IF r.decision='received' AND p_decision='flag' THEN RAISE EXCEPTION 'receipt_received'; END IF;
 IF r.decision='received' AND p_decision='needs_top_up' AND r.requested_top_up IS NOT NULL THEN
  IF r.requested_top_up IS NOT DISTINCT FROM p_top_up AND r.decision_note IS NOT DISTINCT FROM nullif(btrim(p_note),'') THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
  RAISE EXCEPTION 'receipt_decided';
 END IF;
 PERFORM set_config('app.stage_receipt_write','on',true);
 UPDATE public.stage_payment_receipts SET decision=CASE WHEN p_decision='flag' THEN 'flagged' ELSE 'received' END,
  allows_work=p_decision='accept',requested_top_up=CASE WHEN p_decision='needs_top_up' THEN p_top_up ELSE NULL END,
  decision_note=nullif(btrim(p_note),''),decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=r.id;
 PERFORM set_config('app.stage_receipt_write','off',true);
 IF p_decision='accept' THEN
  SELECT * INTO pay FROM public.payments WHERE id=r.payment_id FOR UPDATE;
  IF pay.state NOT IN('funded','reconciled') THEN
   PERFORM set_config('app.payments_write','on',true);
   UPDATE public.payments SET state='funded',funding_source=CASE WHEN public.is_admin() THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,confirmed_by=auth.uid(),confirmed_at=clock_timestamp() WHERE id=pay.id;
   PERFORM set_config('app.payments_write','off',true);
  END IF;
  -- A later receipt on completed work never reopens it or skips current work.
  IF EXISTS(SELECT 1 FROM public.project_stages WHERE id=r.stage_id AND status<>'complete') THEN v_opened:=public.open_stage_if_settled(r.stage_id); END IF;
 END IF;
 -- Recording the last payment settles already-authorized, reviewed work. It
 -- does not grant work permission when the contractor has not yet given it.
 IF p_decision<>'flag' AND EXISTS(SELECT 1 FROM public.project_stages WHERE id=r.stage_id AND status<>'complete') THEN
  v_opened:=public.finish_reviewed_stage_payment(r.stage_id) OR v_opened;
 END IF;
 PERFORM public.log_activity(v_project,CASE p_decision WHEN 'accept' THEN 'funding.receipt_accepted' WHEN 'needs_top_up' THEN 'funding.receipt_top_up_requested' WHEN 'record' THEN 'funding.receipt_received' ELSE 'funding.receipt_flagged' END,'stage_payment_receipt',r.id,auth.uid(),jsonb_build_object('stage_id',r.stage_id,'amount',r.amount,'currency',r.currency,'requested_top_up',p_top_up,'note',p_note));
 RETURN jsonb_build_object('receipt_id',r.id,'stage_id',r.stage_id,'opened',v_opened,'allows_work',p_decision='accept');
END $$;
CREATE OR REPLACE FUNCTION public.notify_project_financial_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n jsonb:=to_jsonb(NEW);o jsonb;pid uuid:=(n->>'project_id')::uuid;target text;message text;message_fr text;event text;actor uuid:=auth.uid();person record;stage_no text;BEGIN
 IF to_regclass('public.notifications') IS NULL THEN RETURN NEW; END IF;
 o:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 IF TG_TABLE_NAME='stage_price_amendments' THEN
  IF TG_OP='INSERT' THEN target:='client';event:='prices_proposed';message:='Review your contractor’s proposed stage prices.';message_fr:='Examinez les prix proposés par votre entrepreneur.';
  ELSIF n->>'status' IS DISTINCT FROM o->>'status' THEN target:='proposer';event:='prices_'||(n->>'status');message:=CASE WHEN n->>'status'='approved' THEN 'Your client approved the revised project prices.' ELSE 'The price proposal was reviewed. Open its recorded decision.' END;message_fr:=CASE WHEN n->>'status'='approved' THEN 'Votre client a approuvé les nouveaux prix.' ELSE 'La proposition a été examinée. Consultez la décision enregistrée.' END;
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='stage_payment_plans' THEN
  SELECT stage_number::text INTO stage_no FROM public.project_stages WHERE id=(n->>'stage_id')::uuid;
  IF TG_OP='INSERT' THEN
   target:='contractor';event:='payment_plan_proposed';
   message:=CASE WHEN n->>'mode'='two_installments' THEN 'Your client proposed two installments. Review the amounts before authorizing work.' ELSE 'Your client selected full payment for this stage. Review each receipt when it arrives.' END;
   message_fr:=CASE WHEN n->>'mode'='two_installments' THEN 'Votre client propose deux versements. Examinez les montants avant d’autoriser les travaux.' ELSE 'Votre client a choisi le paiement intégral de cette étape. Examinez chaque reçu à sa réception.' END;
  ELSIF n->>'status' IS DISTINCT FROM o->>'status' THEN
   target:='client';event:='payment_plan_'||(n->>'status');
   message:=CASE WHEN n->>'status'='accepted' THEN 'Your contractor accepted the installment plan. Add each payment receipt to its installment; the contractor confirms money received separately.' ELSE 'Your contractor requested a revised installment plan. Open the stage to review the amounts and propose an update.' END;
   message_fr:=CASE WHEN n->>'status'='accepted' THEN 'Votre entrepreneur accepte l’échéancier. Ajoutez chaque reçu au versement correspondant ; la réception de l’argent est confirmée séparément.' ELSE 'Votre entrepreneur demande un nouvel échéancier. Ouvrez l’étape pour examiner les montants et proposer une mise à jour.' END;
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='stage_progression_authorizations' THEN
  IF n->>'source'<>'explicit' THEN RETURN NEW; END IF;
  SELECT stage_number::text INTO stage_no FROM public.project_stages WHERE id=(n->>'stage_id')::uuid;
  target:='client';event:='progression_with_balance_authorized';
  message:='Your contractor authorized progression. The outstanding '||(n->>'balance_at_decision')||' '||(n->>'currency')||' remains payable on this stage.';
  message_fr:='Votre entrepreneur autorise la poursuite du projet. Le solde de '||(n->>'balance_at_decision')||' '||(n->>'currency')||' reste dû pour cette étape.';
 ELSE
  SELECT stage_number::text INTO stage_no FROM public.project_stages WHERE id=(n->>'stage_id')::uuid;
  IF TG_OP='INSERT' THEN target:='contractor';event:='receipt_submitted';message:='A payment receipt is ready. Confirm whether you received the money and whether work may continue.';message_fr:='Un reçu est prêt. Confirmez la réception de l’argent et la poursuite des travaux.';
  ELSIF ROW(n->>'decision',n->>'allows_work',n->>'requested_top_up') IS DISTINCT FROM ROW(o->>'decision',o->>'allows_work',o->>'requested_top_up') THEN
   target:='client';event:='receipt_'||(n->>'decision');
   message:=CASE WHEN n->>'decision'='flagged' THEN 'Your contractor has not confirmed receiving this payment. Review the receipt and their note.' WHEN (n->>'allows_work')::boolean THEN 'Your contractor confirmed receiving the money and authorized work to continue. Any balance remains recorded.' WHEN n->>'requested_top_up' IS NULL THEN 'Your contractor confirmed receiving the payment. Work authorization is pending; any balance stays recorded.' ELSE 'Your contractor confirmed receiving the money and requested an additional '||(n->>'requested_top_up')||' '||(n->>'currency')||'. Open this stage for the next payment.' END;
   message_fr:=CASE WHEN n->>'decision'='flagged' THEN 'Votre entrepreneur n’a pas confirmé ce paiement. Consultez le reçu et sa note.' WHEN (n->>'allows_work')::boolean THEN 'Votre entrepreneur confirme la réception de l’argent et autorise les travaux. Le solde reste enregistré.' WHEN n->>'requested_top_up' IS NULL THEN 'Votre entrepreneur confirme la réception du paiement. L’autorisation des travaux est en attente ; le solde reste enregistré.' ELSE 'Votre entrepreneur confirme la réception et demande '||(n->>'requested_top_up')||' '||(n->>'currency')||' supplémentaires. Ouvrez cette étape pour poursuivre.' END;
  ELSE RETURN NEW; END IF;
 END IF;
 FOR person IN
  SELECT DISTINCT candidates.id,coalesce(pr.preferred_lang,'en') AS lang FROM (
   SELECT c.contractor_user_id AS id FROM public.contractor_invites c WHERE target='contractor' AND c.project_id=pid AND c.status='accepted' AND c.is_primary
   UNION SELECT p.user_id FROM public.projects p WHERE target='client' AND p.id=pid AND p.workflow_origin='client'
   UNION SELECT v.user_id FROM public.project_viewers v WHERE target='client' AND v.project_id=pid AND v.is_client AND v.accepted_at IS NOT NULL AND v.revoked_at IS NULL
   UNION SELECT (n->>'proposed_by')::uuid WHERE target='proposer'
  ) candidates LEFT JOIN public.profiles pr ON pr.id=candidates.id WHERE candidates.id IS NOT NULL AND candidates.id IS DISTINCT FROM actor
 LOOP
  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(person.id,'project.financial_review',CASE WHEN person.lang='fr' THEN 'Paiement et prix du projet' ELSE 'Project payment and pricing' END,CASE WHEN person.lang='fr' THEN message_fr ELSE message END,
   jsonb_strip_nulls(jsonb_build_object('project_id',pid,'stage_number',stage_no,'role',CASE WHEN target IN('contractor','proposer') THEN 'contractor' ELSE 'client' END,'project_tab',CASE WHEN TG_TABLE_NAME='stage_price_amendments' THEN CASE WHEN target='proposer' THEN 'money' ELSE 'costing' END ELSE CASE WHEN target='contractor' THEN 'work' ELSE 'stages' END END,'financial_event',event,'receipt_id',CASE WHEN TG_TABLE_NAME='stage_payment_receipts' THEN n->>'id' END,'proposal_id',CASE WHEN TG_TABLE_NAME='stage_price_amendments' THEN n->>'id' END)));
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_plan_notification ON public.stage_payment_plans;
CREATE TRIGGER payment_plan_notification AFTER INSERT OR UPDATE ON public.stage_payment_plans
 FOR EACH ROW EXECUTE FUNCTION public.notify_project_financial_review();
DROP TRIGGER IF EXISTS progression_authorization_notification ON public.stage_progression_authorizations;
CREATE TRIGGER progression_authorization_notification AFTER INSERT OR UPDATE ON public.stage_progression_authorizations
 FOR EACH ROW EXECUTE FUNCTION public.notify_project_financial_review();

-- A new agreed price may remove the current funding requirement or settle an
-- already-reviewed balance. It never approves evidence that has not been reviewed.
CREATE OR REPLACE FUNCTION public.refresh_work_after_price_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stage_id uuid;BEGIN
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 SELECT id INTO stage_id FROM public.project_stages WHERE project_id=NEW.id AND NOT coalesce(pre_existing,false)
  AND status<>'complete' ORDER BY stage_number LIMIT 1;
 IF stage_id IS NOT NULL THEN
  PERFORM public.open_stage_if_settled(stage_id);
  PERFORM public.finish_reviewed_stage_payment(stage_id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refresh_work_after_price_approval() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS refresh_work_after_price_approval ON public.projects;
CREATE TRIGGER refresh_work_after_price_approval AFTER UPDATE OF pricing_revision ON public.projects
 FOR EACH ROW WHEN (NEW.pricing_revision IS DISTINCT FROM OLD.pricing_revision)
 EXECUTE FUNCTION public.refresh_work_after_price_approval();
NOTIFY pgrst,'reload schema';
COMMIT;
