-- Stage milestones now add up to the construction fee exactly.
--
-- apply_budget_milestones rounded every stage on its own. Eight stages each rounded to a
-- whole dollar can drift from the construction fee by a few dollars either way, so the
-- stage list on the costing tab could sum to slightly more than the budget total
-- (Edgar's project, by roughly 100 XAF).
--
-- Whole dollars are kept, but the cents are shared out by largest remainder so the
-- stages sum to FLOOR(construction x their combined share) — never above the budget.
-- Fixed-amount stages (design) are unchanged.
--
-- Part 2 corrects schedules that already exist. Money that has moved is never touched:
-- only a stage that is unpaid, not complete, not pre-existing and not a fixed fee can
-- move, by at most a dollar each. A project that joined mid-build is skipped (its budget
-- is the remaining work, not the construction fee). Anything with a larger gap is left
-- for an admin to re-cut with the preview on the Financials tab (184).

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_budget_milestones(
  p_project_id       uuid,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric,
  p_verification_fee numeric,
  p_contingency_fee  numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.project_stages
    SET fixed_amount_usd = CASE
          WHEN stage_key = 'designCompleted' THEN p_design_fee
          ELSE fixed_amount_usd
        END
    WHERE project_id = p_project_id;

  UPDATE public.project_stages
    SET payment_milestone_usd = ROUND(fixed_amount_usd)
    WHERE project_id = p_project_id AND fixed_amount_usd IS NOT NULL;

  WITH share AS (
    SELECT id,
           p_construction_fee * budget_pct / 100.0 AS exact
      FROM public.project_stages
     WHERE project_id = p_project_id AND fixed_amount_usd IS NULL
  ), ranked AS (
    SELECT id,
           floor(exact) AS whole,
           ROUND(sum(exact) OVER ()) - sum(floor(exact)) OVER () AS spare,
           row_number() OVER (ORDER BY exact - floor(exact) DESC, id) AS rn
      FROM share
  )
  UPDATE public.project_stages ps
     SET payment_milestone_usd = r.whole + CASE WHEN r.rn <= r.spare THEN 1 ELSE 0 END
    FROM ranked r
   WHERE ps.id = r.id;

  INSERT INTO public.project_fees (project_id, kind, amount_usd)
  VALUES (p_project_id, 'permit',       p_permit_fee),
         (p_project_id, 'professional', p_professional_fee),
         (p_project_id, 'verification', p_verification_fee),
         (p_project_id, 'contingency',  p_contingency_fee)
  ON CONFLICT (project_id, kind) DO UPDATE SET amount_usd = EXCLUDED.amount_usd;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

-- ── Part 2: existing projects ─────────────────────────────
DO $$
DECLARE
  r        record;
  v_target numeric;
  v_sum    numeric;
  v_drift  integer;
  v_fixed  integer := 0;
  v_ids    uuid[];
BEGIN
  FOR r IN
    SELECT p.id, p.budget_usd
      FROM public.projects p
     WHERE p.tracking_started_at IS NOT NULL
       AND p.joined_at_stage IS NULL
       AND p.budget_usd IS NOT NULL
  LOOP
    SELECT r.budget_usd
           - COALESCE((SELECT sum(amount_usd) FROM public.project_fees WHERE project_id = r.id), 0)
           - COALESCE((SELECT sum(payment_milestone_usd) FROM public.project_stages
                        WHERE project_id = r.id AND fixed_amount_usd > 0), 0)
      INTO v_target;
    v_target := floor(v_target);

    SELECT COALESCE(sum(payment_milestone_usd), 0) INTO v_sum
      FROM public.project_stages
     WHERE project_id = r.id AND COALESCE(fixed_amount_usd, 0) = 0;

    v_drift := (v_sum - v_target)::integer;
    CONTINUE WHEN v_target <= 0 OR v_drift <= 0 OR v_drift > 5;

    SELECT array_agg(id) INTO v_ids FROM (
      SELECT id FROM public.project_stages
       WHERE project_id = r.id
         AND COALESCE(pre_existing, false) = false
         AND COALESCE(payment_status, 'unpaid') <> 'paid'
         AND status <> 'complete'
         AND COALESCE(fixed_amount_usd, 0) = 0
         AND payment_milestone_usd >= 1
       ORDER BY payment_milestone_usd DESC, stage_number
       LIMIT v_drift
    ) x;
    CONTINUE WHEN COALESCE(array_length(v_ids, 1), 0) < v_drift;

    UPDATE public.project_stages
       SET payment_milestone_usd = payment_milestone_usd - 1,
           budget_pct = round(((payment_milestone_usd - 1) / v_target * 100)::numeric, 6)
     WHERE id = ANY (v_ids);

    PERFORM public.log_activity(r.id, 'project.stages_rebalanced', 'project', r.id, NULL,
      jsonb_build_object('drift_usd', v_drift, 'stages', v_ids));
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'stage milestones rebalanced on % project(s)', v_fixed;
END $$;

COMMIT;
