-- A project advances one stage at a time. Payment acknowledgment records money;
-- it never skips unfinished work. Apply after receipt payment amounts.
BEGIN;

-- All normal progression paths take this lock before stage/payment/substage rows.
-- The advisory lock is also visible to deferred checks on older write paths.
CREATE OR REPLACE FUNCTION public.lock_project_stage_progression(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('project-stage-progression:' || p_project::text, 0));
  PERFORM 1 FROM public.projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such project'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lock_project_stage_progression(uuid) FROM PUBLIC, anon, authenticated;

-- A missing ledger row does not prove a positive-priced stage was paid. Preserve
-- the funding seeder's USD-cent threshold: zero or sub-cent allocations do not
-- create an incoming tranche. Their native BOQ allocations remain unchanged.
CREATE OR REPLACE FUNCTION public.stage_funding_settled(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.stage_id = s.id AND p.direction = 'in')
    THEN NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.stage_id = s.id AND p.direction = 'in'
      AND p.state IN ('expected', 'receipt_submitted'))
    ELSE s.payment_milestone_usd IS NOT NULL AND round(s.payment_milestone_usd, 2) <= 0
  END FROM public.project_stages s WHERE s.id = p_stage;
$$;
REVOKE ALL ON FUNCTION public.stage_funding_settled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_funding_settled(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.open_stage_if_settled(p_stage uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid; v_stage public.project_stages%ROWTYPE;
BEGIN
  SELECT project_id INTO v_project FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.lock_project_stage_progression(v_project);
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage AND project_id = v_project FOR UPDATE;
  IF NOT FOUND OR v_stage.status <> 'locked' OR coalesce(v_stage.pre_existing, false) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project AND status IN ('on_hold', 'completed')) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_project AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_project AND id <> p_stage AND status IN ('active', 'pending_review')) THEN RETURN false; END IF;
  IF NOT coalesce(public.stage_funding_settled(p_stage), false) THEN RETURN false; END IF;
  PERFORM set_config('app.payments_projection', 'on', true);
  UPDATE public.project_stages SET payment_status = 'paid', status = 'active' WHERE id = p_stage;
  PERFORM set_config('app.payments_projection', 'off', true);
  UPDATE public.project_substages SET status = 'pending' WHERE stage_id = p_stage AND status = 'locked';
  UPDATE public.projects SET current_stage = v_stage.stage_number WHERE id = v_project;
  PERFORM public.log_activity(v_project, 'stage.opened', 'project_stage', p_stage, NULL,
    jsonb_build_object('stage_number', v_stage.stage_number, 'reason', 'funding_settled'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.open_stage_if_settled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_stage(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid; v_stage public.project_stages%ROWTYPE; v_project public.projects%ROWTYPE;
  v_admin boolean := public.is_admin(); v_next public.project_stages%ROWTYPE;
  v_final boolean; v_already boolean; v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_project FROM public.projects WHERE id = v_project_id;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage AND project_id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  IF NOT v_admin AND NOT public.is_project_client(v_project_id) THEN
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
      IF NOT coalesce(public.stage_funding_settled(p_stage), false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
      IF EXISTS (SELECT 1 FROM public.project_substages WHERE stage_id = p_stage AND status <> 'complete') THEN RAISE EXCEPTION 'substages_not_ready: not all substages are complete'; END IF;
      IF EXISTS (SELECT 1 FROM public.contractor_invites WHERE project_id = v_project_id AND status = 'accepted')
         AND NOT public.stage_has_evidence(p_stage) THEN RAISE EXCEPTION 'no_evidence: this stage has nothing uploaded to review'; END IF;
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
    UPDATE public.project_stages SET status = 'complete', completed_at = v_now, approved_by = auth.uid(), approved_at = v_now WHERE id = p_stage;
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
      IF NOT coalesce(public.stage_funding_settled(v_next.id), false) THEN
        PERFORM public.log_activity(v_project_id, 'stage.awaiting_payment', 'project_stage', v_next.id, NULL,
          jsonb_build_object('stage_number', v_next.stage_number));
      END IF;
    END IF;
    UPDATE public.projects SET current_stage = CASE WHEN v_final THEN v_stage.stage_number ELSE v_next.stage_number END,
      status = CASE WHEN v_final THEN 'completed' ELSE status END WHERE id = v_project_id;
    PERFORM public.log_activity(v_project_id, 'stage.approved', 'project_stage', p_stage, auth.uid(),
      jsonb_build_object('stage_number', v_stage.stage_number, 'tier', v_project.tier,
        'approved_by_role', CASE WHEN v_admin THEN 'admin' ELSE 'client' END));
  END IF;
  IF v_next.id IS NOT NULL THEN
    SELECT * INTO v_next FROM public.project_stages WHERE id = v_next.id;
  END IF;
  RETURN jsonb_build_object('project_id', v_project_id, 'stage_id', p_stage, 'stage_number', v_stage.stage_number,
    'is_final', v_final, 'next_stage_id', v_next.id, 'next_stage_number', v_next.stage_number,
    'next_stage_status', v_next.status,
    'awaiting_payment', (v_next.id IS NOT NULL AND NOT coalesce(public.stage_funding_settled(v_next.id), false)),
    'verification_id', NULL, 'already_approved', v_already);
END $$;
REVOKE ALL ON FUNCTION public.approve_stage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stage(uuid) TO authenticated;

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
  IF v_stage.status = 'complete' AND v_sub.status = 'complete' THEN
    RETURN jsonb_build_object('substage_id', p_substage, 'stage_approval', public.approve_stage(v_stage_id));
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND status IN ('on_hold','completed')) THEN RAISE EXCEPTION 'project_paused: this project is not open for progression'; END IF;
  IF v_stage.status NOT IN ('active','pending_review') THEN RAISE EXCEPTION 'wrong_state: stage is %', v_stage.status; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
  IF NOT v_admin THEN
    IF NOT coalesce(public.stage_funding_settled(v_stage_id), false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
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
REVOKE ALL ON FUNCTION public.approve_substage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_substage(uuid) TO authenticated;

-- The receipt/cash paths use the same lock order as approval.
CREATE OR REPLACE FUNCTION public.confirm_stage_payment(
  p_stage uuid,p_note text,p_receipt_path text,p_receipt_uploaded_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid;
  v_stage public.project_stages%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_actor uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_opened boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage AND project_id = v_project_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.mark_stage_paid(p_stage uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid;
  v_stage  public.project_stages%ROWTYPE;
  v_actor  uuid := auth.uid();
  v_count  int;
  v_opened boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator records a payment';
  END IF;
  SELECT project_id INTO v_project_id FROM public.project_stages WHERE id = p_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;
  PERFORM public.lock_project_stage_progression(v_project_id);
  SELECT * INTO v_stage FROM public.project_stages WHERE id = p_stage AND project_id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such stage'; END IF;

  -- Every tranche still expected on this stage is now in. `funding_source` says how we
  -- know, and 'staff_confirmed' is the honest answer: somebody was told, and said so.
  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'funded', funding_source = 'staff_confirmed',
         confirmed_by = v_actor, confirmed_at = now(),
         note = COALESCE(NULLIF(btrim(p_note), ''), note)
   WHERE stage_id = p_stage AND direction = 'in' AND state = 'expected';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.payments_projection', 'on', true);
  UPDATE public.project_stages SET payment_status = 'paid' WHERE id = p_stage;
  PERFORM set_config('app.payments_projection', 'off', true);

  PERFORM public.log_activity(v_stage.project_id, 'funding.received', 'project_stage', p_stage, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'stage_number', v_stage.stage_number, 'tranches', v_count,
      'funding_source', 'staff_confirmed', 'by', 'admin',
      'note', NULLIF(btrim(p_note), ''))));

  v_opened := public.open_stage_if_settled(p_stage);
  RETURN jsonb_build_object('stage_id', p_stage, 'tranches_confirmed', v_count, 'opened', v_opened);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_funding(p_payment uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay   public.payments%ROWTYPE;
  v_stage public.project_stages%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin: only an administrator confirms funding'; END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such payment'; END IF;
  PERFORM public.lock_project_stage_progression(v_pay.project_id);
  IF v_pay.stage_id IS NOT NULL THEN
    SELECT * INTO v_stage FROM public.project_stages WHERE id = v_pay.stage_id FOR UPDATE;
  END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such payment'; END IF;
  IF v_pay.direction <> 'in' THEN RAISE EXCEPTION 'wrong_direction: only incoming funding is confirmed'; END IF;
  IF v_pay.state <> 'expected' THEN RAISE EXCEPTION 'wrong_state: payment is %', v_pay.state; END IF;

  PERFORM set_config('app.payments_write', 'on', true);
  UPDATE public.payments
     SET state = 'funded', funding_source = 'staff_confirmed',
         confirmed_by = v_actor, confirmed_at = now(), note = NULLIF(btrim(p_note), '')
   WHERE id = p_payment;

  SELECT * INTO v_stage FROM public.project_stages WHERE id = v_pay.stage_id;
  PERFORM public.log_activity(v_pay.project_id, 'funding.received', 'payment', p_payment, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'amount', v_pay.amount, 'currency', v_pay.currency, 'funding_source', 'staff_confirmed', 'by', 'admin',
      'stage_id', v_pay.stage_id, 'stage_number', v_stage.stage_number, 'note', NULLIF(btrim(p_note), ''))));

  -- 132: confirming the last tranche a stage was waiting on opens it. Before this the
  -- money was recorded and the work stayed shut until somebody noticed.
  PERFORM public.open_stage_if_settled(v_pay.stage_id);
END $$;

-- Catch activation through older RPCs or direct status writes. Deferred checks
-- allow an atomic mid-build initialization to complete historical rows first.
-- Try, rather than wait, on older writers already holding a stage row: they may
-- retry a busy project without creating a stage/project lock inversion.
CREATE OR REPLACE FUNCTION public.check_stage_progression_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage public.project_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.stage_number IS NOT DISTINCT FROM OLD.stage_number
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NULL; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'complete' AND v_stage.status <> 'complete' THEN
    RAISE EXCEPTION 'stage_complete: a completed stage cannot reopen';
  END IF;
  IF v_stage.status NOT IN ('active','pending_review') THEN RETURN NULL; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('project-stage-progression:' || v_stage.project_id::text, 0)) THEN
    RAISE EXCEPTION 'stage_busy: this project is changing; retry the update';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_stage.project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN
    RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_stage.project_id AND id <> v_stage.id AND status IN ('active','pending_review')) THEN
    RAISE EXCEPTION 'stage_already_active: only one stage may be active';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS stage_progression_order ON public.project_stages;
CREATE CONSTRAINT TRIGGER stage_progression_order
  AFTER INSERT OR UPDATE OF status, stage_number, project_id ON public.project_stages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_stage_progression_order();

CREATE OR REPLACE FUNCTION public.guard_substage_progression()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage public.project_stages%ROWTYPE; v_work boolean;
BEGIN
  -- These are the existing atomic approval/join writers. A completion from a
  -- browser, including an older app version, must use the atomic substage RPC.
  IF current_setting('app.approve_substage',true) = 'on'
     OR current_setting('app.approve_stage',true) = 'on'
     OR current_setting('app.join_in_progress',true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete')
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'approve_substage_via_rpc: approve updates through approve_substage()'; END IF;
  END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;
  v_work := NEW.evidence_urls IS DISTINCT FROM OLD.evidence_urls
    OR (NEW.status IN ('in_progress','pending_review') AND NEW.status IS DISTINCT FROM OLD.status);
  IF NOT v_work THEN RETURN NEW; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = NEW.stage_id;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('project-stage-progression:' || v_stage.project_id::text,0)) THEN RAISE EXCEPTION 'stage_busy: this project is changing; retry the update'; END IF;
  IF coalesce(v_stage.pre_existing,false) OR v_stage.status NOT IN ('active','pending_review') THEN RAISE EXCEPTION 'wrong_state: work can only be reported on the current stage'; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_stage.project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_stage.project_id AND status IN ('on_hold','completed')) THEN RAISE EXCEPTION 'project_paused: this project is not open for work'; END IF;
  IF NOT coalesce(public.stage_funding_settled(v_stage.id),false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS substage_progression_guard ON public.project_substages;
CREATE TRIGGER substage_progression_guard BEFORE UPDATE OF status, evidence_urls, approved_by, approved_at ON public.project_substages
  FOR EACH ROW EXECUTE FUNCTION public.guard_substage_progression();

-- Description-only site updates have no substage evidence index to trigger the
-- guard above, so their record uses the same current-stage/funding requirements.
CREATE OR REPLACE FUNCTION public.guard_site_update_progression()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage public.project_stages%ROWTYPE;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT * INTO v_stage FROM public.project_stages WHERE id = NEW.stage_id;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('project-stage-progression:' || v_stage.project_id::text,0)) THEN RAISE EXCEPTION 'stage_busy: this project is changing; retry the update'; END IF;
  IF coalesce(v_stage.pre_existing,false) OR v_stage.status NOT IN ('active','pending_review') THEN RAISE EXCEPTION 'wrong_state: work can only be reported on the current stage'; END IF;
  IF EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_stage.project_id AND stage_number < v_stage.stage_number AND status <> 'complete') THEN RAISE EXCEPTION 'stage_out_of_order: finish earlier stages first'; END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_stage.project_id AND status IN ('on_hold','completed')) THEN RAISE EXCEPTION 'project_paused: this project is not open for work'; END IF;
  IF NOT coalesce(public.stage_funding_settled(v_stage.id),false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_update_progression_guard ON public.site_updates;
CREATE TRIGGER site_update_progression_guard BEFORE INSERT ON public.site_updates
  FOR EACH ROW EXECUTE FUNCTION public.guard_site_update_progression();

-- Approval, evidence and receipt changes reach both participants without a
-- manual reload. Existing RLS policies still determine which rows they can read.
DO $realtime$
DECLARE v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables) THEN
    FOREACH v_table IN ARRAY ARRAY['projects','project_stages','project_substages'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
      END IF;
    END LOOP;
  END IF;
END $realtime$;

COMMIT;
