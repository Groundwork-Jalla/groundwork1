-- Follow-up review: creator-specific first action and explicit partial-receipt decisions.
BEGIN;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS workflow_origin text NOT NULL DEFAULT 'client'
  CHECK(workflow_origin IN('client','contractor'));
-- Self-assignment at creation establishes a contractor-led build without changing membership.
UPDATE public.projects p SET workflow_origin='contractor' WHERE EXISTS (
 SELECT 1 FROM public.contractor_invites ci WHERE ci.project_id=p.id
 AND ci.contractor_user_id=p.user_id AND ci.invited_by=p.user_id);
CREATE OR REPLACE FUNCTION public.guard_project_workflow_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.workflow_origin IS DISTINCT FROM OLD.workflow_origin THEN RAISE EXCEPTION 'workflow_origin_fixed: project origin is recorded at creation'; END IF;
 ELSE
   NEW.workflow_origin:=CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.user_id AND role='contractor') THEN 'contractor' ELSE 'client' END;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_workflow_origin ON public.projects;
CREATE TRIGGER project_workflow_origin BEFORE INSERT OR UPDATE OF workflow_origin ON public.projects
 FOR EACH ROW EXECUTE FUNCTION public.guard_project_workflow_origin();
CREATE OR REPLACE FUNCTION public.stage_starts_with_evidence(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.workflow_origin='contractor' AND NOT coalesce(s.pre_existing,false)
 AND s.stage_number=(SELECT min(first.stage_number) FROM public.project_stages first WHERE first.project_id=p.id AND NOT coalesce(first.pre_existing,false))
 FROM public.project_stages s JOIN public.projects p ON p.id=s.project_id WHERE s.id=p_stage;
$$;
CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(public.stage_funding_settled(p_stage),false) OR coalesce(public.stage_starts_with_evidence(p_stage),false);
$$;
REVOKE ALL ON FUNCTION public.stage_starts_with_evidence(uuid),public.stage_work_ready(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stage_starts_with_evidence(uuid),public.stage_work_ready(uuid) TO authenticated;


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
  IF NOT coalesce(public.stage_work_ready(p_stage), false) THEN RETURN false; END IF;
  PERFORM set_config('app.payments_projection', 'on', true);
  UPDATE public.project_stages SET payment_status = CASE WHEN public.stage_funding_settled(p_stage) THEN 'paid' ELSE 'unpaid' END, status = 'active' WHERE id = p_stage;
  PERFORM set_config('app.payments_projection', 'off', true);
  UPDATE public.project_substages SET status = 'pending' WHERE stage_id = p_stage AND status = 'locked';
  UPDATE public.projects SET current_stage = v_stage.stage_number WHERE id = v_project;
  PERFORM public.log_activity(v_project, 'stage.opened', 'project_stage', p_stage, NULL,
    jsonb_build_object('stage_number', v_stage.stage_number, 'reason', CASE WHEN public.stage_funding_settled(p_stage) THEN 'funding_settled' ELSE 'initial_evidence' END));
  RETURN true;
END $$;

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
      IF NOT coalesce(public.stage_work_ready(p_stage), false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
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
      IF NOT coalesce(public.stage_work_ready(v_next.id), false) THEN
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
  IF v_stage.status = 'complete' AND v_sub.status = 'complete' THEN
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
  IF NOT coalesce(public.stage_work_ready(v_stage.id),false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
  RETURN NEW;
END $$;

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
  IF NOT coalesce(public.stage_work_ready(v_stage.id),false) THEN RAISE EXCEPTION 'not_paid: this stage has not been paid for'; END IF;
  RETURN NEW;
END $$;


CREATE TABLE IF NOT EXISTS public.stage_payment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 stage_id uuid NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
 path text NOT NULL, submitted_by uuid, submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 amount numeric(24,6), currency text, fx_rate numeric(24,12), amount_usd numeric(24,9),
 legacy_unknown boolean NOT NULL DEFAULT false,
 decision text NOT NULL DEFAULT 'pending' CHECK(decision IN('pending','received','flagged')),
 allows_work boolean NOT NULL DEFAULT false CHECK(NOT allows_work OR decision='received'),
 requested_top_up numeric(24,6) CHECK(requested_top_up>0 AND requested_top_up<=1e12),
 decision_note text CHECK(length(decision_note)<=2000), decided_by uuid, decided_at timestamptz,
 UNIQUE(project_id,path),
 CHECK(path LIKE project_id::text||'/receipts/%'),
 CHECK((legacy_unknown AND amount IS NULL AND currency IS NULL AND fx_rate IS NULL AND amount_usd IS NULL)
 OR (amount IS NOT NULL AND amount>0 AND amount<=1e12 AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$'
 AND fx_rate IS NOT NULL AND fx_rate>0 AND fx_rate<=1e12 AND amount_usd IS NOT NULL AND amount_usd>0 AND amount_usd<=1e12
 AND (currency<>'USD' OR fx_rate=1) AND amount_usd=round(amount/fx_rate,9)))
);
ALTER TABLE public.stage_payment_receipts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.stage_payment_receipts TO authenticated;
CREATE POLICY receipt_members_read ON public.stage_payment_receipts FOR SELECT TO authenticated
 USING(public.is_admin() OR public.project_member(project_id));
CREATE INDEX stage_receipts_project ON public.stage_payment_receipts(project_id,stage_id,submitted_at);
-- Preserve existing proof and actual amounts. Unknown legacy amounts stay unknown.
INSERT INTO public.stage_payment_receipts(payment_id,project_id,stage_id,path,submitted_by,submitted_at,
 amount,currency,fx_rate,amount_usd,legacy_unknown,decision,allows_work,decided_by,decided_at,decision_note)
SELECT id,project_id,stage_id,receipt_path,receipt_uploaded_by,coalesce(receipt_uploaded_at,created_at),
 receipt_amount,receipt_currency,receipt_fx_rate,receipt_amount_usd,receipt_amount IS NULL,
 CASE WHEN state IN('funded','reconciled') THEN 'received' WHEN receipt_amount IS NULL THEN 'flagged' ELSE 'pending' END,
 state IN('funded','reconciled'),confirmed_by,confirmed_at,
 CASE WHEN receipt_amount IS NULL AND state='receipt_submitted' THEN 'Upload a clear receipt with its actual amount.' ELSE NULL END
FROM public.payments WHERE direction='in' AND stage_id IS NOT NULL AND receipt_path IS NOT NULL
ON CONFLICT(project_id,path) DO NOTHING;
CREATE UNIQUE INDEX stage_receipts_one_pending ON public.stage_payment_receipts(stage_id) WHERE decision='pending';
CREATE OR REPLACE FUNCTION public.guard_stage_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF current_setting('app.stage_receipt_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'receipt_via_rpc: use the receipt workflow'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'receipt_immutable: a receipt is retained in the project record'; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.payment_id,NEW.project_id,NEW.stage_id,NEW.path,NEW.submitted_by,NEW.submitted_at,NEW.amount,NEW.currency,NEW.fx_rate,NEW.amount_usd,NEW.legacy_unknown)
 IS DISTINCT FROM ROW(OLD.payment_id,OLD.project_id,OLD.stage_id,OLD.path,OLD.submitted_by,OLD.submitted_at,OLD.amount,OLD.currency,OLD.fx_rate,OLD.amount_usd,OLD.legacy_unknown)
 THEN RAISE EXCEPTION 'receipt_immutable: submitted receipt details stay fixed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stage_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stage_payment_receipts
 FOR EACH ROW EXECUTE FUNCTION public.guard_stage_payment_receipt();


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
    OR public.stage_starts_with_evidence(p_stage)
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


CREATE OR REPLACE FUNCTION public.decide_stage_payment_receipt(p_receipt uuid,p_decision text,p_note text DEFAULT NULL,p_top_up numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.stage_payment_receipts%ROWTYPE; v_project uuid; v_payment public.payments%ROWTYPE; v_actor uuid:=auth.uid(); v_opened boolean:=false;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.stage_payment_receipts WHERE id=p_receipt;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found: no such receipt'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO r FROM public.stage_payment_receipts WHERE id=p_receipt FOR UPDATE;
 IF NOT public.is_admin() AND NOT public.is_contractor_on(v_project,v_actor) THEN RAISE EXCEPTION 'not_contractor: the contractor reviews the receipt'; END IF;
 IF p_decision NOT IN('accept','needs_top_up','flag') OR p_decision IS NULL THEN RAISE EXCEPTION 'invalid_decision'; END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_note'; END IF;
 IF p_decision='needs_top_up' AND (p_top_up IS NULL OR p_top_up<=0 OR p_top_up>1e12 OR p_top_up<>round(p_top_up,6)) THEN RAISE EXCEPTION 'invalid_top_up: enter the requested amount'; END IF;
 IF p_decision='flag' AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'reason_required: describe what needs checking'; END IF;
 IF r.allows_work THEN
  IF p_decision='accept' THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
  RAISE EXCEPTION 'receipt_accepted: this receipt has already been accepted';
 END IF;
 IF r.decision='flagged' THEN
  IF p_decision='flag' THEN RETURN jsonb_build_object('already_decided',true,'opened',false); END IF;
  RAISE EXCEPTION 'receipt_flagged: review the replacement receipt';
 END IF;
 IF r.legacy_unknown THEN RAISE EXCEPTION 'amount_required: upload the receipt with its actual amount'; END IF;
 IF r.decision='received' AND p_decision='accept' AND EXISTS(SELECT 1 FROM public.stage_payment_receipts WHERE stage_id=r.stage_id AND decision='pending') THEN
   RAISE EXCEPTION 'receipt_pending_review: review the newest submitted receipt first';
 END IF;
 IF r.decision='received' AND p_decision='flag' THEN RAISE EXCEPTION 'receipt_received: a confirmed payment stays recorded'; END IF;
 IF r.decision='received' AND p_decision='needs_top_up' THEN
   IF r.requested_top_up IS NOT DISTINCT FROM p_top_up AND r.decision_note IS NOT DISTINCT FROM nullif(btrim(p_note),'') THEN
     RETURN jsonb_build_object('already_decided',true,'opened',false);
   END IF;
   RAISE EXCEPTION 'receipt_decided: the top-up request has already been recorded';
 END IF;
 PERFORM set_config('app.stage_receipt_write','on',true);
 UPDATE public.stage_payment_receipts SET decision=CASE WHEN p_decision='flag' THEN 'flagged' ELSE 'received' END,
  allows_work=p_decision='accept',requested_top_up=CASE WHEN p_decision='needs_top_up' THEN p_top_up ELSE NULL END,
  decision_note=nullif(btrim(p_note),''),decided_by=v_actor,decided_at=clock_timestamp() WHERE id=p_receipt;
 PERFORM set_config('app.stage_receipt_write','off',true);
 IF p_decision='accept' THEN
  SELECT * INTO v_payment FROM public.payments WHERE id=r.payment_id FOR UPDATE;
  IF v_payment.state NOT IN('funded','reconciled') THEN
    PERFORM set_config('app.payments_write','on',true);
    UPDATE public.payments SET state='funded',funding_source=CASE WHEN public.is_admin() THEN 'staff_confirmed' ELSE 'contractor_confirmed' END,
      confirmed_by=v_actor,confirmed_at=clock_timestamp() WHERE id=r.payment_id;
    PERFORM set_config('app.payments_write','off',true);
  END IF;
  v_opened:=public.open_stage_if_settled(r.stage_id);
 END IF;
 PERFORM public.log_activity(v_project,CASE p_decision WHEN 'accept' THEN 'funding.receipt_accepted' WHEN 'needs_top_up' THEN 'funding.receipt_top_up_requested' ELSE 'funding.receipt_flagged' END,'stage_payment_receipt',p_receipt,v_actor,
  jsonb_strip_nulls(jsonb_build_object('stage_id',r.stage_id,'amount',r.amount,'currency',r.currency,'requested_top_up',p_top_up,'note',nullif(btrim(p_note),''))));
 RETURN jsonb_build_object('receipt_id',p_receipt,'stage_id',r.stage_id,'opened',v_opened,'allows_work',p_decision='accept');
END $$;
REVOKE ALL ON FUNCTION public.decide_stage_payment_receipt(uuid,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stage_payment_receipt(uuid,text,text,numeric) TO authenticated;
-- Preserve the cash-only staff path; browser receipt confirmation uses the immutable receipt record.
ALTER FUNCTION public.confirm_stage_payment(uuid,text,text,timestamptz) RENAME TO confirm_stage_payment_legacy;
REVOKE ALL ON FUNCTION public.confirm_stage_payment_legacy(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.confirm_stage_payment(p_stage uuid,p_note text,p_receipt_path text,p_receipt_uploaded_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.payments%ROWTYPE; r public.stage_payment_receipts%ROWTYPE; result jsonb; v_project uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 SELECT * INTO p FROM public.payments WHERE stage_id=p_stage AND direction='in' FOR UPDATE;
 IF NOT public.is_admin() AND NOT public.is_contractor_on(v_project,auth.uid()) THEN RAISE EXCEPTION 'not_contractor'; END IF;
 IF p.state IN('funded','reconciled') OR (p.state='expected' AND public.is_admin()) THEN
   RETURN public.confirm_stage_payment_legacy(p_stage,p_note,p_receipt_path,p_receipt_uploaded_at);
 END IF;
 IF p.receipt_path IS DISTINCT FROM p_receipt_path OR p.receipt_uploaded_at IS DISTINCT FROM p_receipt_uploaded_at THEN RAISE EXCEPTION 'stale_receipt'; END IF;
 SELECT * INTO r FROM public.stage_payment_receipts WHERE stage_id=p_stage AND path=p_receipt_path;
 IF NOT FOUND THEN RAISE EXCEPTION 'no_receipt'; END IF;
 result:=public.decide_stage_payment_receipt(r.id,'accept',p_note,NULL);
 RETURN result||jsonb_build_object('tranches_confirmed',1);
END $$;
REVOKE ALL ON FUNCTION public.confirm_stage_payment(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_stage_payment(uuid,text,text,timestamptz) TO authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='stage_payment_receipts') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_payment_receipts;
 END IF;
END $$;
-- Open only a contractor-led first live stage; historical allocations and payment facts stay intact.
DO $$ DECLARE s record; BEGIN
 FOR s IN SELECT id FROM public.project_stages WHERE status='locked' AND public.stage_starts_with_evidence(id) LOOP PERFORM public.open_stage_if_settled(s.id); END LOOP;
END $$;
COMMIT;
