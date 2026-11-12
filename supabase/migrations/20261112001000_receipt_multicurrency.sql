-- Receipts retain their transaction currency and a server-attested conversion.
BEGIN;
ALTER TABLE public.receipt_readings
 ADD COLUMN IF NOT EXISTS fx_rate numeric(24,12),
 ADD COLUMN IF NOT EXISTS project_currency text,
 ADD COLUMN IF NOT EXISTS project_fx_rate numeric(24,12),
 ADD COLUMN IF NOT EXISTS fx_source text,
 ADD COLUMN IF NOT EXISTS fx_as_of timestamptz;
ALTER TABLE public.receipt_readings ADD CONSTRAINT receipt_reading_conversion CHECK(
 (fx_rate IS NULL AND project_currency IS NULL AND project_fx_rate IS NULL AND fx_source IS NULL AND fx_as_of IS NULL)
 OR (fx_rate IS NOT NULL AND fx_rate>0 AND fx_rate<=1e12 AND (currency<>'USD' OR fx_rate=1)
 AND project_currency IS NOT NULL AND project_currency ~ '^[A-Z]{3}$' AND project_fx_rate IS NOT NULL AND project_fx_rate>0 AND project_fx_rate<=1e12
 AND (project_currency<>'USD' OR project_fx_rate=1) AND fx_source IS NOT NULL AND fx_source IN('project','USD','ExchangeRate-API') AND fx_as_of IS NOT NULL));
ALTER TABLE public.stage_payment_receipts
 ADD COLUMN IF NOT EXISTS project_currency text,
 ADD COLUMN IF NOT EXISTS project_fx_rate numeric(24,12),
 ADD COLUMN IF NOT EXISTS project_amount numeric(24,6),
 ADD COLUMN IF NOT EXISTS fx_source text,
 ADD COLUMN IF NOT EXISTS fx_as_of timestamptz;
ALTER TABLE public.stage_payment_receipts ADD CONSTRAINT stage_receipt_project_conversion CHECK(
 (project_currency IS NULL AND project_fx_rate IS NULL AND project_amount IS NULL AND fx_source IS NULL AND fx_as_of IS NULL)
 OR (project_currency IS NOT NULL AND project_currency ~ '^[A-Z]{3}$' AND project_fx_rate IS NOT NULL AND project_fx_rate>0 AND project_fx_rate<=1e12
 AND project_amount IS NOT NULL AND project_amount>0 AND project_amount<=1e12 AND fx_source IS NOT NULL AND fx_as_of IS NOT NULL
 AND project_amount=CASE WHEN currency=project_currency THEN amount ELSE round(amount_usd*project_fx_rate,6) END));
CREATE OR REPLACE FUNCTION public.attach_receipt_conversion(p_reading uuid,p_rate numeric,p_project_currency text,p_project_rate numeric,p_source text,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.receipt_readings%ROWTYPE; p public.projects%ROWTYPE; v_rate numeric; v_project_rate numeric; v_code text; v_source text; BEGIN
 SELECT * INTO r FROM public.receipt_readings WHERE id=p_reading FOR UPDATE;
 IF NOT FOUND OR r.status<>'matched' THEN RAISE EXCEPTION 'receipt_reading_required'; END IF;
 IF r.fx_rate IS NULL THEN
  SELECT * INTO STRICT p FROM public.projects WHERE id=r.project_id;
  IF p.budget_source='boq' AND p.budget_currency IS NOT NULL AND p.budget_fx_rate>0 THEN
    v_code:=p.budget_currency; v_project_rate:=p.budget_fx_rate;
  ELSE v_code:=p_project_currency; v_project_rate:=p_project_rate; END IF;
  v_rate:=CASE WHEN r.currency=v_code THEN v_project_rate WHEN r.currency='USD' THEN 1 ELSE p_rate END;
  v_source:=CASE WHEN r.currency=v_code THEN 'project' WHEN r.currency='USD' THEN 'USD' ELSE p_source END;
  IF v_rate IS NULL OR v_rate::text IN('NaN','Infinity','-Infinity') OR v_rate<=0 OR v_rate>1e12 OR round(v_rate,12)<=0
    OR v_project_rate IS NULL OR v_project_rate::text IN('NaN','Infinity','-Infinity') OR v_project_rate<=0 OR v_project_rate>1e12
    OR v_code IS NULL OR v_code !~ '^[A-Z]{3}$' OR (v_code='USD' AND v_project_rate<>1)
    OR v_source NOT IN('project','USD','ExchangeRate-API') OR v_source IS NULL OR p_as_of IS NULL OR p_as_of>clock_timestamp()+interval '5 minutes'
    THEN RAISE EXCEPTION 'receipt_rate_unavailable'; END IF;
  IF v_source='ExchangeRate-API' AND p_as_of<clock_timestamp()-interval '48 hours' THEN RAISE EXCEPTION 'receipt_rate_unavailable'; END IF;
  UPDATE public.receipt_readings SET fx_rate=round(v_rate,12),project_currency=v_code,project_fx_rate=round(v_project_rate,12),fx_source=v_source,fx_as_of=p_as_of WHERE id=p_reading RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('fx_rate',r.fx_rate::text,'project_currency',r.project_currency,'project_fx_rate',r.project_fx_rate::text,'fx_source',r.fx_source,'fx_as_of',r.fx_as_of);
END $$;
REVOKE ALL ON FUNCTION public.attach_receipt_conversion(uuid,numeric,text,numeric,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_receipt_conversion(uuid,numeric,text,numeric,text,timestamptz) TO service_role;


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
  IF v_project.status IN('on_hold','completed') OR v_stage.status='complete'
    OR (public.stage_starts_with_evidence(p_stage) AND NOT v_stage.review_payment_pending)
    OR EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=v_project_id AND stage_number<v_stage.stage_number AND status<>'complete') THEN
    RAISE EXCEPTION 'receipt_gated: review and approve the preceding stage updates first';
  END IF;
  IF EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=p_stage AND decision='pending') THEN
    RAISE EXCEPTION 'receipt_pending_review: the submitted receipt is ready for contractor review';
  END IF;
  SELECT * INTO v_payment FROM public.payments
    WHERE stage_id = p_stage AND direction = 'in' FOR UPDATE;
  IF NOT FOUND OR v_payment.state NOT IN ('expected','receipt_submitted') THEN
    RAISE EXCEPTION 'nothing_expected: no payment is waiting for a receipt';
  END IF;
  IF v_payment.state = 'receipt_submitted' AND v_payment.receipt_path = v_path
     AND v_payment.receipt_amount = p_amount AND v_payment.receipt_currency = v_currency
     AND v_payment.receipt_fx_rate = v_rate THEN
    RETURN jsonb_build_object('stage_id',p_stage,'tranches',1,'already_submitted',true);
  END IF;
  PERFORM set_config('app.payments_write','on',true);
  PERFORM set_config('app.receipt_write','on',true);
  UPDATE public.payments SET state = 'receipt_submitted', receipt_path = v_path,
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
  RETURN jsonb_build_object('stage_id',p_stage,'tranches',1);
END $$;

CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(p_stage uuid,p_path text,p_amount numeric,p_currency text,p_fx_rate numeric,p_reading uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE proof public.receipt_readings%ROWTYPE; v_object storage.objects%ROWTYPE; v_result jsonb; v_existing public.stage_payment_receipts%ROWTYPE; v_project uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND OR NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_client'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO proof FROM public.receipt_readings WHERE id=p_reading FOR UPDATE;
 IF NOT FOUND OR proof.submitted_by<>auth.uid() OR proof.stage_id<>p_stage OR proof.project_id<>v_project
 OR proof.status<>'matched' OR proof.path<>p_path OR proof.amount IS DISTINCT FROM p_amount OR proof.currency IS DISTINCT FROM p_currency
 THEN RAISE EXCEPTION 'receipt_reading_required: match the amount and currency on the uploaded receipt'; END IF;
 SELECT * INTO v_existing FROM public.stage_payment_receipts WHERE reading_id=p_reading;
 IF FOUND THEN
   IF v_existing.stage_id<>p_stage OR v_existing.path<>p_path OR v_existing.amount IS DISTINCT FROM p_amount OR v_existing.currency IS DISTINCT FROM p_currency THEN RAISE EXCEPTION 'receipt_already_used'; END IF;
   RETURN jsonb_build_object('stage_id',p_stage,'receipt_id',v_existing.id,'already_submitted',true);
 END IF;
 IF proof.fx_rate IS NULL OR proof.project_currency IS NULL OR proof.project_fx_rate IS NULL OR proof.fx_source IS NULL OR proof.fx_as_of IS NULL THEN RAISE EXCEPTION 'receipt_conversion_required: check the receipt with a saved conversion'; END IF;
 IF p_fx_rate IS NOT NULL AND p_fx_rate IS DISTINCT FROM proof.fx_rate THEN RAISE EXCEPTION 'receipt_rate_mismatch: use the saved receipt conversion'; END IF;
 IF proof.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'receipt_reading_expired'; END IF;
 SELECT * INTO v_object FROM storage.objects WHERE bucket_id='evidence' AND name=p_path FOR SHARE;
 IF NOT FOUND OR v_object.id<>proof.object_id OR v_object.version IS DISTINCT FROM proof.object_version THEN RAISE EXCEPTION 'receipt_file_changed: read the current uploaded file'; END IF;
 v_result:=public.record_stage_payment_receipt(p_stage,p_path,p_amount,p_currency,proof.fx_rate);
 PERFORM set_config('app.stage_receipt_write','on',true);
 UPDATE public.stage_payment_receipts SET reading_id=p_reading,project_currency=proof.project_currency,project_fx_rate=proof.project_fx_rate,
   project_amount=CASE WHEN currency=proof.project_currency THEN amount ELSE round(amount_usd*proof.project_fx_rate,6) END,
   fx_source=proof.fx_source,fx_as_of=proof.fx_as_of WHERE stage_id=p_stage AND path=p_path;
 PERFORM set_config('app.stage_receipt_write','off',true);
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.guard_stage_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF current_setting('app.stage_receipt_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'receipt_via_rpc: use the receipt workflow'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'receipt_immutable: a receipt is retained in the project record'; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.payment_id,NEW.project_id,NEW.stage_id,NEW.path,NEW.submitted_by,NEW.submitted_at,NEW.amount,NEW.currency,NEW.fx_rate,NEW.amount_usd,NEW.legacy_unknown)
 IS DISTINCT FROM ROW(OLD.payment_id,OLD.project_id,OLD.stage_id,OLD.path,OLD.submitted_by,OLD.submitted_at,OLD.amount,OLD.currency,OLD.fx_rate,OLD.amount_usd,OLD.legacy_unknown)
 THEN RAISE EXCEPTION 'receipt_immutable: submitted receipt details stay fixed'; END IF;
 IF TG_OP='UPDATE' AND OLD.reading_id IS NOT NULL AND ROW(NEW.reading_id,NEW.project_currency,NEW.project_fx_rate,NEW.project_amount,NEW.fx_source,NEW.fx_as_of)
 IS DISTINCT FROM ROW(OLD.reading_id,OLD.project_currency,OLD.project_fx_rate,OLD.project_amount,OLD.fx_source,OLD.fx_as_of) THEN
   RAISE EXCEPTION 'receipt_immutable: the saved conversion stays fixed';
 END IF;
 RETURN NEW;
END $$;


REVOKE ALL ON FUNCTION public.record_stage_payment_receipt(uuid,text,numeric,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
