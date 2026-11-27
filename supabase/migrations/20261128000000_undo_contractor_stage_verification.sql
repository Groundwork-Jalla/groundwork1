-- Contractor payment, substage pricing & project-management fixes (28 Nov 2026):
--   1. Support full vs. partial offline stage payment verification (`is_partial` and
--      `stage_total_amount` on `contractor_stage_verifications`), so entering an advance
--      on a stage (such as Stage 2 Design) records the remaining unpaid balance without
--      marking every substage as Paid.
--   2. Allow the primary contractor to undo/clear a mistakenly recorded offline stage
--      payment (`clear_contractor_stage_verification`) and revert contractor-confirmed
--      payment state back to unpaid when no bank receipts exist.
--   3. Lock recorded payment amounts against further entry, edits, or undo once uploaded
--      evidence on that stage or any of its substages has been approved by the Homeowner
--      (`payment_locked_after_approval`).
--   4. Allow contractors to input substage prices on Stage 1 (Land) and Stage 2 (Design)
--      even when their initial cost starts at 0, and keep substage pricing editable after
--      uploading design documents or progress photos as long as no substage is completed
--      and no receipts/credits/installment plans exist.
--   5. Allow a contractor to delete a contractor-created project they own when it has no
--      accepted client, no payment receipts, and no completed stages
--      (`delete_own_contractor_project`), preserving the 053 Homeowner free-plan cap.
--
-- Run in: Supabase Dashboard > SQL Editor
BEGIN;

-- ── 1. Partial offline payment columns on contractor_stage_verifications ──────
ALTER TABLE public.contractor_stage_verifications
  ADD COLUMN IF NOT EXISTS is_partial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage_total_amount numeric(24,6);

DO $$
BEGIN
  ALTER TABLE public.contractor_stage_verifications
    ADD CONSTRAINT contractor_stage_verifications_stage_total_check
    CHECK (stage_total_amount IS NULL OR (stage_total_amount > 0 AND stage_total_amount <= 1e12));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop the previous 5-parameter overload before creating the 7-parameter version with
-- defaults so PostgREST never encounters ambiguous overload resolution (PGRST203).
DROP FUNCTION IF EXISTS public.record_contractor_stage_verification(uuid, numeric, text, numeric, text);

CREATE OR REPLACE FUNCTION public.record_contractor_stage_verification(
  p_stage        uuid,
  p_amount       numeric  DEFAULT NULL,
  p_currency     text     DEFAULT NULL,
  p_fx_rate      numeric  DEFAULT NULL,
  p_note         text     DEFAULT NULL,
  p_is_partial   boolean  DEFAULT false,
  p_stage_total  numeric  DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor             uuid := auth.uid();
  v_stage             public.project_stages%ROWTYPE;
  v_project_id        uuid;
  v_usd               numeric;
  v_id                uuid;
  v_currency          text := upper(btrim(coalesce(p_currency, '')));
  v_partial           boolean := coalesce(p_is_partial, false);
  v_stage_total       numeric := p_stage_total;
  v_has_receipts      boolean := false;
  v_evidence_approved boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: stage does not exist'; END IF;

  IF NOT public.is_primary_project_contractor(v_project_id) THEN
    RAISE EXCEPTION 'not_contractor: only the project contractor may record a payment verification';
  END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF coalesce(v_stage.pre_existing, false) THEN
    RAISE EXCEPTION 'nothing_expected: pre-existing stages have no recorded payment expectation';
  END IF;

  -- Lock payment recording & editing once uploaded evidence for this stage or any
  -- substage has been approved by the Homeowner.
  SELECT (
    v_stage.status = 'complete'
    OR v_stage.approved_at IS NOT NULL
    OR v_stage.approved_by IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.project_substages sub
      WHERE sub.stage_id = p_stage
        AND (sub.approved_at IS NOT NULL OR sub.approved_by IS NOT NULL OR sub.status = 'complete')
        AND coalesce(jsonb_array_length(sub.evidence_urls), 0) > 0
    )
  ) INTO v_evidence_approved;

  IF v_evidence_approved THEN
    RAISE EXCEPTION 'payment_locked_after_approval: recorded payment amounts cannot be changed once evidence has been approved by the Homeowner';
  END IF;

  IF v_partial AND p_amount IS NULL THEN
    RAISE EXCEPTION 'invalid_amount: enter the partial amount already paid';
  END IF;

  IF p_amount IS NOT NULL THEN
    IF p_amount <= 0 OR p_amount > 1e12 THEN
      RAISE EXCEPTION 'invalid_amount: enter a positive amount up to 1 trillion';
    END IF;
    IF v_currency = '' OR v_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'invalid_currency: use a 3-letter ISO currency code';
    END IF;
    IF p_fx_rate IS NULL OR p_fx_rate <= 0 OR p_fx_rate > 1e12 THEN
      RAISE EXCEPTION 'invalid_rate: use a positive exchange rate';
    END IF;
    v_usd := round(p_amount / p_fx_rate, 9);
    IF v_usd <= 0 OR v_usd > 1e12 THEN
      RAISE EXCEPTION 'invalid_amount: converted USD amount is out of range';
    END IF;
  END IF;

  IF v_stage_total IS NOT NULL THEN
    IF v_stage_total <= 0 OR v_stage_total > 1e12 THEN
      RAISE EXCEPTION 'invalid_stage_total: enter a positive total cost for this stage';
    END IF;
    IF v_partial AND p_amount IS NOT NULL AND v_stage_total <= p_amount THEN
      RAISE EXCEPTION 'invalid_stage_total: total stage cost must be greater than the partial amount paid';
    END IF;
  END IF;

  IF NOT v_partial THEN
    v_stage_total := NULL;
  END IF;

  INSERT INTO public.contractor_stage_verifications
    (project_id, stage_id, verified_by, amount, currency, fx_rate, amount_usd, note, is_partial, stage_total_amount)
  VALUES
    (v_project_id, p_stage, v_actor,
     p_amount,
     CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
     p_fx_rate,
     v_usd,
     NULLIF(btrim(coalesce(p_note, '')), ''),
     v_partial,
     v_stage_total)
  ON CONFLICT (stage_id) DO UPDATE SET
    verified_by        = EXCLUDED.verified_by,
    verified_at        = clock_timestamp(),
    amount             = EXCLUDED.amount,
    currency           = EXCLUDED.currency,
    fx_rate            = EXCLUDED.fx_rate,
    amount_usd         = EXCLUDED.amount_usd,
    note               = EXCLUDED.note,
    is_partial         = EXCLUDED.is_partial,
    stage_total_amount = EXCLUDED.stage_total_amount
  RETURNING id INTO v_id;

  PERFORM public.log_activity(
    v_project_id,
    'stage.contractor_verified_payment',
    'project_stage',
    p_stage,
    v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_id',           p_stage,
      'amount',             p_amount,
      'currency',           CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
      'is_partial',         v_partial,
      'stage_total_amount', v_stage_total,
      'verification_id',    v_id
    ))
  );

  SELECT EXISTS (
    SELECT 1 FROM public.stage_payment_receipts r
    WHERE r.stage_id = p_stage AND r.decision IN ('received', 'accepted')
  ) INTO v_has_receipts;

  IF NOT v_partial THEN
    -- Full payment confirmed: mark incoming tranche funded and unlock stage immediately.
    PERFORM set_config('app.payments_write', 'on', true);
    UPDATE public.payments
       SET state = 'funded',
           funding_source = 'contractor_confirmed',
           confirmed_by = v_actor,
           confirmed_at = clock_timestamp()
     WHERE stage_id = p_stage AND direction = 'in' AND state NOT IN ('funded', 'reconciled');
    PERFORM set_config('app.payments_write', 'off', true);

    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages
       SET payment_status = 'paid',
           status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
     WHERE id = p_stage AND NOT coalesce(pre_existing, false);
    PERFORM set_config('app.payments_projection', 'off', true);
  ELSE
    -- Partial advance: unlock the stage for work without marking the full stage paid.
    -- If this stage was previously switched from full contractor-confirmed payment to
    -- partial (and has no bank receipts), reset contractor-confirmed funded status.
    IF NOT v_has_receipts THEN
      PERFORM set_config('app.payments_write', 'on', true);
      UPDATE public.payments
         SET state = 'expected',
             funding_source = NULL,
             confirmed_by = NULL,
             confirmed_at = NULL
       WHERE stage_id = p_stage
         AND direction = 'in'
         AND state = 'funded'
         AND funding_source = 'contractor_confirmed';
      PERFORM set_config('app.payments_write', 'off', true);
    END IF;

    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages
       SET payment_status = CASE WHEN NOT v_has_receipts THEN 'unpaid' ELSE payment_status END,
           status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
     WHERE id = p_stage AND NOT coalesce(pre_existing, false);
    PERFORM set_config('app.payments_projection', 'off', true);

    UPDATE public.project_initial_payments
    SET covered_stages = array_remove(covered_stages, v_stage.stage_number)
    WHERE project_id = v_project_id
      AND v_stage.stage_number = ANY(covered_stages);
  END IF;

  UPDATE public.project_substages
     SET status = 'pending'
   WHERE stage_id = p_stage AND status = 'locked';

  RETURN jsonb_build_object(
    'ok', true,
    'verification_id', v_id,
    'stage_id', p_stage,
    'is_partial', v_partial,
    'stage_total_amount', v_stage_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text, boolean, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text, boolean, numeric)
  TO authenticated;

-- ── 2. Undo / clear recorded offline stage payment ────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_contractor_stage_verification(
  p_stage uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor             uuid := auth.uid();
  v_stage             public.project_stages%ROWTYPE;
  v_deleted_id        uuid;
  v_prev_amt          numeric;
  v_prev_cur          text;
  v_has_receipts      boolean := false;
  v_evidence_approved boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  SELECT * INTO v_stage
  FROM public.project_stages
  WHERE id = p_stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: stage does not exist';
  END IF;

  IF NOT public.is_primary_project_contractor(v_stage.project_id) THEN
    RAISE EXCEPTION 'not_contractor: only the project contractor may clear a recorded payment';
  END IF;

  IF v_stage.status = 'complete' THEN
    RAISE EXCEPTION 'stage_completed: completed stages cannot clear recorded payments';
  END IF;

  SELECT (
    v_stage.approved_at IS NOT NULL
    OR v_stage.approved_by IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.project_substages sub
      WHERE sub.stage_id = p_stage
        AND (sub.approved_at IS NOT NULL OR sub.approved_by IS NOT NULL OR sub.status = 'complete')
        AND coalesce(jsonb_array_length(sub.evidence_urls), 0) > 0
    )
  ) INTO v_evidence_approved;

  IF v_evidence_approved THEN
    RAISE EXCEPTION 'payment_locked_after_approval: recorded payments cannot be cleared once evidence has been approved by the Homeowner';
  END IF;

  DELETE FROM public.contractor_stage_verifications
  WHERE stage_id = p_stage
  RETURNING id, amount, currency INTO v_deleted_id, v_prev_amt, v_prev_cur;

  -- Also remove this stage number from initial covered_stages if it was marked at project creation.
  UPDATE public.project_initial_payments
  SET covered_stages = array_remove(covered_stages, v_stage.stage_number)
  WHERE project_id = v_stage.project_id
    AND v_stage.stage_number = ANY(covered_stages);

  -- Revert contractor-confirmed payment state when no bank receipts or credits exist.
  SELECT EXISTS (
    SELECT 1 FROM public.stage_payment_receipts r
    WHERE r.stage_id = p_stage AND r.decision IN ('received', 'accepted')
  ) OR EXISTS (
    SELECT 1 FROM public.stage_credit_confirmations c
    WHERE c.stage_id = p_stage
  ) INTO v_has_receipts;

  IF NOT v_has_receipts THEN
    PERFORM set_config('app.payments_write', 'on', true);
    UPDATE public.payments
       SET state = 'expected',
           funding_source = NULL,
           confirmed_by = NULL,
           confirmed_at = NULL
     WHERE stage_id = p_stage
       AND direction = 'in'
       AND state = 'funded'
       AND funding_source = 'contractor_confirmed';
    PERFORM set_config('app.payments_write', 'off', true);

    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages
       SET payment_status = 'unpaid'
     WHERE id = p_stage AND NOT coalesce(pre_existing, false);
    PERFORM set_config('app.payments_projection', 'off', true);
  END IF;

  PERFORM public.log_activity(
    v_stage.project_id,
    'stage.contractor_payment_cleared',
    'project_stage',
    p_stage,
    v_actor,
    jsonb_build_object(
      'stage_id', p_stage,
      'stage_number', v_stage.stage_number,
      'previous_verification_id', v_deleted_id,
      'previous_amount', v_prev_amt,
      'previous_currency', v_prev_cur
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'stage_id', p_stage,
    'cleared', v_deleted_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clear_contractor_stage_verification(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_contractor_stage_verification(uuid)
  TO authenticated;

-- ── 3. Enable substage pricing on Stages 1 & 2 (even at 0) & after doc uploads ─
CREATE OR REPLACE FUNCTION public.stage_breakdown_editable(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id
  WHERE s.id=p_stage AND p.status='active' AND NOT coalesce(s.pre_existing,false) AND s.status<>'complete'
   AND NOT coalesce(s.review_payment_pending,false)
   AND NOT EXISTS(SELECT 1 FROM public.project_substages sub WHERE sub.stage_id=s.id AND sub.status='complete')
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans pl WHERE pl.stage_id=s.id AND pl.superseded_at IS NULL AND pl.mode='two_installments')
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts r WHERE r.stage_id=s.id AND r.decision<>'flagged')
   AND NOT EXISTS(SELECT 1 FROM public.stage_credit_confirmations c WHERE c.stage_id=s.id)
   AND NOT EXISTS(SELECT 1 FROM public.payments pay WHERE pay.stage_id=s.id AND (pay.direction='out' OR pay.state<>'expected'))
   AND (coalesce((public.stage_payment_own_totals(p_stage)->>'stage_amount')::numeric,0)>0 OR s.stage_number IN (1, 2)));
$$;
REVOKE ALL ON FUNCTION public.stage_breakdown_editable(uuid) FROM PUBLIC, anon, authenticated;

-- Allow proposing substage prices on Stage 1 and Stage 2 when the stage starts at 0:
-- the positive sum of the substage amounts becomes the proposed stage total.
CREATE OR REPLACE FUNCTION public.propose_stage_breakdown(p_stage uuid,p_lines jsonb,p_base_hash text,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.project_stages%ROWTYPE;c jsonb;l jsonb;sub jsonb;v_lines jsonb:='[]';v_seen uuid[]:='{}';v_id uuid;v_sub uuid;
 v_amount numeric;v_total numeric:=0;v_new int:=0;v_changed boolean:=false;v_name text;v_stage_amount numeric;v_proposal_total numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
 IF NOT public.is_primary_project_contractor(s.project_id) OR public.is_project_client(s.project_id) THEN RAISE EXCEPTION 'not_primary_contractor'; END IF;
 PERFORM public.lock_project_stage_progression(s.project_id);
 PERFORM 1 FROM public.project_substages WHERE stage_id=p_stage ORDER BY id FOR UPDATE;
 c:=public.stage_breakdown_context(p_stage);
 IF c->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_breakdown_locked: a stage with payments recorded keeps its breakdown'; END IF;
 IF p_base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_breakdown'; END IF;
 IF EXISTS(SELECT 1 FROM public.stage_breakdown_proposals WHERE stage_id=p_stage AND status='pending') THEN RAISE EXCEPTION 'breakdown_proposal_pending'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 60 OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l)<>'object' OR coalesce(l->>'amount','') !~ '^\d{1,13}(\.\d{1,6})?$' THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
  v_amount:=(l->>'amount')::numeric;
  IF v_amount>1e12 THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
  v_total:=v_total+v_amount;
  IF l ? 'substage_id' THEN
   IF coalesce(l->>'substage_id','') !~ '^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_stage_breakdown'; END IF;
   v_sub:=(l->>'substage_id')::uuid;
   IF v_sub=ANY(v_seen) THEN RAISE EXCEPTION 'invalid_stage_breakdown: a sub-stage appears twice'; END IF;
   v_seen:=array_append(v_seen,v_sub);
   SELECT value INTO sub FROM jsonb_array_elements(c->'substages') WHERE value->>'id'=v_sub::text;
   IF sub IS NULL THEN RAISE EXCEPTION 'invalid_stage_breakdown: not a sub-stage of this stage'; END IF;
   IF (sub->>'amount') IS NULL OR (sub->>'amount')::numeric<>v_amount THEN v_changed:=true; END IF;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('substage_id',v_sub,'name',sub->>'name','key',sub->>'key','before',sub->>'amount','amount',v_amount::text));
  ELSE
   v_name:=btrim(coalesce(l->>'name',''));
   IF length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid_stage_breakdown: a new sub-stage needs a name'; END IF;
   v_new:=v_new+1; v_changed:=true;
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('name',v_name,'before',NULL,'amount',v_amount::text));
  END IF;
 END LOOP;
 IF v_new>20 THEN RAISE EXCEPTION 'invalid_stage_breakdown: too many new sub-stages'; END IF;
 IF cardinality(v_seen)<>jsonb_array_length(c->'substages') THEN RAISE EXCEPTION 'breakdown_incomplete: every sub-stage needs an amount'; END IF;
 v_stage_amount:=coalesce((c->>'stage_amount')::numeric,0);
 IF v_stage_amount>0 THEN
  IF v_total<>v_stage_amount THEN RAISE EXCEPTION 'breakdown_total_mismatch: the sub-stage amounts must add up to the stage price'; END IF;
  v_proposal_total:=v_stage_amount;
 ELSIF s.stage_number IN (1, 2) THEN
  IF v_total<=0 OR v_total>1e12 THEN RAISE EXCEPTION 'breakdown_total_mismatch: enter substage amounts that add up to a positive stage total'; END IF;
  v_proposal_total:=v_total;
 ELSE
  RAISE EXCEPTION 'breakdown_total_mismatch: the sub-stage amounts must add up to the stage price';
 END IF;
 IF NOT v_changed AND (c->>'split')::boolean THEN RAISE EXCEPTION 'no_breakdown_changes'; END IF;
 INSERT INTO public.stage_breakdown_proposals(project_id,stage_id,proposed_by,note,currency,stage_amount,base_hash,lines)
 VALUES(s.project_id,p_stage,auth.uid(),nullif(btrim(p_note),''),c->>'currency',v_proposal_total,c->>'base_hash',v_lines) RETURNING id INTO v_id;
 PERFORM public.log_activity(s.project_id,'stage_breakdown.proposed','stage_breakdown',v_id,auth.uid(),
  jsonb_build_object('stage_id',p_stage,'stage_number',s.stage_number,'currency',c->>'currency','stage_amount',v_proposal_total::text,'lines',v_lines,'new_substages',v_new));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.propose_stage_breakdown(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_stage_breakdown(uuid,jsonb,text,text) TO authenticated;

-- When a Homeowner approves a breakdown on a 0-cost Stage 1 or Stage 2, apply the approved
-- substage sum as that stage's price (mirroring decide_stage_prices) and write all substage prices.
CREATE OR REPLACE FUNCTION public.decide_stage_breakdown(p_proposal uuid,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.stage_breakdown_proposals%ROWTYPE;p public.projects%ROWTYPE;c jsonb;v_project uuid;v_next int;v_status text;v_number int;
 v_details jsonb;v_prior text;v_stage_amount numeric;v_basis jsonb;v_rate numeric;v_old_total numeric;v_new_total numeric;
 v_delta_usd numeric;v_total_usd numeric;v_pool numeric;v_sum numeric;v_fees jsonb;v_design numeric;v_build numeric;v_breakdown jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_breakdown_proposals WHERE id=p_proposal;
 IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO a FROM public.stage_breakdown_proposals WHERE id=p_proposal FOR UPDATE;
 IF p_decision IS NULL OR p_decision NOT IN('approved','declined','withdrawn') THEN RAISE EXCEPTION 'invalid_breakdown_decision'; END IF;
 IF p_decision='withdrawn' THEN
  IF a.proposed_by<>auth.uid() THEN RAISE EXCEPTION 'not_proposer'; END IF;
 ELSIF NOT public.is_project_client(v_project) THEN RAISE EXCEPTION 'not_project_client';
 END IF;
 IF a.status=p_decision THEN RETURN; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'breakdown_proposal_decided'; END IF;
 SELECT status,stage_number INTO v_status,v_number FROM public.project_stages WHERE id=a.stage_id FOR UPDATE;
 IF p_decision='approved' THEN
  PERFORM 1 FROM public.project_substages WHERE stage_id=a.stage_id ORDER BY id FOR UPDATE;
  c:=public.stage_breakdown_context(a.stage_id);
  IF c->>'editable'<>'true' THEN RAISE EXCEPTION 'stage_breakdown_locked: a stage with payments recorded keeps its breakdown'; END IF;
  IF a.base_hash IS DISTINCT FROM c->>'base_hash' THEN RAISE EXCEPTION 'stale_stage_breakdown'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=v_project AND contractor_user_id=a.proposed_by AND status='accepted' AND is_primary) THEN
   RAISE EXCEPTION 'proposer_assignment_changed';
  END IF;

  v_stage_amount:=coalesce((c->>'stage_amount')::numeric,0);
  IF v_stage_amount<=0 AND v_number IN (1, 2) AND a.stage_amount>0 THEN
   SELECT * INTO p FROM public.projects WHERE id=v_project FOR UPDATE;
   IF (p.budget_source='boq' OR p.pricing_revision>0) AND p.budget_fx_rate>0 AND p.budget_amount>0 THEN
    v_rate:=p.budget_fx_rate;
    v_old_total:=p.budget_amount;
   ELSE
    v_basis:='{"CM":["XAF",600],"CI":["XOF",600],"SN":["XOF",600],"TG":["XOF",600],"BJ":["XOF",600],"NG":["NGN",1600],"GH":["GHS",16],"KE":["KES",130],"UG":["UGX",3700],"TZ":["TZS",2500],"RW":["RWF",1300],"ET":["ETB",57],"ZA":["ZAR",18],"ZM":["ZMW",28],"ZW":["USD",1],"MZ":["MZN",64],"BW":["BWP",14],"CD":["CDF",2800],"MA":["MAD",10],"EG":["EGP",48],"GB":["GBP",0.79],"US":["USD",1]}'::jsonb->upper(coalesce(p.country,''));
    v_rate:=coalesce((v_basis->>1)::numeric,1);
    v_old_total:=round(coalesce(p.budget_usd,0)*v_rate,6);
   END IF;
   v_new_total:=v_old_total+a.stage_amount;
   v_delta_usd:=round(a.stage_amount/v_rate,9);
   v_total_usd:=coalesce(p.budget_usd,0)+v_delta_usd;

   PERFORM set_config('app.stage_pricing_write','on',true);
   UPDATE public.project_stages
      SET milestone_amount=a.stage_amount,
          payment_milestone_usd=v_delta_usd,
          fixed_amount_usd=CASE WHEN fixed_amount_usd IS NULL THEN NULL ELSE v_delta_usd END
    WHERE id=a.stage_id;
   IF p.budget_source IS DISTINCT FROM 'boq' AND p.pricing_revision=0 THEN
    UPDATE public.project_stages
       SET milestone_amount=round(coalesce(payment_milestone_usd,0)*v_rate,6)
     WHERE project_id=v_project AND id<>a.stage_id;
   ELSE
    UPDATE public.project_stages
       SET milestone_amount=round(coalesce(payment_milestone_usd,0)*v_rate,6)
     WHERE project_id=v_project AND milestone_amount IS NULL;
   END IF;
   IF p.budget_source='boq' THEN
    v_pool:=v_new_total;
   ELSE
    SELECT coalesce(jsonb_object_agg(kind,amount_usd),'{}'::jsonb) INTO v_fees FROM public.project_fees WHERE project_id=v_project;
    SELECT coalesce(sum(payment_milestone_usd) FILTER(WHERE stage_key='designCompleted'),0),coalesce(sum(payment_milestone_usd),0)
      INTO v_design,v_build FROM public.project_stages WHERE project_id=v_project;
    v_build:=v_build-v_design;
    v_breakdown:=jsonb_build_object('total',v_total_usd,'construction',v_build,'design',v_design,'permit',coalesce((v_fees->>'permit')::numeric,0),'professional',coalesce((v_fees->>'professional')::numeric,0),'verification',coalesce((v_fees->>'verification')::numeric,0),'contingency',coalesce((v_fees->>'contingency')::numeric,0),'material',round(v_build*0.6,2),'labor',v_build-round(v_build*0.6,2));
    SELECT sum(milestone_amount) INTO v_pool FROM public.project_stages WHERE project_id=v_project;
   END IF;
   IF v_pool IS NOT NULL AND v_pool>0 THEN
    UPDATE public.project_stages
       SET budget_pct=CASE WHEN coalesce(milestone_amount,0)=0 THEN 0 ELSE greatest(0.000001,round(milestone_amount/v_pool*100,6)) END
     WHERE project_id=v_project;
    SELECT sum(budget_pct) INTO v_sum FROM public.project_stages WHERE project_id=v_project;
    UPDATE public.project_stages
       SET budget_pct=budget_pct+100-v_sum
     WHERE id=(SELECT id FROM public.project_stages WHERE project_id=v_project AND budget_pct>0 ORDER BY milestone_amount DESC,id LIMIT 1);
   END IF;
   UPDATE public.projects
      SET budget_original_amount=coalesce(budget_original_amount,v_old_total),
          budget_original_usd=coalesce(budget_original_usd,p.budget_usd),
          budget_amount=v_new_total,
          budget_currency=a.currency,
          budget_fx_rate=v_rate,
          budget_precision=greatest(coalesce(budget_precision,0),least(6,scale(a.stage_amount))),
          budget_usd=v_total_usd,
          stage_price_adjustment_usd=coalesce(stage_price_adjustment_usd,0)+v_delta_usd,
          pricing_budget_breakdown=coalesce(v_breakdown,pricing_budget_breakdown),
          pricing_revision=coalesce(pricing_revision,0)+1
    WHERE id=v_project;
   PERFORM set_config('app.stage_pricing_write','off',true);
  END IF;

  v_prior:=current_setting('app.substage_pricing_write',true);
  PERFORM set_config('app.substage_pricing_write','on',true);
  UPDATE public.project_substages sub SET price_amount=(l.value->>'amount')::numeric
   FROM jsonb_array_elements(a.lines) l WHERE l.value ? 'substage_id' AND sub.id=(l.value->>'substage_id')::uuid AND sub.stage_id=a.stage_id;
  SELECT coalesce(max(substage_number),0) INTO v_next FROM public.project_substages WHERE stage_id=a.stage_id;
  INSERT INTO public.project_substages(id,stage_id,project_id,substage_number,name,status,price_amount,added_by_breakdown)
   SELECT gen_random_uuid(),a.stage_id,a.project_id,v_next+row_number() OVER(ORDER BY x.ord),x.l->>'name',
    CASE WHEN v_status IN('active','pending_review') THEN 'pending' ELSE 'locked' END,(x.l->>'amount')::numeric,a.id
   FROM jsonb_array_elements(a.lines) WITH ORDINALITY x(l,ord) WHERE NOT (x.l ? 'substage_id');
  IF NOT public.stage_breakdown_split(a.stage_id) THEN RAISE EXCEPTION 'breakdown_total_mismatch: the sub-stage amounts must add up to the stage price'; END IF;
  UPDATE public.project_stages SET paid_by_part=true WHERE id=a.stage_id AND NOT paid_by_part;
  PERFORM set_config('app.substage_pricing_write',coalesce(v_prior,'off'),true);
 END IF;
 PERFORM set_config('app.stage_breakdown_decision','on',true);
 UPDATE public.stage_breakdown_proposals SET status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp() WHERE id=p_proposal;
 PERFORM set_config('app.stage_breakdown_decision','off',true);
 v_details:=jsonb_build_object('stage_id',a.stage_id,'stage_number',v_number,'currency',a.currency,'stage_amount',a.stage_amount,'lines',a.lines);
 IF p_decision='approved' THEN
  PERFORM public.log_activity(v_project,'stage_breakdown.approved','stage_breakdown',a.id,auth.uid(),v_details);
 ELSIF p_decision='declined' THEN
  PERFORM public.log_activity(v_project,'stage_breakdown.declined','stage_breakdown',a.id,auth.uid(),v_details);
 ELSE
  PERFORM public.log_activity(v_project,'stage_breakdown.withdrawn','stage_breakdown',a.id,auth.uid(),v_details);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.decide_stage_breakdown(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stage_breakdown(uuid,text) TO authenticated;

-- ── 4. Safe delete for contractor-created projects before client/receipt activity ─
CREATE OR REPLACE FUNCTION public.delete_own_contractor_project(
  p_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_project      public.projects%ROWTYPE;
  v_email        text;
  v_stages       integer;
  v_subs         integer;
  v_docs         integer;
  v_msgs         integer;
  v_files        jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: project does not exist';
  END IF;

  -- Strictly scoped to projects created by this contractor (Homeowner free-plan cap
  -- from migration 053 remains untouched).
  IF v_project.user_id IS DISTINCT FROM v_actor
     OR coalesce(v_project.workflow_origin, '') <> 'contractor' THEN
    RAISE EXCEPTION 'not_allowed: only the contractor who created this project may delete it';
  END IF;

  -- Never erase a project once a Homeowner/client has joined, payment receipts exist,
  -- or any stage has been completed. Those projects can be archived instead.
  IF EXISTS (
    SELECT 1 FROM public.project_viewers
    WHERE project_id = p_project_id AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'project_has_activity: a client has already joined this project — archive it instead';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stage_payment_receipts
    WHERE project_id = p_project_id AND decision <> 'flagged'
  ) THEN
    RAISE EXCEPTION 'project_has_activity: payment receipts exist on this project — archive it instead';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_stages
    WHERE project_id = p_project_id AND status = 'complete' AND NOT coalesce(pre_existing, false)
  ) THEN
    RAISE EXCEPTION 'project_has_activity: completed stages exist on this project — archive it instead';
  END IF;

  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = v_project.user_id;
  SELECT count(*)::integer INTO v_stages FROM public.project_stages    WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_subs   FROM public.project_substages WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_docs   FROM public.project_documents WHERE project_id = p_project_id;
  SELECT count(*)::integer INTO v_msgs   FROM public.project_messages  WHERE project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) INTO v_files FROM (
    SELECT jsonb_build_object('bucket', 'evidence', 'path', e.path) AS entry
      FROM public.project_substages ss
      CROSS JOIN LATERAL jsonb_array_elements_text(ss.evidence_urls) AS e(path)
     WHERE ss.project_id = p_project_id
       AND e.path <> ''
    UNION ALL
    SELECT jsonb_build_object('bucket', 'documents', 'path', d.file_path)
      FROM public.project_documents d
     WHERE d.project_id = p_project_id AND COALESCE(d.file_path, '') <> ''
    UNION ALL
    SELECT jsonb_build_object('bucket', 'certificates', 'path', c.storage_path)
      FROM public.certificates c
     WHERE c.project_id = p_project_id AND COALESCE(c.storage_path, '') <> ''
  ) AS collected;

  -- Record audit tombstone alongside admin deletions for full visibility.
  INSERT INTO public.admin_deleted_projects
    (project_id, name, owner_id, owner_email, tier, status, deleted_by, counts)
  VALUES (
    p_project_id, v_project.name, v_project.user_id, v_email,
    v_project.tier, v_project.status, v_actor,
    jsonb_build_object(
      'stages', v_stages, 'substages', v_subs,
      'documents', v_docs, 'messages', v_msgs,
      'files', jsonb_array_length(v_files),
      'contractor_self_delete', true
    )
  )
  ON CONFLICT (project_id) DO UPDATE
    SET deleted_by = EXCLUDED.deleted_by,
        deleted_at = now(),
        counts     = EXCLUDED.counts;

  DELETE FROM public.projects WHERE id = p_project_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'name', v_project.name,
    'files', v_files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_contractor_project(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_contractor_project(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
