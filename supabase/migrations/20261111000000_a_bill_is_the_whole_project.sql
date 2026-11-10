-- =========================================================
-- A project priced from a bill of quantities is worth exactly what the bill says.
--
-- Runs after 20261110000000_stages_sum_to_construction.sql.
--
-- ── THE RULE, AS STATED 11 NOV 2026 ────────────────────────────────────────────────
--
--   "Someone that has uploaded their bill of quantities already knows what their
--    project costs. So we're working with exactly their project cost. We are not
--    charging them for anything."
--
--   1. The bill reads 59,675,280 and is confirmed as 59,675,280, so the project is
--      worth 59,675,280. Not a smaller figure.
--   2. Every stage gets its own percentage of that figure.
--   3. A build joined at stage 5 has stages 1–4 COMPLETE, each carrying its amount —
--      not zero. Zero is only for a stage whose percentage is zero.
--   4. Still to come = the total minus the completed stages.
--   5. Groundwork adds no fee lines. The bill is the whole cost.
--
-- ── WHAT WAS WRONG, AND WHERE ──────────────────────────────────────────────────────
--
-- Three places, all on the creation path, each fixed here or in Step11ConfirmBudget:
--
--   decomposeBudget     inverted the estimator's fee formulas OUT of the bill — right
--                       for an owner editing an estimate, wrong for a figure that has no
--                       Groundwork fee inside it to recover. ~12% relabelled as fees.
--   joinedBudget        then reduced the total again to "work still to come", and THAT
--                       reached budget_usd. Confirmed 59,675,280; stored $80,587.
--   admin_start_project_at_stage
--                       zeroed every stage before the join (162). Right for an estimate,
--                       where those stages were never priced for this client; wrong for
--                       a bill, where they are 17% of a figure the contractor quoted.
--
-- On the Home 2 project the contractor saw a value of 54,042,849 against a bill of
-- 59,675,280, and four completed stages reading 0 XAF.
-- =========================================================

BEGIN;

-- ── 1. The join RPC learns the difference between an estimate and a bill ──────────
--
-- One more parameter, defaulting to the old behaviour so every existing caller is
-- unchanged. When the project is priced from a bill, the stages before the join keep
-- the amount `apply_budget_milestones` just wrote for them — their percentage of the
-- bill — and are marked complete. Everything else the function does is as before.

DROP FUNCTION IF EXISTS public.admin_start_project_at_stage(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text);

CREATE OR REPLACE FUNCTION public.admin_start_project_at_stage(
  p_project_id        uuid,
  p_final_budget      numeric,
  p_construction_fee  numeric,
  p_design_fee        numeric,
  p_permit_fee        numeric,
  p_professional_fee  numeric,
  p_verification_fee  numeric,
  p_contingency_fee   numeric,
  p_start_stage       integer,
  p_note              text DEFAULT NULL,
  p_bill_of_quantities boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stages   integer;
  v_start    integer;
  v_skipped  integer;
BEGIN
  IF NOT (
       public.is_admin()
    OR public.is_my_clients_project(p_project_id)
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = p_project_id AND p.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_allowed: this is not your project';
  END IF;

  SELECT count(*) INTO v_stages FROM public.project_stages WHERE project_id = p_project_id;
  IF v_stages = 0 THEN RAISE EXCEPTION 'no_stages: this project has no stage schedule yet'; END IF;

  v_start := COALESCE(p_start_stage, 1);
  IF v_start < 1 OR v_start > v_stages THEN
    RAISE EXCEPTION 'bad_stage: % is not a stage on this project (1..%)', v_start, v_stages;
  END IF;
  IF v_start = v_stages THEN
    RAISE EXCEPTION 'nothing_left: a project cannot join at its final stage';
  END IF;

  UPDATE public.projects
     SET budget_usd          = p_final_budget,
         tracking_started_at = now(),
         joined_at_stage     = CASE WHEN v_start > 1 THEN v_start ELSE NULL END,
         updated_at          = now()
   WHERE id = p_project_id
     AND tracking_started_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'already_started: project not found, or tracking already started';
  END IF;

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee);

  PERFORM set_config('app.join_in_progress', 'on', true);

  -- The stages already built. On a bill they KEEP the amount just written for them:
  -- the bill priced the whole building and these are part of it. On an estimate they
  -- are zeroed as before — that total was only ever for the work to come.
  UPDATE public.project_stages
     SET status                   = 'complete',
         pre_existing             = true,
         pre_existing_recorded_at = now(),
         verification_required    = false,
         payment_milestone_usd    = CASE WHEN p_bill_of_quantities
                                         THEN payment_milestone_usd ELSE 0 END,
         fixed_amount_usd         = 0,
         completed_at             = NULL
   WHERE project_id = p_project_id AND stage_number < v_start;
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  UPDATE public.project_substages sub
     SET status = 'complete', approved_by = NULL, approved_at = NULL
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number < v_start;

  UPDATE public.project_stages
     SET status = 'active'
   WHERE project_id = p_project_id AND stage_number = v_start;

  UPDATE public.project_substages sub
     SET status = 'pending'
    FROM public.project_stages ps
   WHERE sub.stage_id = ps.id
     AND ps.project_id = p_project_id
     AND ps.stage_number = v_start
     AND sub.status = 'locked';

  UPDATE public.projects SET current_stage = v_start WHERE id = p_project_id;

  PERFORM public.log_activity(p_project_id, 'project.joined_in_progress', 'project', p_project_id, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'start_stage', v_start,
      'stages_marked_pre_existing', v_skipped,
      'budget_usd', p_final_budget,
      'priced_from_bill', CASE WHEN p_bill_of_quantities THEN true ELSE NULL END,
      'described_as', NULLIF(btrim(p_note), ''))));

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'start_stage', v_start,
    'pre_existing_stages', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.admin_start_project_at_stage(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_start_project_at_stage(
  uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, text, boolean)
  TO authenticated;

-- ── 2. Projects already created from a bill ───────────────────────────────────────
--
-- The bill total is not stored, so every uploaded bill was re-read: spreadsheets
-- through the app's own extractor, PDFs through poppler into the same `readBqTotal`.
-- Nine projects carry one. FIVE DID NOT READ AS A PROJECT TOTAL and are listed at the
-- end for a person to settle — NGODI, for one, read 250,000,750,000 off a line called
-- "Gravier 5/15", which would put $416 million on a project holding $7,499. A machine
-- reading is evidence; it is not a budget.
--
-- Converted at the country's STORED rate, never a live one, so this produces the same
-- figures whenever it is run.

CREATE TEMP TABLE confirmed_bill (
  project_id  uuid PRIMARY KEY,
  bill_local  numeric NOT NULL,
  fx_rate     numeric NOT NULL,
  evidence    text    NOT NULL
) ON COMMIT DROP;

INSERT INTO confirmed_bill (project_id, bill_local, fx_rate, evidence) VALUES
  -- BOQ Sample.xlsx, SUMMARY block: "TOTAL 59675280". Its nine section totals add to it.
  ('6fab6934-23cc-419b-aacf-1ee6f7fb583d', 59675280,     600, 'TOTAL 59675280'),
  -- QUANTITATIVE ESTIMATE ... MME. SERAPHINE.xlsx: "TOTAL 137347500 137347500"
  ('3cdbc05a-7546-491c-b03a-3ede8eef1e60', 137347500,    600, 'TOTAL 137347500'),
  -- Mr.NAS G + 1 Cost Estimate Limbe.pdf: "NET PAYABLE 26,687,728"
  ('48fc6422-57ea-4ae9-aae5-4c5dff67cb1d', 26687728,     600, 'NET PAYABLE 26,687,728'),
  -- Devis_R4_Penthouse_Simplifie_Corrige.xlsx: "TOTAL HORS TAXES 1185805764.8"
  ('cdb6cecd-eaba-4ffe-8bb3-65ec7048e923', 1185805764.8, 600, 'TOTAL HORS TAXES 1185805764.8');

-- If a bill was refiled or removed since it was read, this is no longer that project.
DELETE FROM confirmed_bill c
 WHERE NOT EXISTS (SELECT 1 FROM public.project_documents d
                    WHERE d.project_id = c.project_id AND d.category = 'boq');

-- The total: exactly the bill.
UPDATE public.projects p
   SET budget_usd = round(c.bill_local / c.fx_rate, 2)
  FROM confirmed_bill c
 WHERE p.id = c.project_id;

-- No fee lines. The bill is the whole cost and nothing is charged on top of it.
UPDATE public.project_fees f
   SET amount_usd = 0
  FROM confirmed_bill c
 WHERE f.project_id = c.project_id
   AND f.amount_usd <> 0;

-- Every stage: its percentage of the bill. Stages completed before the join INCLUDED —
-- they were zeroed on creation and that is the fault being repaired. The one thing left
-- alone is a stage the client has actually paid through Groundwork.
UPDATE public.project_stages s
   SET payment_milestone_usd = round(p.budget_usd * s.budget_pct / 100.0, 2),
       fixed_amount_usd      = CASE WHEN COALESCE(s.fixed_amount_usd, 0) <> 0
                                    THEN 0 ELSE s.fixed_amount_usd END
  FROM public.projects p
  JOIN confirmed_bill c ON c.project_id = p.id
 WHERE s.project_id = p.id
   AND NOT (COALESCE(s.payment_status, 'unpaid') = 'paid'
            AND COALESCE(s.pre_existing, false) = false);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id, p.name, p.budget_usd,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id) AS all_stages,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id AND s.status = 'complete') AS completed,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id AND s.status <> 'complete') AS still_to_come
      FROM public.projects p JOIN confirmed_bill c ON c.project_id = p.id
  LOOP
    RAISE NOTICE '% : total % | stages sum % | completed % | still to come %',
      r.name, r.budget_usd, r.all_stages, r.completed, r.still_to_come;
    PERFORM public.log_activity(r.id, 'project.repriced_from_bill', 'project', r.id, NULL,
      jsonb_build_object('budget_usd', r.budget_usd, 'completed_usd', r.completed,
                         'still_to_come_usd', r.still_to_come));
  END LOOP;
END $$;

COMMIT;

-- ── NEEDS A PERSON: the bill could not be read with confidence ─────────────────────
--
-- Open the document, state the total, add a row to the table above with the line it
-- came from, and re-run.
--
--   cba1ef68-3f23-43d2-b9dc-6548708d756d  NGODI ATLANTIC WAREHOUSE      holds $7,499
--   237a8cbc-4fbb-468e-855c-5159ef65b8e5  Mini Port (Youpwe)            holds $20,474,254
--   377a2963-b899-4e87-bb30-15516a0d3937  MME TOKO                      holds $55.27
--   b8aa3880-3e74-4df2-87a2-4e50debd5335  PROJET SS+RDC+10 M TAMSO      holds $2,525,167
--   1a1fc897-7287-4397-b4cb-2041db81d11c  Dual - Family Duplex (G+1)    holds $50,192.29
--
-- MME TOKO first: $55.27 is not a basement-plus-eight-storey building in Douala, and
-- that reading failed on creation day, not here.
