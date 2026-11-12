-- User clarification: pay the reviewed first stage before proceeding.
-- Additive to 005/006 so an already applied migration never needs replaying.
BEGIN;
ALTER TABLE public.project_stages ADD COLUMN IF NOT EXISTS review_payment_pending boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.project_stages.review_payment_pending IS
 'Client-approved first live stage on a contractor-created project, awaiting contractor acceptance of that stage payment.';
CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(public.stage_funding_settled(s.id),false)
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
 IF TG_OP='UPDATE' AND OLD.review_payment_pending AND NEW.status='complete' AND NOT public.stage_funding_settled(NEW.id) THEN
   RAISE EXCEPTION 'reviewed_stage_payment_required: confirm the reviewed stage payment before proceeding';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_stage_payment_guard BEFORE INSERT OR UPDATE OF status,review_payment_pending ON public.project_stages
 FOR EACH ROW EXECUTE FUNCTION public.guard_review_payment_pending();


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
  v_settlement := v_settlement AND v_stage.review_payment_pending AND public.stage_starts_with_evidence(p_stage) AND public.stage_funding_settled(p_stage);
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
    -- Work approval on the first live contractor-created stage requests its OWN receipt.
    -- Keep that stage current until the contractor accepts the payment.
    IF public.stage_starts_with_evidence(p_stage) AND NOT public.stage_funding_settled(p_stage) THEN
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

CREATE OR REPLACE FUNCTION public.approve_substage(p_substage uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid; v_stage_id uuid; v_stage public.project_stages%ROWTYPE;
  v_sub public.project_substages%ROWTYPE; v_admin boolean := public.is_admin(); v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT s.project_id, sub.stage_id INTO v_project_id, v_stage_id FROM public.project_substages sub
    JOIN public.project_stages s ON s.id = sub.stage_id WHERE sub.id = p_substage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such substage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_stage FROM public.project_stages WHERE id = v_stage_id AND project_id = v_project_id FOR UPDATE;
  SELECT * INTO v_sub FROM public.project_substages WHERE id = p_substage AND stage_id = v_stage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such substage'; END IF;
  IF NOT v_admin AND NOT public.is_project_client(v_project_id) THEN RAISE EXCEPTION 'not_authorized: only the project client or staff approves updates'; END IF;
  IF coalesce(v_stage.pre_existing, false) THEN RAISE EXCEPTION 'historical_stage: this stage was completed before joining'; END IF;
  IF (v_stage.status = 'complete' OR v_stage.review_payment_pending) AND v_sub.status = 'complete' THEN
    RETURN jsonb_build_object('substage_id', p_substage, 'stage_approval', public.approve_stage(v_stage_id));
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND status IN ('on_hold','completed')) THEN RAISE EXCEPTION 'project_paused: this project is not open for progression'; END IF;
  IF v_stage.status NOT IN ('active','pending_review') THEN RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
  IF NOT v_admin THEN
    IF NOT coalesce(public.stage_work_ready(v_stage_id), false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
    IF EXISTS (SELECT 1 FROM public.contractor_invites WHERE project_id = v_project_id AND status = 'accepted')
       AND (jsonb_typeof(v_sub.evidence_urls) IS DISTINCT FROM 'array' OR jsonb_array_length(v_sub.evidence_urls) = 0) THEN
      RAISE EXCEPTION 'no_evidence: this update has no uploaded evidence to review';
    END IF;
  END IF;
  IF coalesce(public.stage_funding_settled(v_stage_id), false) THEN
    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages SET payment_status = 'paid' WHERE id = v_stage_id;
    PERFORM set_config('app.payments_projection', 'off', true);
  END IF;
  IF v_sub.status <> 'complete' THEN
    PERFORM set_config('app.approve_substage', 'on', true);
    UPDATE public.project_substages SET status = 'complete', approved_by = auth.uid(), approved_at = now() WHERE id = p_substage;
    PERFORM set_config('app.approve_substage', 'off', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = v_stage_id AND status <> 'complete') THEN
    v_result := public.approve_stage(v_stage_id);
  END IF;
  RETURN jsonb_build_object('substage_id', p_substage, 'stage_approval', v_result);
END $$;

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
  IF v_project.budget_source = 'boq' AND v_project.budget_currency IS NOT NULL
     AND v_project.budget_fx_rate > 0 THEN
    IF v_currency <> v_project.budget_currency THEN
      RAISE EXCEPTION 'receipt_currency_mismatch: use the confirmed project currency';
    END IF;
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


REVOKE ALL ON FUNCTION public.record_stage_payment_receipt(uuid,text,numeric,text,numeric) FROM PUBLIC,anon,authenticated;
-- Payment decisions and staff cash confirmations share this finalization path.
CREATE OR REPLACE FUNCTION public.finish_reviewed_stage_payment(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid; s public.project_stages%ROWTYPE; BEGIN
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage FOR UPDATE;
 IF NOT s.review_payment_pending OR NOT public.stage_starts_with_evidence(p_stage)
   OR NOT public.stage_funding_settled(p_stage) OR s.status='complete'
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
REVOKE ALL ON FUNCTION public.finish_reviewed_stage_payment(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.on_reviewed_stage_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.direction='in' AND NEW.stage_id IS NOT NULL AND NEW.state IN('funded','reconciled') THEN
   PERFORM public.finish_reviewed_stage_payment(NEW.stage_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_stage_payment_confirmed AFTER INSERT OR UPDATE OF state ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.on_reviewed_stage_payment();
CREATE OR REPLACE FUNCTION public.on_reviewed_project_resume()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record; BEGIN
 IF NEW.status='active' AND OLD.status IS DISTINCT FROM 'active' THEN
   FOR s IN SELECT id FROM public.project_stages WHERE project_id=NEW.id AND review_payment_pending LOOP
     PERFORM public.finish_reviewed_stage_payment(s.id);
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_stage_payment_resumed AFTER UPDATE OF status ON public.projects
 FOR EACH ROW EXECUTE FUNCTION public.on_reviewed_project_resume();
COMMIT;
