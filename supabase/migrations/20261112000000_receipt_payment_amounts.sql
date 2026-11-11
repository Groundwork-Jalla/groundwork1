-- Record what the client actually paid, separately from the agreed stage schedule.
-- Apply after the confirmed BoQ budget and invitation migrations.
BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS receipt_currency text,
  ADD COLUMN IF NOT EXISTS receipt_fx_rate numeric(24,12),
  ADD COLUMN IF NOT EXISTS receipt_amount_usd numeric(24,9);

-- Existing receipts did not record an amount. Preserve that unknown rather than
-- inventing a payment from the scheduled milestone. New receipts supply all four.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_amount_shape;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_amount_shape CHECK (
  (receipt_amount IS NULL AND receipt_currency IS NULL
    AND receipt_fx_rate IS NULL AND receipt_amount_usd IS NULL)
  OR (
    direction = 'in' AND receipt_path IS NOT NULL
    AND receipt_uploaded_by IS NOT NULL AND receipt_uploaded_at IS NOT NULL
    AND receipt_amount IS NOT NULL AND receipt_currency IS NOT NULL
    AND receipt_fx_rate IS NOT NULL AND receipt_amount_usd IS NOT NULL
    AND receipt_amount > 0 AND receipt_amount <= 1e12
    AND receipt_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND receipt_currency ~ '^[A-Z]{3}$'
    AND receipt_fx_rate > 0 AND receipt_fx_rate <= 1e12
    AND receipt_fx_rate::text NOT IN ('NaN','Infinity','-Infinity')
    AND (receipt_currency <> 'USD' OR receipt_fx_rate = 1)
    AND receipt_amount_usd > 0 AND receipt_amount_usd <= 1e12
    AND receipt_amount_usd = round(receipt_amount / receipt_fx_rate, 9)
  )
);

COMMENT ON COLUMN public.payments.receipt_amount IS
  'Actual amount on the client payment receipt, in receipt_currency. Null means not recorded; never substitute the scheduled amount.';
COMMENT ON COLUMN public.payments.receipt_fx_rate IS
  'Receipt currency units per USD, fixed when submitted. Confirmed BoQ projects use their contractual FX snapshot.';
COMMENT ON COLUMN public.payments.receipt_amount_usd IS
  'Actual receipt amount converted at its saved FX snapshot. Counts as a payout only after contractor/staff acknowledgment.';

-- Keep 090's ledger protections and admit the receipt transitions introduced by
-- 175. The earlier guard still rejected those transitions even after 175 ran.
CREATE OR REPLACE FUNCTION public.payments_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_milestone numeric; v_ok boolean; v_receipt_changed boolean;
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    SELECT payment_milestone_usd INTO v_milestone
      FROM public.project_stages WHERE id = NEW.stage_id AND project_id = NEW.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stage_mismatch: stage % does not belong to project %', NEW.stage_id, NEW.project_id;
    END IF;
    IF NEW.direction = 'out' AND v_milestone IS NOT NULL AND NEW.amount > v_milestone THEN
      RAISE EXCEPTION 'over_milestone: % exceeds the stage milestone %', NEW.amount, v_milestone;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 'out' AND current_setting('app.payments_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'payments_via_rpc: a release is authorised through authorise_release()';
    END IF;
    IF NEW.direction = 'in' AND NEW.state <> 'expected' THEN
      RAISE EXCEPTION 'wrong_state: an in row starts as expected';
    END IF;
    IF NEW.direction = 'out' AND NEW.state <> 'release_authorised' THEN
      RAISE EXCEPTION 'wrong_state: an out row starts as release_authorised';
    END IF;
    IF NEW.receipt_amount IS NOT NULL OR NEW.receipt_path IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_via_rpc: submit a receipt through submit_stage_payment_receipt()';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.direction <> OLD.direction
     OR (NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL)
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'immutable: project, stage, direction and created_at do not change';
  END IF;
  IF NEW.amount <> OLD.amount AND OLD.state <> 'expected' THEN
    RAISE EXCEPTION 'immutable: amount is fixed once money is received or authorised';
  END IF;
  IF OLD.authorised_by IS NOT NULL AND (NEW.authorised_by IS DISTINCT FROM OLD.authorised_by
                                        OR NEW.authorised_at IS DISTINCT FROM OLD.authorised_at) THEN
    RAISE EXCEPTION 'immutable: authorisation is a record, not a field';
  END IF;
  IF OLD.confirmed_by IS NOT NULL AND (NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
                                       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
                                       OR NEW.funding_source IS DISTINCT FROM OLD.funding_source) THEN
    RAISE EXCEPTION 'immutable: confirmation is a record, not a field';
  END IF;
  v_receipt_changed := ROW(NEW.receipt_path, NEW.receipt_uploaded_by, NEW.receipt_uploaded_at,
    NEW.receipt_amount, NEW.receipt_currency, NEW.receipt_fx_rate, NEW.receipt_amount_usd)
    IS DISTINCT FROM ROW(OLD.receipt_path, OLD.receipt_uploaded_by, OLD.receipt_uploaded_at,
    OLD.receipt_amount, OLD.receipt_currency, OLD.receipt_fx_rate, OLD.receipt_amount_usd);
  IF v_receipt_changed THEN
    IF OLD.state IN ('funded','reconciled') THEN
      RAISE EXCEPTION 'immutable: a confirmed receipt cannot be replaced';
    END IF;
    IF NEW.direction <> 'in' OR NEW.state <> 'receipt_submitted'
       OR current_setting('app.receipt_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'receipt_via_rpc: submit a receipt through submit_stage_payment_receipt()';
    END IF;
  END IF;
  IF NEW.state = 'receipt_submitted' AND (v_receipt_changed OR NEW.state IS DISTINCT FROM OLD.state)
     AND NEW.receipt_amount IS NULL THEN
    RAISE EXCEPTION 'amount_required: enter the amount on the receipt';
  END IF;
  IF NEW.state <> OLD.state THEN
    IF current_setting('app.payments_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'payments_via_rpc: payment states change through their RPCs';
    END IF;
    v_ok := (OLD.direction = 'in' AND (OLD.state, NEW.state) IN (
      ('expected','receipt_submitted'), ('receipt_submitted','funded'),
      ('expected','funded'), ('funded','reconciled')))
      OR (OLD.direction = 'out' AND (OLD.state, NEW.state) IN (
        ('release_authorised','initiated'), ('initiated','disbursed'), ('initiated','failed'),
        ('failed','reconciling'), ('reconciling','disbursed'), ('reconciling','failed')));
    IF NOT v_ok THEN
      RAISE EXCEPTION 'wrong_state: % → % is not a transition', OLD.state, NEW.state;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(
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
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
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
  PERFORM public.log_activity(v_stage.project_id,'funding.receipt_submitted','project_stage',p_stage,v_actor,
    jsonb_build_object('stage_number',v_stage.stage_number,'tranches',1,
      'receipt_amount',p_amount,'receipt_currency',v_currency,'receipt_fx_rate',v_rate,'receipt_amount_usd',v_usd));
  RETURN jsonb_build_object('stage_id',p_stage,'tranches',1);
END $$;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid,text,numeric,text,numeric) TO authenticated;

-- Older clients must ask for the real amount instead of silently assigning a
-- scheduled amount. Keep the signature so they receive an actionable refusal.
CREATE OR REPLACE FUNCTION public.submit_stage_payment_receipt(p_stage uuid,p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'amount_required: refresh the page and enter the amount on your receipt';
END $$;
REVOKE ALL ON FUNCTION public.submit_stage_payment_receipt(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stage_payment_receipt(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_stage_payment(
  p_stage uuid,p_note text,p_receipt_path text,p_receipt_uploaded_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.project_stages%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_actor uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_opened boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  IF NOT v_admin AND NOT public.is_contractor_on(v_stage.project_id,v_actor) THEN
    RAISE EXCEPTION 'not_contractor: only the contractor or staff confirms payment';
  END IF;
  SELECT * INTO v_payment FROM public.payments
    WHERE stage_id = p_stage AND direction = 'in' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nothing_to_confirm: no incoming payment is waiting'; END IF;
  IF v_payment.state IN ('funded','reconciled') THEN
    RETURN jsonb_build_object('stage_id',p_stage,'tranches_confirmed',0,'opened',false,'already_confirmed',true);
  END IF;
  IF v_payment.state = 'expected' AND NOT v_admin THEN
    RAISE EXCEPTION 'no_receipt: the client has not uploaded a receipt';
  END IF;
  IF v_payment.state = 'receipt_submitted' AND v_payment.receipt_amount IS NULL THEN
    RAISE EXCEPTION 'amount_required: the client must resubmit the receipt with its actual amount';
  END IF;
  IF v_payment.state = 'receipt_submitted' AND (
    p_receipt_path IS DISTINCT FROM v_payment.receipt_path
    OR p_receipt_uploaded_at IS DISTINCT FROM v_payment.receipt_uploaded_at
  ) THEN
    RAISE EXCEPTION 'stale_receipt: the receipt changed; refresh and review it before confirming';
  END IF;
  IF v_payment.state NOT IN ('expected','receipt_submitted') THEN
    RAISE EXCEPTION 'nothing_to_confirm: no incoming payment is waiting';
  END IF;
  PERFORM set_config('app.payments_write','on',true);
  UPDATE public.payments SET state = 'funded',
    funding_source = CASE WHEN v_admin THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,
    confirmed_by = v_actor, confirmed_at = now(), note = coalesce(nullif(btrim(p_note),''),note)
    WHERE id = v_payment.id;
  PERFORM set_config('app.payments_write','off',true);
  -- Funding is acknowledged by both parties even when their negotiated transfer
  -- differs from the planned stage allocation. The schedule itself never changes.
  PERFORM set_config('app.payments_projection','on',true);
  UPDATE public.project_stages SET payment_status = 'paid' WHERE id = p_stage;
  PERFORM set_config('app.payments_projection','off',true);
  PERFORM public.log_activity(v_stage.project_id,'funding.received','project_stage',p_stage,v_actor,
    jsonb_strip_nulls(jsonb_build_object('stage_number',v_stage.stage_number,'tranches',1,
      'funding_source',CASE WHEN v_admin THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,
      'by',CASE WHEN v_admin THEN 'admin' ELSE 'contractor' END,'note',nullif(btrim(p_note),''),
      'receipt_amount',v_payment.receipt_amount,'receipt_currency',v_payment.receipt_currency,
      'receipt_fx_rate',v_payment.receipt_fx_rate,'receipt_amount_usd',v_payment.receipt_amount_usd)));
  v_opened := public.open_stage_if_settled(p_stage);
  RETURN jsonb_build_object('stage_id',p_stage,'tranches_confirmed',1,'opened',v_opened);
END $$;
REVOKE ALL ON FUNCTION public.confirm_stage_payment(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_stage_payment(uuid,text,text,timestamptz) TO authenticated;

-- Admins retain the no-receipt cash fallback. A receipt acknowledgment needs the
-- exact revision the contractor reviewed, so older clients cannot confirm unseen
-- replacements through the former two-argument API.
CREATE OR REPLACE FUNCTION public.confirm_stage_payment(p_stage uuid,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.confirm_stage_payment(p_stage,p_note,NULL::text,NULL::timestamptz);
END $$;
REVOKE ALL ON FUNCTION public.confirm_stage_payment(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_stage_payment(uuid,text) TO authenticated;

-- Both participants refresh their receipt summary when the other submits or
-- confirms it. Preserve environments without Realtime (including local tests).
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables)
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $realtime$;

COMMIT;
