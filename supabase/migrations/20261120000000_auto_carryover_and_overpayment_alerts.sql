-- 20261120000000: Automatic carried-over overpayment allocation across substages
-- and Admin notifications when a client uploads/confirms an overpayment receipt.
--
-- 1. `substage_payment_state`: automatically includes `carried_in` in `v_pool`
--    so carried-over overpayment from earlier stages automatically covers the
--    first substages in order until exhausted (no manual credit-confirmation click).
-- 2. `stage_work_ready`: allows work to start automatically when `carried_in > 0`
--    (or `stage_funding_settled` / `substage_payment_state` work_ready).
-- 3. `notify_admin_on_overpayment`: alerts all admin users in `public.notifications`
--    whenever a live receipt causes total (confirmed + pending) receipts on a stage
--    to exceed the stage's scheduled amount.
BEGIN;

CREATE OR REPLACE FUNCTION public.substage_payment_state(p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t jsonb;
  code text;
  rate numeric;
  v_pool numeric;
  v_cum numeric := 0;
  v_prior_done boolean := true;
  sub record;
  v_out jsonb := '[]';
  v_cover numeric;
  v_pending numeric;
  v_allows boolean;
BEGIN
  IF NOT public.stage_breakdown_split(p_stage) THEN RETURN NULL; END IF;
  t := public.stage_payment_totals(p_stage);
  code := t->>'currency';
  rate := (t->>'fx_rate')::numeric;

  SELECT coalesce(sum(
    CASE
      WHEN r.project_currency = code THEN r.project_amount
      WHEN r.currency = code THEN r.amount
      ELSE round(r.amount_usd * rate, 6)
    END
  ), 0)
  INTO v_pool
  FROM public.stage_payment_receipts r
  WHERE r.stage_id = p_stage
    AND r.replaced_by IS NULL
    AND r.decision = 'received'
    AND NOT coalesce(r.legacy_unknown, false);

  -- Money carried over from an earlier overpaid stage automatically covers
  -- this stage's substages in order until exhausted (19 Nov decision).
  v_pool := v_pool + coalesce((t->>'carried_in')::numeric, 0);

  FOR sub IN
    SELECT id, substage_number, status, price_amount
    FROM public.project_substages
    WHERE stage_id = p_stage
    ORDER BY substage_number, id
  LOOP
    v_cover := least(greatest(v_pool - v_cum, 0), sub.price_amount);
    v_cum := v_cum + sub.price_amount;
    SELECT
      coalesce(sum(
        CASE
          WHEN r.project_currency = code THEN r.project_amount
          WHEN r.currency = code THEN r.amount
          ELSE round(r.amount_usd * rate, 6)
        END
      ) FILTER (WHERE r.decision = 'pending'), 0),
      coalesce(bool_or(r.allows_work AND r.decision = 'received'), false)
    INTO v_pending, v_allows
    FROM public.stage_payment_receipts r
    WHERE r.substage_id = sub.id
      AND r.replaced_by IS NULL;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', sub.id,
      'number', sub.substage_number,
      'status', sub.status,
      'price', sub.price_amount::text,
      'covered', v_cover::text,
      'remaining', (sub.price_amount - v_cover)::text,
      'pending', v_pending::text,
      'paid', v_cover >= sub.price_amount OR v_allows,
      'payable', v_prior_done AND sub.status <> 'complete' AND v_cover < sub.price_amount,
      'work_ready', v_prior_done AND (v_cover >= sub.price_amount OR v_allows)
    ));
    v_prior_done := v_prior_done AND sub.status = 'complete';
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.substage_payment_state(uuid) FROM PUBLIC, anon, authenticated;

-- Extend stage_work_ready so carried-over funds automatically unlock work on the stage
-- while preserving zero-cost, contractor-verified, and split-stage readiness.
CREATE OR REPLACE FUNCTION public.stage_work_ready(p_stage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (coalesce(s.payment_milestone_usd, 0) = 0 AND coalesce(s.milestone_amount, 0) = 0)
    OR EXISTS (
      SELECT 1 FROM public.contractor_stage_verifications csv
      WHERE csv.stage_id = s.id
    )
    OR coalesce((public.stage_payment_totals(s.id)->>'carried_in')::numeric, 0) > 0
    OR (coalesce(public.stage_funding_settled(s.id), false)
      AND NOT EXISTS (
        SELECT 1 FROM public.stage_payment_plans
        WHERE stage_id = s.id AND status <> 'accepted' AND superseded_at IS NULL
      ))
    OR (coalesce(public.stage_starts_with_evidence(s.id), false)
      AND NOT s.review_payment_pending
      AND s.status <> 'complete')
    OR (s.status <> 'complete'
      AND public.stage_breakdown_split(s.id)
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(public.substage_payment_state(s.id)) e
        WHERE (e->>'work_ready')::boolean AND e->>'status' <> 'complete'
      ))
  FROM public.project_stages s
  WHERE s.id = p_stage;
$$;
REVOKE ALL ON FUNCTION public.stage_work_ready(uuid) FROM PUBLIC, anon, authenticated;

-- Notify all admins whenever a live payment receipt causes a stage's total
-- (confirmed + pending) receipts to exceed its scheduled amount.
CREATE OR REPLACE FUNCTION public.notify_admin_on_overpayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_totals jsonb;
  v_due numeric;
  v_code text;
  v_rate numeric;
  v_total_filed numeric;
  v_excess numeric;
  v_project_name text;
  v_stage_no integer;
  v_admin record;
BEGIN
  IF NEW.replaced_by IS NOT NULL OR NEW.decision NOT IN ('pending', 'received') THEN
    RETURN NEW;
  END IF;

  v_totals := public.stage_payment_own_totals(NEW.stage_id);
  v_due := coalesce((v_totals->>'stage_amount')::numeric, 0);
  IF v_due <= 0 THEN
    RETURN NEW;
  END IF;

  v_code := coalesce(v_totals->>'currency', 'USD');
  v_rate := coalesce(nullif((v_totals->>'fx_rate')::numeric, 0), 1);

  SELECT coalesce(sum(
    CASE
      WHEN r.project_currency = v_code AND r.project_amount IS NOT NULL THEN r.project_amount
      WHEN r.currency = v_code AND r.amount IS NOT NULL THEN r.amount
      WHEN r.amount_usd IS NOT NULL THEN round(r.amount_usd * v_rate, 6)
      ELSE 0
    END
  ), 0)
  INTO v_total_filed
  FROM public.stage_payment_receipts r
  WHERE r.stage_id = NEW.stage_id
    AND r.replaced_by IS NULL
    AND r.decision IN ('pending', 'received');

  v_excess := v_total_filed - v_due;
  IF v_excess <= 0.01 THEN
    RETURN NEW;
  END IF;

  SELECT p.name, s.stage_number
  INTO v_project_name, v_stage_no
  FROM public.project_stages s
  JOIN public.projects p ON p.id = s.project_id
  WHERE s.id = NEW.stage_id;

  FOR v_admin IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'admin' AND ur.user_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications(
      user_id, type, title, body, data, title_key, body_key, params, event_key
    )
    VALUES (
      v_admin.user_id,
      'admin.overpayment_detected',
      'Overpayment recorded on stage',
      'Stage ' || coalesce(v_stage_no::text, '?') || ' in "' || coalesce(v_project_name, 'Project')
        || '" has an overpayment of ' || round(v_excess, 2)::text || ' ' || v_code || '.',
      jsonb_build_object(
        'project_id', NEW.project_id,
        'stage_id', NEW.stage_id,
        'stage_number', v_stage_no,
        'receipt_id', NEW.id,
        'excess_amount', round(v_excess, 2),
        'currency', v_code,
        'project_tab', 'financials'
      ),
      'notifications.events.overpayment_detected',
      'notifications.stageEventBody',
      jsonb_build_object('project', coalesce(v_project_name, 'Project'), 'stage', v_stage_no),
      'admin:overpayment:' || NEW.id::text
    )
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stage_receipt_admin_overpayment_notify ON public.stage_payment_receipts;
CREATE TRIGGER stage_receipt_admin_overpayment_notify
  AFTER INSERT OR UPDATE OF decision, amount, project_amount, replaced_by
  ON public.stage_payment_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_overpayment();

COMMIT;
