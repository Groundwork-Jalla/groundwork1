-- A client needs an accepted primary contractor before arranging or recording payments.
-- No existing budgets, stage statuses, receipt history or expected tranches are changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.project_has_primary_contractor(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project
  AND status='accepted' AND is_primary AND contractor_user_id IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.project_has_primary_contractor(uuid) FROM PUBLIC,anon,authenticated;

-- These three inserts cover receipt-reader reservations, all receipt RPCs (including
-- legacy/replacement paths), and payment-plan proposals. Expected budget rows stay valid.
CREATE OR REPLACE FUNCTION public.require_project_payment_contractor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.lock_project_stage_progression(NEW.project_id);
 IF NOT public.project_has_primary_contractor(NEW.project_id) THEN
  RAISE EXCEPTION 'project_contractor_required: a primary contractor must join this project before payments';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_project_payment_contractor() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS receipt_contractor_required ON public.stage_payment_receipts;
CREATE TRIGGER receipt_contractor_required BEFORE INSERT ON public.stage_payment_receipts
 FOR EACH ROW EXECUTE FUNCTION public.require_project_payment_contractor();
DROP TRIGGER IF EXISTS reading_contractor_required ON public.receipt_readings;
CREATE TRIGGER reading_contractor_required BEFORE INSERT ON public.receipt_readings
 FOR EACH ROW EXECUTE FUNCTION public.require_project_payment_contractor();
DROP TRIGGER IF EXISTS plan_contractor_required ON public.stage_payment_plans;
CREATE TRIGGER plan_contractor_required BEFORE INSERT ON public.stage_payment_plans
 FOR EACH ROW EXECUTE FUNCTION public.require_project_payment_contractor();

-- Give the connection error before rate limiting and before reading any private file.
CREATE OR REPLACE FUNCTION public.reserve_receipt_read(p_stage uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_project uuid; v_id uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt-read:'||p_actor::text,0));
 SELECT project_id INTO v_project FROM public.project_stages WHERE id=p_stage;
 IF NOT FOUND OR p_actor IS NULL THEN RAISE EXCEPTION 'invalid_receipt_target'; END IF;
 PERFORM public.lock_project_stage_progression(v_project);
 IF NOT public.project_has_primary_contractor(v_project) THEN RAISE EXCEPTION 'project_contractor_required'; END IF;
 IF (SELECT count(*) FROM public.receipt_readings WHERE submitted_by=p_actor AND created_at>clock_timestamp()-interval '15 minutes')>=10 THEN
  RAISE EXCEPTION 'receipt_read_rate_limit';
 END IF;
 INSERT INTO public.receipt_readings(stage_id,project_id,submitted_by) VALUES(p_stage,v_project,p_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_receipt_read(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_read(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.stage_payment_plan_context(p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t jsonb;s public.project_stages%ROWTYPE;plan public.stage_payment_plans%ROWTYPE;editable boolean;BEGIN
 SELECT * INTO s FROM public.project_stages WHERE id=p_stage;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_admin() OR public.project_member(s.project_id)) THEN RAISE EXCEPTION 'project_access_required'; END IF;
 t:=public.stage_payment_totals(p_stage);
 SELECT * INTO plan FROM public.stage_payment_plans WHERE stage_id=p_stage AND superseded_at IS NULL;
 editable:=public.project_has_primary_contractor(s.project_id) AND NOT coalesce(s.pre_existing,false) AND s.status<>'complete'
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
COMMIT;
