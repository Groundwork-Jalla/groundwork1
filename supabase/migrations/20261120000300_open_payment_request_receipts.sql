-- Allow Homeowners to submit payment receipts on an active contractor-led stage
-- whenever the contractor has explicitly raised an open payment request on that stage
-- (`substage_payment_requests.status = 'open'`), instead of blocking with `receipt_gated`
-- until all stage work is approved.
--
-- Safe & idempotent: preserves all existing checks, locking, and REVOKE permissions.
BEGIN;

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
  v_project_id uuid;
  v_existing public.stage_payment_receipts%ROWTYPE;
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
    OR (public.stage_starts_with_evidence(p_stage)
        AND NOT v_stage.review_payment_pending
        AND NOT EXISTS (
          SELECT 1 FROM public.substage_payment_requests spr
          WHERE spr.stage_id = p_stage AND spr.status = 'open'
        ))
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
  UPDATE public.payments SET state = 'receipt_submitted', receipt_path = v_path,
    receipt_uploaded_by = v_actor, receipt_uploaded_at = clock_timestamp(),
    receipt_amount = p_amount, receipt_currency = v_currency,
    receipt_fx_rate = v_rate, receipt_amount_usd = v_usd
    WHERE id = v_payment.id AND state NOT IN('funded','reconciled');
  PERFORM set_config('app.receipt_write','off',true);
  PERFORM set_config('app.payments_write','off',true);
  PERFORM set_config('app.stage_receipt_write','on',true);
  INSERT INTO public.stage_payment_receipts(payment_id,project_id,stage_id,path,submitted_by,submitted_at,amount,currency,fx_rate,amount_usd)
  VALUES(v_payment.id,v_project_id,p_stage,v_path,v_actor,clock_timestamp(),p_amount,v_currency,v_rate,v_usd);
  PERFORM set_config('app.stage_receipt_write','off',true);
  PERFORM public.log_activity(v_stage.project_id,'funding.receipt_submitted','project_stage',p_stage,v_actor,
    jsonb_build_object('stage_number',v_stage.stage_number,'tranches',1,
      'receipt_amount',p_amount,'receipt_currency',v_currency,'receipt_fx_rate',v_rate,'receipt_amount_usd',v_usd));
  RETURN jsonb_build_object('stage_id',p_stage,'tranches',1,'receipt_id',(SELECT id FROM public.stage_payment_receipts WHERE project_id=v_project_id AND path=v_path));
END $$;

REVOKE ALL ON FUNCTION public.record_stage_payment_receipt(uuid,text,numeric,text,numeric)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
