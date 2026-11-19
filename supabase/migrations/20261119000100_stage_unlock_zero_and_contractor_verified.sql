-- Unlock stages reliably for:
--   1. Zero-cost stages (including NULL payment_milestone_usd / milestone_amount = 0),
--      fixing the Nov 19 zero-stage unlocking edge case.
--   2. Contractor-verified offline payments (contractor_stage_verifications), so
--      answering "Yes" immediately unlocks the stage without waiting for a receipt.
--
-- Apply after 20261119000000_contractor_recorded_payments.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (coalesce(s.payment_milestone_usd, 0) <= 0 AND coalesce(s.milestone_amount, 0) <= 0)
   OR EXISTS(SELECT 1 FROM public.contractor_stage_verifications csv WHERE csv.stage_id = s.id)
   OR (coalesce(public.stage_funding_settled(s.id), false)
   AND NOT EXISTS(SELECT 1 FROM public.stage_payment_plans WHERE stage_id = s.id AND status <> 'accepted' AND superseded_at IS NULL))
   OR (coalesce(public.stage_starts_with_evidence(s.id), false) AND NOT s.review_payment_pending AND s.status <> 'complete')
   OR (s.status <> 'complete' AND public.stage_breakdown_split(s.id)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.substage_payment_state(s.id)) e WHERE (e->>'work_ready')::boolean AND e->>'status' <> 'complete'))
 FROM public.project_stages s WHERE s.id = p_stage;
$$;
REVOKE ALL ON FUNCTION public.stage_work_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_work_ready(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stage_progression_authorized(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb; BEGIN
 t := public.stage_payment_totals(p_stage);
 IF coalesce((t->>'stage_amount')::numeric <= 0, false) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.contractor_stage_verifications WHERE stage_id = p_stage) THEN RETURN true; END IF;
 IF NOT coalesce(public.stage_funding_settled(p_stage), false) THEN RETURN false; END IF;
 RETURN coalesce((t->>'remaining')::numeric = 0, false)
  OR EXISTS(SELECT 1 FROM public.stage_progression_authorizations a WHERE a.stage_id = p_stage
   AND a.currency = t->>'currency' AND a.stage_amount IS NOT DISTINCT FROM (t->>'stage_amount')::numeric)
  OR (NOT EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id = p_stage)
   AND NOT EXISTS(SELECT 1 FROM public.stage_credit_confirmations WHERE stage_id = p_stage));
END $$;
REVOKE ALL ON FUNCTION public.stage_progression_authorized(uuid) FROM PUBLIC, anon, authenticated;

-- Also open the stage immediately when the contractor records an offline verification.
CREATE OR REPLACE FUNCTION public.record_contractor_stage_verification(
  p_stage     uuid,
  p_amount    numeric  DEFAULT NULL,
  p_currency  text     DEFAULT NULL,
  p_fx_rate   numeric  DEFAULT NULL,
  p_note      text     DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_stage      public.project_stages%ROWTYPE;
  v_project_id uuid;
  v_usd        numeric;
  v_id         uuid;
  v_currency   text := upper(btrim(coalesce(p_currency, '')));
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

  INSERT INTO public.contractor_stage_verifications
    (project_id, stage_id, verified_by, amount, currency, fx_rate, amount_usd, note)
  VALUES
    (v_project_id, p_stage, v_actor,
     p_amount,
     CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
     p_fx_rate,
     v_usd,
     NULLIF(btrim(coalesce(p_note, '')), ''))
  ON CONFLICT (stage_id) DO UPDATE SET
    verified_by  = EXCLUDED.verified_by,
    verified_at  = clock_timestamp(),
    amount       = EXCLUDED.amount,
    currency     = EXCLUDED.currency,
    fx_rate      = EXCLUDED.fx_rate,
    amount_usd   = EXCLUDED.amount_usd,
    note         = EXCLUDED.note
  RETURNING id INTO v_id;

  PERFORM public.log_activity(
    v_project_id,
    'stage.contractor_verified_payment',
    'project_stage',
    p_stage,
    v_actor,
    jsonb_build_object(
      'stage_id',        p_stage,
      'amount',          p_amount,
      'currency',        CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
      'verification_id', v_id
    )
  );

  -- Unlock the stage immediately if it was waiting on payment.
  PERFORM public.open_stage_if_settled(p_stage);

  RETURN jsonb_build_object('ok', true, 'verification_id', v_id, 'stage_id', p_stage);
END;
$$;
REVOKE ALL ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contractor_stage_verification(uuid, numeric, text, numeric, text)
  TO authenticated;

-- ── Substage / stage payment requests (19 Nov) ────────────────────────────────
-- Stores payment requests triggered by the contractor's per-substage "Request payment"
-- button (with requested amount) or the stage-level "Request payment from Homeowner".
CREATE TABLE IF NOT EXISTS public.substage_payment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id      uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  substage_id   uuid REFERENCES public.project_substages(id) ON DELETE CASCADE,
  amount        numeric(24,6) CHECK(amount IS NULL OR (amount > 0 AND amount <= 1e12)),
  currency      text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  note          text CHECK(length(note) <= 2000),
  requested_by  uuid,
  requested_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  status        text NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'fulfilled', 'cancelled')),
  CHECK((amount IS NULL AND currency IS NULL) OR (amount IS NOT NULL AND currency IS NOT NULL))
);
ALTER TABLE public.substage_payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spr_member_read ON public.substage_payment_requests;
CREATE POLICY spr_member_read ON public.substage_payment_requests FOR SELECT TO authenticated
  USING(public.is_admin() OR public.project_member(project_id));
GRANT SELECT ON public.substage_payment_requests TO authenticated;
CREATE INDEX IF NOT EXISTS spr_project_stage_idx
  ON public.substage_payment_requests(project_id, stage_id, requested_at DESC);

-- Extend emit_project_event to recognize 'payment_requested'.
CREATE OR REPLACE FUNCTION public.emit_project_event(p_project uuid, p_actor uuid, p_event text, p_key text, p_data jsonb DEFAULT '{}'::jsonb, p_include_actor boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person record;project_name text;stage_no integer;stage_id uuid;tab text;title text;body text;payload jsonb:=coalesce(p_data,'{}');BEGIN
 SELECT name INTO project_name FROM public.projects WHERE id=p_project;
 IF NOT FOUND THEN RETURN; END IF;
 title:=CASE p_event
  WHEN 'project_created' THEN 'Project created'
  WHEN 'project_updated' THEN 'Project updated'
  WHEN 'evidence_uploaded' THEN 'Work update ready for review'
  WHEN 'substage_approved' THEN 'Work update approved'
  WHEN 'stage_review_requested' THEN 'Stage ready for review'
  WHEN 'stage_rework_requested' THEN 'Stage changes requested'
  WHEN 'stage_work_approved' THEN 'Stage work approved'
  WHEN 'stage_approved' THEN 'Stage completed'
  WHEN 'stage_opened' THEN 'Stage ready to begin'
  WHEN 'stage_awaiting_payment' THEN 'Stage payment available'
  WHEN 'stage_payment_settled' THEN 'Stage payment settled'
  WHEN 'payment_requested' THEN 'Payment requested by contractor'
  WHEN 'receipt_submitted' THEN 'Payment receipt ready for confirmation'
  WHEN 'receipt_replaced' THEN 'Payment receipt replaced'
  WHEN 'receipt_received' THEN 'Payment received'
  WHEN 'receipt_accepted' THEN 'Payment received and work authorized'
  WHEN 'receipt_top_up_requested' THEN 'Additional stage payment requested'
  WHEN 'receipt_flagged' THEN 'Payment receipt needs attention'
  WHEN 'prices_proposed' THEN 'Project prices ready for approval'
  WHEN 'prices_approved' THEN 'Project price changes approved'
  WHEN 'prices_declined' THEN 'Project prices retained'
  WHEN 'prices_withdrawn' THEN 'Price proposal withdrawn'
  WHEN 'payment_plan_proposed' THEN 'Stage payment plan ready for review'
  WHEN 'payment_plan_accepted' THEN 'Stage payment plan accepted'
  WHEN 'payment_plan_declined' THEN 'Stage payment plan needs revision'
  WHEN 'payment_plan_superseded' THEN 'Stage payment plan replaced'
  WHEN 'breakdown_proposed' THEN 'Stage price breakdown ready for approval'
  WHEN 'breakdown_approved' THEN 'Stage price breakdown approved'
  WHEN 'breakdown_declined' THEN 'Stage price breakdown not approved'
  WHEN 'breakdown_withdrawn' THEN 'Stage price breakdown withdrawn'
  WHEN 'progression_authorized' THEN 'Project progression authorized; balance remains recorded'
  WHEN 'member_invited' THEN 'Project invitation created'
  WHEN 'project_link_created' THEN 'Project invitation link created'
  WHEN 'member_joined' THEN 'Project member joined'
  WHEN 'member_removed' THEN 'Project membership updated'
  WHEN 'member_role_changed' THEN 'Project role updated'
  WHEN 'document_added' THEN 'Project document added'
  WHEN 'document_updated' THEN 'Project document updated'
  WHEN 'document_removed' THEN 'Project document removed'
  WHEN 'verification_requested' THEN 'Stage verification requested'
  WHEN 'verification_decided' THEN 'Stage verification reviewed'
  WHEN 'verifier_assigned' THEN 'Project verifier assigned'
  WHEN 'verifier_removed' THEN 'Project verifier assignment updated'
  WHEN 'project_budget_updated' THEN 'Project budget updated'
  WHEN 'project_tracking_started' THEN 'Project tracking started'
  ELSE NULL END;
 IF title IS NULL THEN RETURN; END IF;
 IF payload->>'stage_id' IS NOT NULL THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.id=(payload->>'stage_id')::uuid;
 ELSIF payload->>'stage_number' ~ '^\d{1,3}$' THEN
  SELECT s.id,s.stage_number INTO stage_id,stage_no FROM public.project_stages s WHERE s.project_id=p_project AND s.stage_number=(payload->>'stage_number')::integer;
 END IF;
 body:=CASE WHEN stage_no IS NULL THEN 'Open “'||coalesce(project_name,'Project')||'” to view this update.'
  ELSE 'Open Stage '||stage_no||' in “'||coalesce(project_name,'Project')||'” to view this update.' END;
 FOR person IN SELECT * FROM public.project_notification_members(p_project) LOOP
  CONTINUE WHEN NOT p_include_actor AND person.user_id IS NOT DISTINCT FROM p_actor;
  tab:=CASE WHEN p_event LIKE 'prices_%' OR p_event='project_budget_updated' THEN CASE WHEN person.role='contractor' THEN 'money' ELSE 'costing' END
   WHEN p_event LIKE 'document_%' THEN 'documents'
   WHEN p_event LIKE 'member_%' OR p_event LIKE 'verifier_%' OR p_event='project_link_created' THEN CASE WHEN person.role='contractor' THEN 'people' ELSE 'team' END
   WHEN stage_no IS NOT NULL THEN CASE WHEN person.role='contractor' THEN 'work' ELSE 'stages' END
   ELSE CASE WHEN person.role='contractor' THEN 'work' ELSE 'overview' END END;
  INSERT INTO public.notifications(user_id,type,title,body,data,title_key,body_key,params,event_key)
  VALUES(person.user_id,'project.'||p_event,title,body,
   jsonb_strip_nulls(payload||jsonb_build_object('project_id',p_project,'role',person.role,'project_tab',tab,'stage_id',stage_id,'stage_number',stage_no,'project_event',p_event)),
   'notifications.events.'||p_event,CASE WHEN stage_no IS NULL THEN 'notifications.projectEventBody' ELSE 'notifications.stageEventBody' END,
   jsonb_build_object('project',coalesce(project_name,'Project'),'stage',stage_no),'project:'||p_key)
  ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.emit_project_event(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

-- RPC: contractor requests payment for a stage or a specific substage.
CREATE OR REPLACE FUNCTION public.request_stage_payment(
  p_stage     uuid,
  p_substage  uuid     DEFAULT NULL,
  p_amount    numeric  DEFAULT NULL,
  p_currency  text     DEFAULT NULL,
  p_note      text     DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_stage      public.project_stages%ROWTYPE;
  v_currency   text := upper(btrim(coalesce(p_currency, '')));
  v_id         uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: stage does not exist'; END IF;

  IF NOT public.is_primary_project_contractor(v_stage.project_id) THEN
    RAISE EXCEPTION 'not_contractor: only the project contractor may request payment';
  END IF;

  IF coalesce(v_stage.pre_existing, false) THEN
    RAISE EXCEPTION 'nothing_expected: pre-existing stages have no payment expectation';
  END IF;

  IF p_substage IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.project_substages WHERE id = p_substage AND stage_id = p_stage) THEN
      RAISE EXCEPTION 'not_found: substage does not belong to this stage';
    END IF;
  END IF;

  IF p_amount IS NOT NULL THEN
    IF p_amount <= 0 OR p_amount > 1e12 THEN
      RAISE EXCEPTION 'invalid_amount: enter a positive amount';
    END IF;
    IF v_currency = '' OR v_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'invalid_currency: use a 3-letter ISO currency code';
    END IF;
  END IF;

  INSERT INTO public.substage_payment_requests
    (project_id, stage_id, substage_id, amount, currency, note, requested_by)
  VALUES
    (v_stage.project_id, p_stage, p_substage, p_amount,
     CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END,
     NULLIF(btrim(coalesce(p_note, '')), ''), v_actor)
  RETURNING id INTO v_id;

  PERFORM public.log_activity(
    v_stage.project_id,
    'stage.payment_requested',
    'project_stage',
    p_stage,
    v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'request_id',  v_id,
      'stage_id',    p_stage,
      'substage_id', p_substage,
      'amount',      p_amount,
      'currency',    CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END
    ))
  );

  PERFORM public.emit_project_event(
    v_stage.project_id,
    v_actor,
    'payment_requested',
    'substage_payment_requests:' || v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_id',    p_stage,
      'substage_id', p_substage,
      'request_id',  v_id,
      'amount',      p_amount,
      'currency',    CASE WHEN p_amount IS NOT NULL THEN v_currency ELSE NULL END
    ))
  );

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'stage_id', p_stage, 'substage_id', p_substage);
END;
$$;
REVOKE ALL ON FUNCTION public.request_stage_payment(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_stage_payment(uuid, uuid, numeric, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
