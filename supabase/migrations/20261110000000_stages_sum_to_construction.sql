-- Stage milestones now add up to the construction fee exactly.
--
-- apply_budget_milestones rounded every stage on its own. Eight stages each rounded to a
-- whole dollar can drift from the construction fee by a few dollars either way, so the
-- stage list on the costing tab could sum to slightly more than the budget total
-- (Edgar's project, by roughly 100 XAF).
--
-- The project is shown in XAF (~590 per dollar), so a whole-dollar stage is ~590 XAF wide.
-- Stages are now stored in cents (the column is NUMERIC(14,2)), shared out by largest
-- remainder so they sum to the construction fee and never exceed it. Fixed-amount stages
-- (design) are unchanged. Part 2 corrects schedules that already exist.

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
    SET payment_milestone_usd = ROUND(fixed_amount_usd, 2)
    WHERE project_id = p_project_id AND fixed_amount_usd IS NOT NULL;

  WITH share AS (
    SELECT id,
           p_construction_fee * budget_pct * 100 / 100.0 AS exact
      FROM public.project_stages
     WHERE project_id = p_project_id AND fixed_amount_usd IS NULL
  ), ranked AS (
    SELECT id,
           floor(exact) AS whole,
           floor(sum(exact) OVER () + 0.000001) - sum(floor(exact)) OVER () AS spare,
           row_number() OVER (ORDER BY exact - floor(exact) DESC, id) AS rn
      FROM share
  )
  UPDATE public.project_stages ps
     SET payment_milestone_usd = (r.whole + CASE WHEN r.rn <= r.spare THEN 1 ELSE 0 END) / 100.0
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
-- Stage amounts were stored in whole dollars. At ~590 XAF to the dollar each stage could
-- sit up to ~295 XAF off, so the stage list read about 100 XAF over (or under) the budget.
-- Re-share the unsettled stages in CENTS, in proportion to what each already carries, so
-- the column adds up to the budget exactly. Paid, complete, pre-existing and fixed-fee
-- stages are never touched, and a project whose gap is over $10 is left for an admin to
-- re-cut with the preview on the Financials tab (184). Joined mid-build projects are
-- skipped: their budget is the remaining work, not the construction fee.
DO $$
DECLARE
  r         record;
  v_pool    numeric;
  v_settled numeric;
  v_open    numeric;
  v_cents   bigint;
  v_fixed   integer := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.budget_usd
      FROM public.projects p
     WHERE p.tracking_started_at IS NOT NULL
       AND p.joined_at_stage IS NULL
       AND p.budget_usd IS NOT NULL
  LOOP
    v_pool := r.budget_usd
      - COALESCE((SELECT sum(amount_usd) FROM public.project_fees WHERE project_id = r.id), 0)
      - COALESCE((SELECT sum(payment_milestone_usd) FROM public.project_stages
                   WHERE project_id = r.id AND fixed_amount_usd > 0), 0);

    SELECT COALESCE(sum(payment_milestone_usd), 0) INTO v_settled
      FROM public.project_stages
     WHERE project_id = r.id AND COALESCE(fixed_amount_usd, 0) = 0
       AND (COALESCE(pre_existing, false) OR payment_status = 'paid' OR status = 'complete');

    SELECT COALESCE(sum(payment_milestone_usd), 0) INTO v_open
      FROM public.project_stages
     WHERE project_id = r.id AND COALESCE(fixed_amount_usd, 0) = 0
       AND NOT (COALESCE(pre_existing, false) OR payment_status = 'paid' OR status = 'complete');

    CONTINUE WHEN v_open <= 0 OR v_pool - v_settled <= 0;
    CONTINUE WHEN abs((v_settled + v_open) - v_pool) > 10;
    CONTINUE WHEN (v_settled + v_open) = v_pool;

    v_cents := floor((v_pool - v_settled) * 100 + 0.000001);

    WITH open_st AS (
      SELECT id, payment_milestone_usd,
             v_cents * payment_milestone_usd / v_open AS exact
        FROM public.project_stages
       WHERE project_id = r.id AND COALESCE(fixed_amount_usd, 0) = 0
         AND NOT (COALESCE(pre_existing, false) OR payment_status = 'paid' OR status = 'complete')
    ), ranked AS (
      SELECT id, floor(exact) AS whole,
             v_cents - sum(floor(exact)) OVER () AS spare,
             row_number() OVER (ORDER BY exact - floor(exact) DESC, id) AS rn
        FROM open_st
    )
    UPDATE public.project_stages s
       SET payment_milestone_usd = (k.whole + CASE WHEN k.rn <= k.spare THEN 1 ELSE 0 END) / 100.0,
           budget_pct = round(((k.whole + CASE WHEN k.rn <= k.spare THEN 1 ELSE 0 END) / 100.0)
                              / NULLIF(v_pool, 0) * 100, 6)
      FROM ranked k
     WHERE s.id = k.id;

    PERFORM public.log_activity(r.id, 'project.stages_rebalanced', 'project', r.id, NULL,
      jsonb_build_object('construction_usd', v_pool,
                         'stage_total_before_usd', v_settled + v_open));
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'stage milestones rebalanced on % project(s)', v_fixed;
END $$;

-- The re-price RPC (184) rounded each stage to a whole dollar as well.
CREATE OR REPLACE FUNCTION public.reprice_project_stages(p_project uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_written int  := 0;
  v_refused int  := 0;
  v_ids     uuid[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized: only an administrator may re-price a live schedule';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'nothing_to_write: no stages were supplied';
  END IF;

  PERFORM 1 FROM public.project_stages WHERE project_id = p_project FOR UPDATE;

  WITH incoming AS (
    SELECT (r->>'stageId')::uuid AS id,
           (r->>'budgetPct')::numeric AS pct,
           (r->>'milestoneUsd')::numeric AS amount
      FROM jsonb_array_elements(p_rows) r
  ),
  allowed AS (
    SELECT i.* FROM incoming i
      JOIN public.project_stages s ON s.id = i.id
     WHERE s.project_id = p_project
       AND COALESCE(s.pre_existing, false) = false
       AND COALESCE(s.payment_status, 'unpaid') <> 'paid'
       AND s.status <> 'complete'
       AND COALESCE(s.fixed_amount_usd, 0) = 0
       AND i.pct >= 0 AND i.amount >= 0
  ),
  written AS (
    UPDATE public.project_stages s
       SET budget_pct = a.pct, payment_milestone_usd = ROUND(a.amount, 2)
      FROM allowed a WHERE s.id = a.id
    RETURNING s.id
  )
  SELECT array_agg(id) INTO v_ids FROM written;

  v_written := COALESCE(array_length(v_ids, 1), 0);
  v_refused := jsonb_array_length(p_rows) - v_written;
  IF v_written = 0 THEN
    RAISE EXCEPTION 'nothing_written: every stage supplied is settled, fixed or not on this project';
  END IF;

  PERFORM public.log_activity(p_project, 'project.repriced', 'project', p_project, v_actor,
    jsonb_build_object('stages_written', v_written, 'stages_refused', v_refused, 'rows', p_rows));

  RETURN jsonb_build_object('project_id', p_project, 'stages_written', v_written,
                            'stages_refused', v_refused);
END $$;

REVOKE ALL ON FUNCTION public.reprice_project_stages(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprice_project_stages(uuid, jsonb) TO authenticated;

COMMIT;
