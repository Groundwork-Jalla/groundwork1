-- =========================================================
-- 072  Verification and contingency become their own fee lines
--
-- From the Philip + Vanessa call of 4 September 2026.
--
-- ── What changed in the model ────────────────────────────────────────────────────────
-- The single "professional fee" of 50,000 XAF × 7 stages was two different things wearing
-- one label, and neither was a professional fee:
--
--   · it was really the VERIFICATION cost — an independent professional visiting site to
--     confirm a stage is finished before its milestone is released;
--   · the actual professional fees — the four people a build needs who are not on the
--     tools — were not charged at all.
--
-- So the client budget now carries six lines instead of four:
--
--   construction   the take-off
--   design         5,000 XAF × footprint × floors        (unchanged; Vanessa confirmed it)
--   professional   site manager   300,000 XAF × months
--                  qty surveyor    55,000 XAF × months
--                  lawyer         100,000 XAF flat, one contract
--                  project mgr          5% of construction
--   verification    50,000 XAF × 7 stages                (the old "professional" fee)
--   permit                2.25% of construction          (unchanged)
--   contingency              2% of everything above
--
-- Two of the four professional roles are billed per MONTH, which is why this migration
-- lands alongside the build-duration work: a bungalow is 14 days and each storey adds 42,
-- so an eight-storey block now costs eleven months of site management where it used to
-- cost the same flat $583 as a bungalow.
--
-- ── The 2% is deliberate, and supersedes an earlier 5% ───────────────────────────────
-- The 3 September meeting said professional fees were 10% of the total and miscellaneous
-- was 5%. Those were Philip reasoning alone; the 4 September figures came from working it
-- through with the engineer, and they win. Backlog items B2 and F19 still quote the old
-- numbers and are wrong.
--
-- ── Signatures change rather than gaining defaults ───────────────────────────────────
-- Following the precedent 041 set: the old arities are DROPPED so a stale client fails
-- loudly instead of silently pricing a project with two fee lines missing. Deploy the app
-- and run this together.
-- =========================================================

-- ── 1. project_fees may now hold four kinds ──────────────
ALTER TABLE public.project_fees
  DROP CONSTRAINT IF EXISTS project_fees_kind_check;

ALTER TABLE public.project_fees
  ADD CONSTRAINT project_fees_kind_check
  CHECK (kind IN ('permit', 'professional', 'verification', 'contingency'));

COMMENT ON COLUMN public.project_fees.kind IS
  'permit | professional | verification | contingency. The fee lines that map to no '
  'construction stage. Design is NOT here: it rides on the designCompleted stage via '
  'project_stages.fixed_amount_usd. See 036 and 072.';


-- ── 2. apply_budget_milestones learns the two new lines ──
DROP FUNCTION IF EXISTS public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric);

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
  -- The design stage carries an absolute amount; every other stage takes its share of
  -- the CONSTRUCTION fee. COALESCE is what keeps both in one statement.
  UPDATE public.project_stages
    SET fixed_amount_usd = CASE
          WHEN stage_key = 'designCompleted' THEN p_design_fee
          ELSE fixed_amount_usd
        END
    WHERE project_id = p_project_id;

  UPDATE public.project_stages
    SET payment_milestone_usd = ROUND(
          COALESCE(fixed_amount_usd, p_construction_fee * budget_pct / 100.0)
        )
    WHERE project_id = p_project_id;

  -- The fee milestones that map to no stage. Upserted rather than updated: projects
  -- created before 036 got backfilled $0 rows, one mid-flight may have none at all, and
  -- every project predating 072 has no verification or contingency row.
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

COMMENT ON FUNCTION public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric, numeric, numeric) IS
  'Writes the payment schedule for a project: stage milestones from the construction fee, '
  'the design fee onto its stage, and the four standalone fee rows. Every figure is '
  'computed in TypeScript and passed in, so the same arithmetic is never written twice.';


-- ── 3. Both tracking RPCs pass them through ──────────────
DROP FUNCTION IF EXISTS public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
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
  -- Ownership is enforced HERE, not by RLS. Nothing below runs unless this matches, and
  -- the whole function is one transaction. See 042 for why this is SECURITY DEFINER.
  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found, not owned by you, or tracking already started';
  END IF;

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee
  );

  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

REVOKE ALL ON FUNCTION public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;


DROP FUNCTION IF EXISTS public.admin_start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.admin_start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
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
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;

  UPDATE public.projects
    SET budget_usd          = p_final_budget,
        tracking_started_at = now(),
        updated_at          = now()
    WHERE id = p_project_id
      AND tracking_started_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or tracking already started';
  END IF;

  PERFORM public.apply_budget_milestones(
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee,
    p_professional_fee, p_verification_fee, p_contingency_fee
  );

  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;


-- ── 4. Existing projects ─────────────────────────────────
--
-- No backfill here, and that is not a shortcut.
--
-- Every displayed breakdown re-derives from `budget_usd` through `decomposeBudget`, which
-- now knows all six lines — so every project shows the new split the moment the app
-- deploys, still summing exactly to the total its owner confirmed.
--
-- What a SQL backfill CANNOT do is re-price the total, because that means re-running the
-- quantity take-off, which lives in TypeScript. Writing a second, approximate copy of the
-- fee arithmetic in PL/pgSQL is exactly the duplication `apply_budget_milestones` was
-- shaped to avoid — the whole reason it takes computed figures rather than deriving them.
--
-- Every project on the system today belongs to a beta tester and no real money is
-- committed, so re-pricing totals is safe whenever it is wanted. It belongs in an admin
-- action that runs the real engine, not in this file.
--
-- What is worth checking after this runs:
--
--   SELECT p.name,
--          p.budget_usd,
--          SUM(f.amount_usd) FILTER (WHERE f.kind = 'permit')       AS permit,
--          SUM(f.amount_usd) FILTER (WHERE f.kind = 'professional') AS professional,
--          SUM(f.amount_usd) FILTER (WHERE f.kind = 'verification') AS verification,
--          SUM(f.amount_usd) FILTER (WHERE f.kind = 'contingency')  AS contingency
--     FROM public.projects p
--     LEFT JOIN public.project_fees f ON f.project_id = p.id
--    WHERE p.tracking_started_at IS NOT NULL
--    GROUP BY p.id, p.name, p.budget_usd
--    ORDER BY p.created_at DESC;
--
-- Projects tracked before today will show NULL for the two new kinds until their next
-- re-price. That is visible rather than wrong.
