-- Preserve the document's amount and allocate it once for every project participant.
BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_source text,
  ADD COLUMN IF NOT EXISTS budget_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS budget_currency text,
  ADD COLUMN IF NOT EXISTS budget_fx_rate numeric(24,12),
  ADD COLUMN IF NOT EXISTS budget_precision smallint,
  ADD COLUMN IF NOT EXISTS budget_source_label text,
  ADD COLUMN IF NOT EXISTS budget_source_file text;
ALTER TABLE public.projects ADD CONSTRAINT projects_budget_source_check
  CHECK (budget_source IS NULL OR budget_source IN ('boq','estimate'));
ALTER TABLE public.projects ADD CONSTRAINT projects_boq_budget_check CHECK (
  budget_source IS DISTINCT FROM 'boq' OR (
    budget_amount IS NULL AND budget_currency IS NULL AND budget_fx_rate IS NULL AND budget_precision IS NULL
  ) OR (
    budget_amount > 0 AND budget_amount <= 1e12 AND budget_currency ~ '^[A-Z]{3}$'
    AND budget_fx_rate > 0 AND budget_precision BETWEEN 0 AND 6
    AND budget_amount IS NOT NULL AND budget_currency IS NOT NULL
    AND budget_fx_rate IS NOT NULL AND budget_precision IS NOT NULL));
-- UPDATE OF records a dependency on the milestone column. PostgreSQL requires the
-- trigger to be removed while changing that column's type; restore it below before
-- any stage allocations are updated. The transaction keeps both changes atomic.
DROP TRIGGER IF EXISTS stages_seed_expected_funding ON public.project_stages;
ALTER TABLE public.projects ALTER COLUMN budget_usd TYPE numeric(24,9);
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS milestone_amount numeric(24,6),
  ALTER COLUMN payment_milestone_usd TYPE numeric(24,9);
ALTER TABLE public.project_fees ADD COLUMN IF NOT EXISTS boq_waived_amount_usd numeric(24,9);

-- Existing attachments establish pricing mode, but cannot prove the original amount
-- or historical FX. Leave that evidence empty until the bill is checked.
UPDATE public.projects p SET budget_source = 'boq'
 WHERE p.budget_source IS NULL AND EXISTS (SELECT 1 FROM public.project_documents d
   WHERE d.project_id = p.id AND d.category = 'boq');
UPDATE public.projects SET budget_source = 'estimate' WHERE budget_source IS NULL;
-- Keep the previous amount and payment markers as evidence; waive the fee itself.
UPDATE public.project_fees f SET boq_waived_amount_usd = coalesce(f.boq_waived_amount_usd, f.amount_usd), amount_usd = 0
 FROM public.projects p WHERE p.id = f.project_id AND p.budget_source = 'boq' AND f.amount_usd <> 0;

-- Historical cost is retained, but it must never seed an expected payment.
CREATE OR REPLACE FUNCTION public.stages_seed_expected_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM public.payments WHERE stage_id = NEW.id AND direction = 'in';
  IF coalesce(NEW.pre_existing, false) THEN
    IF FOUND AND v_existing.state = 'expected' THEN DELETE FROM public.payments WHERE id = v_existing.id; END IF;
    RETURN NULL;
  END IF;
  IF NEW.payment_milestone_usd IS NULL OR NEW.payment_milestone_usd <= 0 THEN
    IF FOUND AND v_existing.state = 'expected' THEN DELETE FROM public.payments WHERE id = v_existing.id; END IF;
    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages SET payment_status = 'paid' WHERE id = NEW.id AND payment_status IS DISTINCT FROM 'paid';
    PERFORM set_config('app.payments_projection', 'off', true);
    RETURN NULL;
  END IF;
  IF round(NEW.payment_milestone_usd, 2) <= 0 THEN RETURN NULL; END IF;
  IF NOT FOUND THEN
    INSERT INTO public.payments (project_id, stage_id, direction, state, amount, currency)
    VALUES (NEW.project_id, NEW.id, 'in', 'expected', round(NEW.payment_milestone_usd, 2), 'USD');
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.payment_milestone_usd, 0) <= 0 THEN
      PERFORM set_config('app.payments_projection', 'on', true);
      UPDATE public.project_stages SET payment_status = public.project_payment_status(NEW.id)
       WHERE id = NEW.id AND payment_status IS DISTINCT FROM public.project_payment_status(NEW.id);
      PERFORM set_config('app.payments_projection', 'off', true);
    END IF;
  ELSIF v_existing.state = 'expected' AND v_existing.amount <> round(NEW.payment_milestone_usd, 2) THEN
    UPDATE public.payments SET amount = round(NEW.payment_milestone_usd, 2) WHERE id = v_existing.id;
  ELSIF v_existing.state IN ('funded', 'reconciled') AND TG_OP = 'UPDATE' THEN
    PERFORM set_config('app.payments_projection', 'on', true);
    UPDATE public.project_stages SET payment_status = public.project_payment_status(NEW.id)
     WHERE id = NEW.id AND payment_status IS DISTINCT FROM public.project_payment_status(NEW.id);
    PERFORM set_config('app.payments_projection', 'off', true);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER stages_seed_expected_funding
  AFTER INSERT OR UPDATE OF payment_milestone_usd ON public.project_stages
  FOR EACH ROW EXECUTE FUNCTION public.stages_seed_expected_funding();

CREATE OR REPLACE FUNCTION public.allocate_boq_stages(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.projects%ROWTYPE; v_pct numeric; v_units numeric; v_scale numeric;
BEGIN
  SELECT * INTO STRICT p FROM public.projects WHERE id = p_project FOR UPDATE;
  IF p.budget_source IS DISTINCT FROM 'boq' THEN RAISE EXCEPTION 'not_a_bill'; END IF;
  SELECT sum(budget_pct) INTO v_pct FROM public.project_stages WHERE project_id = p_project;
  IF v_pct IS NULL OR abs(v_pct - 100) > 0.0001 OR EXISTS (
    SELECT 1 FROM public.project_stages WHERE project_id = p_project AND budget_pct < 0
  ) THEN RAISE EXCEPTION 'invalid_stage_shares: percentages must total 100'; END IF;
  v_scale := power(10::numeric, p.budget_precision);
  v_units := round(p.budget_amount * v_scale);
  WITH shares AS (
    SELECT id, stage_number, budget_pct,
           v_units * budget_pct / v_pct AS exact
      FROM public.project_stages WHERE project_id = p_project
  ), ranked AS (
    SELECT *, floor(exact) AS whole,
      v_units - sum(floor(exact)) OVER () AS spare,
      row_number() OVER (ORDER BY exact - floor(exact) DESC, stage_number, id) AS rn
    FROM shares
  ) UPDATE public.project_stages s
       SET milestone_amount = (r.whole + CASE WHEN r.rn <= r.spare AND r.budget_pct > 0 THEN 1 ELSE 0 END) / v_scale,
           fixed_amount_usd = CASE WHEN s.budget_pct = 0 THEN 0 ELSE NULL END
      FROM ranked r WHERE s.id = r.id;

  -- Retain enough USD precision to reproduce source currency, and reconcile USD too.
  v_units := round(p.budget_usd * 1e9);
  WITH shares AS (
    SELECT id, stage_number, milestone_amount,
           v_units * milestone_amount / p.budget_amount AS exact
      FROM public.project_stages WHERE project_id = p_project
  ), ranked AS (
    SELECT *, floor(exact) AS whole,
      v_units - sum(floor(exact)) OVER () AS spare,
      row_number() OVER (ORDER BY exact - floor(exact) DESC, stage_number, id) AS rn
    FROM shares
  ) UPDATE public.project_stages s
       SET payment_milestone_usd = (r.whole + CASE WHEN r.rn <= r.spare AND r.milestone_amount > 0 THEN 1 ELSE 0 END) / 1e9
      FROM ranked r WHERE s.id = r.id;
  UPDATE public.project_fees SET amount_usd = 0 WHERE project_id = p_project;
  IF (SELECT sum(milestone_amount) FROM public.project_stages WHERE project_id = p_project) <> p.budget_amount
     OR (SELECT sum(payment_milestone_usd) FROM public.project_stages WHERE project_id = p_project) <> p.budget_usd THEN
    RAISE EXCEPTION 'stage_total_mismatch';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.allocate_boq_stages(uuid) FROM PUBLIC, anon, authenticated;

DELETE FROM public.payments pay USING public.project_stages s
 WHERE pay.stage_id = s.id AND s.pre_existing
   AND pay.direction = 'in' AND pay.state = 'expected';

CREATE OR REPLACE FUNCTION public.confirm_boq_budget(
  p_project_id uuid, p_amount numeric, p_currency text, p_fx_rate numeric,
  p_start_stage integer DEFAULT 1, p_source_label text DEFAULT NULL, p_source_file text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.projects%ROWTYPE; v_usd numeric; v_rate numeric;
BEGIN
  SELECT * INTO p FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT (public.is_admin() OR public.is_my_clients_project(p_project_id) OR p.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed: this is not your project';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1e12 OR scale(p_amount) > 6
    OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR p_fx_rate IS NULL OR p_fx_rate <= 0 OR p_fx_rate > 1e9
    OR (p_currency = 'USD' AND p_fx_rate <> 1)
    OR p_start_stage IS NULL THEN RAISE EXCEPTION 'invalid_bill_budget'; END IF;
  v_rate := round(p_fx_rate, 12);
  IF v_rate <= 0 THEN RAISE EXCEPTION 'invalid_bill_exchange_rate'; END IF;
  IF p.tracking_started_at IS NOT NULL THEN
    IF p.budget_source = 'boq' AND p.budget_amount = p_amount AND p.budget_currency = p_currency
       AND p.budget_fx_rate = v_rate AND coalesce(p.joined_at_stage, 1) = p_start_stage THEN RETURN; END IF;
    RAISE EXCEPTION 'already_started: the confirmed budget cannot be replaced here';
  END IF;
  v_usd := round(p_amount / v_rate, 9);
  IF v_usd <= 0 OR v_usd >= 1e15 THEN RAISE EXCEPTION 'invalid_bill_exchange_rate'; END IF;
  -- Existing RPC applies membership guards, activates the chosen stage and records
  -- earlier stages as complete. Bill allocations are retained on those stages.
  PERFORM public.admin_start_project_at_stage(
    p_project_id, v_usd, v_usd, 0, 0, 0, 0, 0, p_start_stage, NULL, true);
  UPDATE public.projects SET budget_source = 'boq', budget_amount = p_amount,
    budget_currency = p_currency, budget_fx_rate = v_rate, budget_precision = scale(p_amount),
    budget_source_label = left(p_source_label, 1000), budget_source_file = left(p_source_file, 1000)
    WHERE id = p_project_id;
  PERFORM public.allocate_boq_stages(p_project_id);
END $$;
REVOKE ALL ON FUNCTION public.confirm_boq_budget(uuid,numeric,text,numeric,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_boq_budget(uuid,numeric,text,numeric,integer,text,text) TO authenticated;

-- The earlier repair selected HT from this exact workbook. Only repair a project
-- still carrying that known amount and with no settled payment history. All other
-- existing bills need their own verified source amount; do not infer it from USD.
DO $$
DECLARE v_project uuid := 'cdb6cecd-eaba-4ffe-8bb3-65ec7048e923';
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_project
      AND p.budget_amount IS NULL AND p.budget_usd = round(1185805764.8 / 600, 2))
     AND EXISTS (SELECT 1 FROM public.project_documents d WHERE d.project_id = v_project
       AND d.category = 'boq' AND d.file_name LIKE '%Devis_R4_Penthouse_Simplifie_Corrige.xlsx')
     AND NOT EXISTS (SELECT 1 FROM public.project_stages s WHERE s.project_id = v_project
       AND coalesce(s.payment_status,'unpaid') <> 'unpaid' AND NOT coalesce(s.pre_existing,false))
     AND NOT EXISTS (SELECT 1 FROM public.payments pay WHERE pay.project_id = v_project
       AND (pay.state IN ('funded','reconciled') OR (pay.direction = 'out' AND pay.state <> 'failed'))) THEN
    UPDATE public.projects SET budget_usd = round(1414073374.524 / 600, 9),
      budget_source = 'boq', budget_amount = 1414073374.524, budget_currency = 'XAF',
      budget_fx_rate = 600, budget_precision = 3,
      budget_source_label = 'TOTAL GÉNÉRAL TTC — 2-Devis!E65',
      budget_source_file = 'Devis_R4_Penthouse_Simplifie_Corrige.xlsx'
      WHERE id = v_project;
    PERFORM public.allocate_boq_stages(v_project);
  END IF;
END $$;

-- Every later mutation must preserve the same contract across all views. Deferred
-- checks allow the confirmation RPC to update the complete schedule atomically.
CREATE OR REPLACE FUNCTION public.check_boq_budget_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; p public.projects%ROWTYPE; v_pct numeric;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  END IF;
  SELECT * INTO p FROM public.projects WHERE id = v_id;
  IF NOT FOUND OR p.budget_source IS DISTINCT FROM 'boq' OR p.tracking_started_at IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.project_fees WHERE project_id = v_id AND amount_usd <> 0) THEN
    RAISE EXCEPTION 'boq_has_no_platform_fees';
  END IF;
  -- Legacy projects have no verified source amount yet. Do not invent that evidence.
  IF p.budget_amount IS NULL THEN RETURN NULL; END IF;
  SELECT sum(budget_pct) INTO v_pct FROM public.project_stages WHERE project_id = v_id;
  IF p.budget_usd <> round(p.budget_amount / p.budget_fx_rate, 9)
     OR v_pct IS NULL OR abs(v_pct - 100) > 0.0001
     OR coalesce((SELECT sum(milestone_amount) FROM public.project_stages WHERE project_id = v_id),0) <> p.budget_amount
     OR coalesce((SELECT sum(payment_milestone_usd) FROM public.project_stages WHERE project_id = v_id),0) <> p.budget_usd
     OR EXISTS (SELECT 1 FROM public.project_stages WHERE project_id = v_id
       AND (milestone_amount IS NULL OR payment_milestone_usd IS NULL OR milestone_amount < 0
         OR payment_milestone_usd < 0 OR budget_pct < 0
         OR abs(payment_milestone_usd - round(milestone_amount / p.budget_fx_rate, 9)) > 0.000000001
         OR abs(milestone_amount - p.budget_amount * budget_pct / nullif(v_pct,0)) > power(10::numeric,-p.budget_precision)
         OR (budget_pct = 0 AND (milestone_amount <> 0 OR payment_milestone_usd <> 0)))) THEN
    RAISE EXCEPTION 'boq_stage_total_mismatch: stages must reconcile to the confirmed bill';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER boq_project_schedule AFTER INSERT OR UPDATE ON public.projects
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_boq_budget_schedule();
CREATE CONSTRAINT TRIGGER boq_stage_schedule AFTER INSERT OR UPDATE OR DELETE ON public.project_stages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_boq_budget_schedule();
CREATE CONSTRAINT TRIGGER boq_fee_schedule AFTER INSERT OR UPDATE OR DELETE ON public.project_fees
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_boq_budget_schedule();
COMMIT;
