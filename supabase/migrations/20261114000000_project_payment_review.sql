-- November 13 review: repeating workflows, multiple/corrected receipts and approved prices.
-- Does not rewrite receipt amounts or completed work. Apply with the matching frontend.
BEGIN;
CREATE OR REPLACE FUNCTION public.stage_starts_with_evidence(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.workflow_origin='contractor' AND NOT coalesce(s.pre_existing,false)
 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE s.id=p_stage
$$;
DROP INDEX IF EXISTS public.stage_receipts_one_pending;
ALTER TABLE public.stage_payment_receipts ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES public.stage_payment_receipts(id), ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
CREATE OR REPLACE FUNCTION public.record_stage_payment_receipt(
  p_stage uuid, p_path text, p_amount numeric, p_currency text, p_fx_rate numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_actor uuid := auth.uid();
  v_path text := NULLIF(btrim(coalesce(p_path,'')), '');
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_rate numeric;
  v_usd numeric;
  v_project_id uuid; v_existing public.stage_payment_receipts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id=p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  IF NOT public.is_project_client(v_stage.project_id) THEN
    RAISE EXCEPTION 'not_client: only the project client uploads a receipt';
  END IF;
  IF coalesce(v_stage.pre_existing, false) THEN
    RAISE EXCEPTION 'nothing_expected: historical stages do not request funding';
  END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount <= 0 OR p_amount > 1e12 OR p_amount <> round(p_amount,6) THEN
    RAISE EXCEPTION 'invalid_receipt_amount: enter a positive amount with at most six decimal places';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid_receipt_currency: use the receipt currency code';
  END IF;
  SELECT * INTO STRICT v_project FROM public.projects WHERE id = v_stage.project_id;
  IF v_project.budget_source = 'boq' AND v_currency = v_project.budget_currency AND v_project.budget_currency IS NOT NULL
     AND v_project.budget_fx_rate > 0 THEN
    v_rate := v_project.budget_fx_rate;
  ELSE
    v_rate := p_fx_rate;
  END IF;
  IF v_rate IS NULL OR v_rate::text IN ('NaN','Infinity','-Infinity')
     OR v_rate <= 0 OR v_rate > 1e12 OR round(v_rate,12) <= 0
     OR (v_currency = 'USD' AND v_rate <> 1) THEN
    RAISE EXCEPTION 'invalid_receipt_rate: use a positive exchange rate';
  END IF;
  v_rate := round(v_rate,12);
  v_usd := round(p_amount / v_rate,9);
  IF v_usd <= 0 OR v_usd > 1e12 THEN
    RAISE EXCEPTION 'invalid_receipt_amount: converted amount is outside the supported range';
  END IF;
  IF v_path IS NULL OR v_path NOT LIKE v_stage.project_id::text || '/receipts/%'
     OR length(v_path) <= length(v_stage.project_id::text || '/receipts/') THEN
    RAISE EXCEPTION 'invalid_receipt_path: upload the receipt to this project';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'evidence' AND name = v_path) THEN
    RAISE EXCEPTION 'no_receipt: the receipt upload is missing';
  END IF;
  SELECT * INTO v_existing FROM public.stage_payment_receipts WHERE project_id=v_project_id AND path=v_path;
  IF FOUND THEN
    IF v_existing.stage_id=p_stage AND v_existing.amount=p_amount AND v_existing.currency=v_currency AND v_existing.fx_rate=v_rate THEN
      RETURN jsonb_build_object('stage_id',p_stage,'receipt_id',v_existing.id,'already_submitted',true);
    END IF;
    RAISE EXCEPTION 'receipt_already_used: this proof already belongs to a payment';
  END IF;
  IF v_project.status='archived' OR (v_stage.status<>'complete' AND (v_project.status<>'active'
    OR (public.stage_starts_with_evidence(p_stage) AND NOT v_stage.review_payment_pending)
    OR EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=v_project_id AND stage_number<v_stage.stage_number AND status<>'complete'))) THEN
    RAISE EXCEPTION 'receipt_gated: review and approve the preceding stage updates first';
  END IF;
  SELECT * INTO v_payment FROM public.payments
    WHERE stage_id = p_stage AND direction = 'in' FOR UPDATE;
  IF NOT FOUND OR v_payment.state NOT IN ('expected','receipt_submitted','funded','reconciled') THEN
    RAISE EXCEPTION 'nothing_expected: no payment is waiting for a receipt';
  END IF;
  IF v_payment.state = 'receipt_submitted' AND v_payment.receipt_path = v_path
     AND v_payment.receipt_amount = p_amount AND v_payment.receipt_currency = v_currency
     AND v_payment.receipt_fx_rate = v_rate THEN
    RETURN jsonb_build_object('stage_id',p_stage,'tranches',1,'already_submitted',true);
  END IF;
  PERFORM set_config('app.payments_write','on',true);
  PERFORM set_config('app.receipt_write','on',true);
  UPDATE public.payments SET state = CASE WHEN state IN('funded','reconciled') THEN state ELSE 'receipt_submitted' END, receipt_path = v_path,
    receipt_uploaded_by = v_actor, receipt_uploaded_at = clock_timestamp(),
    receipt_amount = p_amount, receipt_currency = v_currency,
    receipt_fx_rate = v_rate, receipt_amount_usd = v_usd
    WHERE id = v_payment.id;
  PERFORM set_config('app.receipt_write','off',true);
  PERFORM set_config('app.payments_write','off',true);
  PERFORM set_config('app.stage_receipt_write','on',true);
  INSERT INTO public.stage_payment_receipts(payment_id,project_id,stage_id,path,submitted_by,submitted_at,amount,currency,fx_rate,amount_usd)
  SELECT id,project_id,stage_id,receipt_path,receipt_uploaded_by,receipt_uploaded_at,receipt_amount,receipt_currency,receipt_fx_rate,receipt_amount_usd
    FROM public.payments WHERE id=v_payment.id;
  PERFORM set_config('app.stage_receipt_write','off',true);
  PERFORM public.log_activity(v_stage.project_id,'funding.receipt_submitted','project_stage',p_stage,v_actor,
    jsonb_build_object('stage_number',v_stage.stage_number,'tranches',1,
      'receipt_amount',p_amount,'receipt_currency',v_currency,'receipt_fx_rate',v_rate,'receipt_amount_usd',v_usd));
  RETURN jsonb_build_object('stage_id',p_stage,'tranches',1,'receipt_id',(SELECT id FROM public.stage_payment_receipts WHERE project_id=v_project_id AND path=v_path));
END $$;
CREATE OR REPLACE FUNCTION public.replace_stage_payment_receipt(p_receipt uuid,p_stage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric,p_reading uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.stage_payment_receipts%ROWTYPE; result jsonb; v_id uuid; BEGIN
 SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_receipt;
 IF NOT FOUND OR r.stage_id<>p_stage OR NOT public.is_project_client(r.project_id) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(r.project_id);
 SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_receipt FOR UPDATE;
 IF r.replaced_by IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE id=r.replaced_by AND reading_id=p_reading AND path=p_path) THEN RETURN jsonb_build_object('receipt_id',r.replaced_by,'already_submitted',true); END IF;
  RAISE EXCEPTION 'stale_receipt';
 END IF;
 IF r.decision='received' OR r.allows_work THEN RAISE EXCEPTION 'receipt_received: confirmed money stays recorded'; END IF;
 result:=public.submit_stage_payment_receipt(p_stage,p_path,p_amount,p_currency,p_fx_rate,p_reading);
 SELECT id INTO v_id FROM public.stage_payment_receipts WHERE reading_id=p_reading;
 IF v_id IS NULL OR v_id=r.id THEN RAISE EXCEPTION 'receipt_already_used'; END IF;
 PERFORM set_config('app.stage_receipt_write','on',true);
 UPDATE public.stage_payment_receipts SET replaced_by=v_id,replaced_at=clock_timestamp() WHERE id=r.id;
 PERFORM set_config('app.stage_receipt_write','off',true);
 PERFORM public.log_activity(r.project_id,'funding.receipt_replaced','stage_payment_receipt',r.id,auth.uid(),jsonb_build_object('replacement_id',v_id,'stage_id',r.stage_id));
 RETURN result||jsonb_build_object('receipt_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.replace_stage_payment_receipt(uuid,uuid,text,numeric,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_stage_payment_receipt(uuid,uuid,text,numeric,text,numeric,uuid) TO authenticated;

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
 IF p_decision IS NULL OR p_decision NOT IN('accept','needs_top_up','flag') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_note'; END IF;
 IF p_decision='needs_top_up' AND (p_top_up IS NULL OR p_top_up::text IN('NaN','Infinity','-Infinity') OR p_top_up<=0 OR p_top_up>1e12 OR p_top_up<>round(p_top_up,6)) THEN RAISE EXCEPTION 'invalid_top_up'; END IF;
 IF p_decision='flag' AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
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
 IF r.decision='received' AND p_decision='needs_top_up' THEN
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
 PERFORM public.log_activity(v_project,CASE p_decision WHEN 'accept' THEN 'funding.receipt_accepted' WHEN 'needs_top_up' THEN 'funding.receipt_top_up_requested' ELSE 'funding.receipt_flagged' END,'stage_payment_receipt',r.id,auth.uid(),jsonb_build_object('stage_id',r.stage_id,'amount',r.amount,'currency',r.currency,'requested_top_up',p_top_up,'note',p_note));
 RETURN jsonb_build_object('receipt_id',r.id,'stage_id',r.stage_id,'opened',v_opened,'allows_work',p_decision='accept');
END $$;

-- Approved amendments may revise any stage without changing work or payment facts.
CREATE OR REPLACE FUNCTION public.stage_price_editable(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE s.id=p_stage AND p.status::text IN('active','on_hold','completed'))
$$;
CREATE OR REPLACE FUNCTION public.stage_pricing_context(p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.projects%ROWTYPE; v_basis jsonb; v_code text; v_rate numeric; v_total numeric; v_rows jsonb; v_hash text;v_history jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.project_member(p_project)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 SELECT * INTO p FROM public.projects WHERE id=p_project;
 IF NOT FOUND OR p.tracking_started_at IS NULL OR p.budget_usd IS NULL OR p.budget_usd<=0 THEN RAISE EXCEPTION 'pricing_not_started'; END IF;
 IF (p.budget_source='boq' OR p.pricing_revision>0) AND p.budget_currency IS NOT NULL AND p.budget_fx_rate>0 AND p.budget_amount>0 THEN
   v_code:=p.budget_currency;v_rate:=p.budget_fx_rate;v_total:=p.budget_amount;
 ELSIF p.budget_source='boq' THEN RAISE EXCEPTION 'bill_confirmation_required';
 ELSE
   v_basis:='{"CM":["XAF",600],"CI":["XOF",600],"SN":["XOF",600],"TG":["XOF",600],"BJ":["XOF",600],"NG":["NGN",1600],"GH":["GHS",16],"KE":["KES",130],"UG":["UGX",3700],"TZ":["TZS",2500],"RW":["RWF",1300],"ET":["ETB",57],"ZA":["ZAR",18],"ZM":["ZMW",28],"ZW":["USD",1],"MZ":["MZN",64],"BW":["BWP",14],"CD":["CDF",2800],"MA":["MAD",10],"EG":["EGP",48],"GB":["GBP",0.79],"US":["USD",1]}'::jsonb->upper(coalesce(p.country,''));
   v_code:=coalesce(v_basis->>0,'USD');v_rate:=coalesce((v_basis->>1)::numeric,1);v_total:=round(p.budget_usd*v_rate,6);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'stage_number',s.stage_number,'stage_key',s.stage_key,'name',s.name,
   'amount',(CASE WHEN p.budget_source='boq' OR p.pricing_revision>0 THEN s.milestone_amount ELSE round(s.payment_milestone_usd*v_rate,6) END)::text,
   'usd',s.payment_milestone_usd::text,'status',s.status,'pre_existing',s.pre_existing,'budget_pct',s.budget_pct,
   'fixed_amount_usd',s.fixed_amount_usd,'editable',public.stage_price_editable(s.id)) ORDER BY s.stage_number,s.id),'[]'::jsonb)
 INTO v_rows FROM public.project_stages s WHERE s.project_id=p_project;
 v_hash:=md5(jsonb_build_object('revision',p.pricing_revision,'source',p.budget_source,'currency',v_code,'rate',v_rate,
   'total',v_total,'usd',p.budget_usd,'state',p.status,'stages',v_rows,'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.stage_payment_receipts r WHERE r.project_id=p_project),'payments',(SELECT jsonb_agg(to_jsonb(pay) ORDER BY pay.id) FROM public.payments pay WHERE pay.project_id=p_project))::text);
 SELECT coalesce(jsonb_agg(item ORDER BY proposed_at DESC,id),'[]'::jsonb) INTO v_history FROM
 (SELECT id,proposed_at,jsonb_build_object('id',id,'status',status,'proposed_at',proposed_at,'note',note,'currency',currency,
 'old_total',old_total::text,'new_total',new_total::text,'changes',changes,'decided_at',decided_at,'stale',base_hash<>v_hash OR NOT EXISTS(SELECT 1 FROM public.contractor_invites ci WHERE ci.project_id=p_project AND ci.contractor_user_id=proposed_by AND ci.status='accepted' AND ci.is_primary),'can_withdraw',proposed_by=auth.uid() AND status='pending') AS item
 FROM public.stage_price_amendments WHERE project_id=p_project ORDER BY proposed_at DESC,id LIMIT 50) history;
 RETURN jsonb_build_object('project_id',p_project,'currency',v_code,'fx_rate',v_rate::text,'total',v_total::text,'base_hash',v_hash,'stages',v_rows,'history',v_history,
   'can_propose',public.is_primary_project_contractor(p_project) AND NOT public.is_project_client(p_project) AND p.status::text IN('active','on_hold','completed'),
   'can_approve',public.is_project_client(p_project) AND p.status::text IN('active','on_hold','completed'));
END $$;
CREATE OR REPLACE FUNCTION public.propose_stage_prices(p_project uuid,p_rows jsonb,p_base_hash text,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; r jsonb; s jsonb; v_changes jsonb:='[]'; v_amount numeric; v_delta numeric:=0; v_id uuid; v_seen uuid[]:='{}'; v_stage uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_primary_project_contractor(p_project) OR public.is_project_client(p_project) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(p_project);
 PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
 PERFORM 1 FROM public.project_stages WHERE project_id=p_project ORDER BY id FOR UPDATE;
 c:=public.stage_pricing_context(p_project);
 IF c->>'can_propose'<>'true' THEN RAISE EXCEPTION 'pricing_paused'; END IF;
 IF p_base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_prices'; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
 IF EXISTS(SELECT 1 FROM public.stage_price_amendments WHERE project_id=p_project AND status='pending') THEN RAISE EXCEPTION 'price_proposal_pending'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   IF coalesce(r->>'amount','') !~ '^\d+(\.\d{1,6})?$' OR coalesce(r->>'stage_id','') !~ '^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
   v_stage:=(r->>'stage_id')::uuid;v_amount:=(r->>'amount')::numeric;
   IF v_stage=ANY(v_seen) OR v_amount<0 OR v_amount>1e12 OR (v_amount>0 AND round(v_amount/(c->>'fx_rate')::numeric,9)<=0) THEN RAISE EXCEPTION 'invalid_stage_prices'; END IF;
   v_seen:=array_append(v_seen,v_stage);
   SELECT value INTO s FROM jsonb_array_elements(c->'stages') WHERE value->>'id'=v_stage::text;
   IF s IS NULL OR s->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_price_locked'; END IF;
   IF v_amount=(s->>'amount')::numeric THEN CONTINUE; END IF;
   v_delta:=v_delta+v_amount-(s->>'amount')::numeric;
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('stage_id',v_stage,'stage_number',s->'stage_number','stage_key',s->'stage_key','name',s->'name','before',s->>'amount','after',v_amount::text));
 END LOOP;
 IF jsonb_array_length(v_changes)=0 THEN RAISE EXCEPTION 'no_price_changes'; END IF;
 IF (c->>'total')::numeric+v_delta<=0 OR (c->>'total')::numeric+v_delta>1e12
 OR round(((c->>'total')::numeric+v_delta)/(c->>'fx_rate')::numeric,9)<=0
 OR round(((c->>'total')::numeric+v_delta)/(c->>'fx_rate')::numeric,9)>=1e15 THEN RAISE EXCEPTION 'invalid_project_total'; END IF;
 INSERT INTO public.stage_price_amendments(project_id,proposed_by,note,currency,fx_rate,old_total,new_total,base_hash,changes)
 VALUES(p_project,auth.uid(),nullif(btrim(p_note),''),c->>'currency',(c->>'fx_rate')::numeric,(c->>'total')::numeric,(c->>'total')::numeric+v_delta,c->>'base_hash',v_changes) RETURNING id INTO v_id;
 PERFORM public.log_activity(p_project,'stage_prices.proposed','stage_price_amendment',v_id,auth.uid(),jsonb_build_object('currency',c->>'currency','old_total',c->>'total','new_total',(c->>'total')::numeric+v_delta,'changes',v_changes));
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.decide_stage_prices(p_proposal uuid,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.stage_price_amendments%ROWTYPE;p public.projects%ROWTYPE;c jsonb;r jsonb;v_project uuid;v_total_usd numeric;v_delta_usd numeric:=0;v_rounding numeric;v_last uuid;v_scale int;v_sum numeric;v_fees jsonb;v_design numeric;v_build numeric;v_breakdown jsonb;v_pool numeric;v_details jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_price_amendments WHERE id=p_proposal;
 IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO a FROM public.stage_price_amendments WHERE id=p_proposal FOR UPDATE;
 IF p_decision IS NULL OR p_decision NOT IN('approved','declined','withdrawn') THEN RAISE EXCEPTION 'invalid_price_decision'; END IF;
 IF p_decision='withdrawn' THEN
   IF a.proposed_by<>auth.uid() THEN RAISE EXCEPTION 'not_proposer'; END IF;
 ELSE
   IF NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_project_client'; END IF;
 END IF;
 IF a.status=p_decision THEN RETURN; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'price_proposal_decided'; END IF;
 IF p_decision='approved' THEN
   SELECT * INTO p FROM public.projects WHERE id=v_project FOR UPDATE;
   PERFORM 1 FROM public.project_stages WHERE project_id=v_project ORDER BY id FOR UPDATE;
   c:=public.stage_pricing_context(v_project);
   IF c->>'can_approve'<>'true' THEN RAISE EXCEPTION 'pricing_paused'; END IF;
   IF a.base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_prices'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=a.proposed_by AND status='accepted' AND is_primary) THEN RAISE EXCEPTION 'proposer_assignment_changed'; END IF;
   v_scale:=6;
   FOR r IN SELECT * FROM jsonb_array_elements(a.changes) LOOP
     IF NOT public.stage_price_editable((r->>'stage_id')::uuid) THEN RAISE EXCEPTION 'stage_price_locked'; END IF;
     SELECT v_delta_usd+round((r->>'after')::numeric/a.fx_rate,9)-payment_milestone_usd INTO v_delta_usd FROM public.project_stages WHERE id=(r->>'stage_id')::uuid;
     v_scale:=greatest(v_scale,scale((r->>'after')::numeric));
   END LOOP;
   v_total_usd:=round(a.new_total/a.fx_rate,9);
   v_rounding:=v_total_usd-p.budget_usd-v_delta_usd;
   SELECT (value->>'stage_id')::uuid INTO v_last FROM jsonb_array_elements(a.changes) ORDER BY (value->>'after')::numeric DESC,value->>'stage_id' LIMIT 1;
   PERFORM set_config('app.stage_pricing_write','on',true);
   UPDATE public.project_stages s SET milestone_amount=(entry.value->>'after')::numeric,
     payment_milestone_usd=round((entry.value->>'after')::numeric/a.fx_rate,9)+CASE WHEN s.id=v_last THEN v_rounding ELSE 0 END,
     fixed_amount_usd=CASE WHEN s.fixed_amount_usd IS NULL THEN NULL ELSE round((entry.value->>'after')::numeric/a.fx_rate,9) END
     FROM jsonb_array_elements(a.changes) entry WHERE s.id=(entry.value->>'stage_id')::uuid;
   -- Freeze native values for earlier estimate stages without changing their USD history.
   IF p.budget_source IS DISTINCT FROM 'boq' AND p.pricing_revision=0 THEN
     UPDATE public.project_stages s SET milestone_amount=round(payment_milestone_usd*a.fx_rate,6) WHERE project_id=v_project
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.changes) changed WHERE (changed.value->>'stage_id')::uuid=s.id);
   ELSE
     UPDATE public.project_stages SET milestone_amount=round(payment_milestone_usd*a.fx_rate,6) WHERE project_id=v_project AND milestone_amount IS NULL;
   END IF;
   IF p.budget_source='boq' THEN
     v_pool:=a.new_total;
   ELSE
     SELECT coalesce(jsonb_object_agg(kind,amount_usd),'{}'::jsonb) INTO v_fees FROM public.project_fees WHERE project_id=v_project;
     SELECT coalesce(sum(payment_milestone_usd) FILTER(WHERE stage_key IN('land_secured','design_approvals')),0),coalesce(sum(payment_milestone_usd),0) INTO v_design,v_build FROM public.project_stages WHERE project_id=v_project;
     v_build:=v_build-v_design;
     v_breakdown:=jsonb_build_object('total',v_total_usd,'construction',v_build,'design',v_design,'permit',coalesce((v_fees->>'permit')::numeric,0),'professional',coalesce((v_fees->>'professional')::numeric,0),'verification',coalesce((v_fees->>'verification')::numeric,0),'contingency',coalesce((v_fees->>'contingency')::numeric,0),'material',round(v_build*0.6,2),'labor',v_build-round(v_build*0.6,2));
     SELECT sum(milestone_amount) INTO v_pool FROM public.project_stages WHERE project_id=v_project;
   END IF;
   UPDATE public.project_stages SET budget_pct=CASE WHEN milestone_amount=0 THEN 0 ELSE greatest(0.000001,round(milestone_amount/v_pool*100,6)) END WHERE project_id=v_project;
   SELECT sum(budget_pct) INTO v_sum FROM public.project_stages WHERE project_id=v_project;
   UPDATE public.project_stages SET budget_pct=budget_pct+100-v_sum WHERE id=(SELECT id FROM public.project_stages WHERE project_id=v_project AND budget_pct>0 ORDER BY milestone_amount DESC,id LIMIT 1);
   UPDATE public.projects SET budget_original_amount=coalesce(budget_original_amount,a.old_total),budget_original_usd=coalesce(budget_original_usd,p.budget_usd),
     budget_amount=a.new_total,budget_currency=a.currency,budget_fx_rate=a.fx_rate,budget_precision=least(6,v_scale),budget_usd=v_total_usd,
     stage_price_adjustment_usd=stage_price_adjustment_usd+v_total_usd-p.budget_usd,pricing_budget_breakdown=v_breakdown,pricing_revision=pricing_revision+1 WHERE id=v_project;
   PERFORM set_config('app.stage_pricing_write','off',true);
 END IF;
 PERFORM set_config('app.stage_price_decision','on',true);
 UPDATE public.stage_price_amendments SET status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=p_proposal;
 PERFORM set_config('app.stage_price_decision','off',true);
 v_details:=jsonb_build_object('currency',a.currency,'old_total',a.old_total,'new_total',a.new_total);
 IF p_decision='approved' THEN
   PERFORM public.log_activity(v_project,'stage_prices.approved','stage_price_amendment',a.id,auth.uid(),v_details);
 ELSIF p_decision='declined' THEN
   PERFORM public.log_activity(v_project,'stage_prices.declined','stage_price_amendment',a.id,auth.uid(),v_details);
 ELSE
   PERFORM public.log_activity(v_project,'stage_prices.withdrawn','stage_price_amendment',a.id,auth.uid(),v_details);
 END IF;
END $$;
-- Repair only the current ordered work gate of contractor-origin projects.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT s.id FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE p.status='active' AND s.status='locked' AND public.stage_starts_with_evidence(s.id)
 AND NOT EXISTS(SELECT 1 FROM public.project_stages earlier WHERE earlier.project_id=p.id AND earlier.stage_number<s.stage_number AND earlier.status<>'complete') LOOP
  PERFORM public.open_stage_if_settled(r.id);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
