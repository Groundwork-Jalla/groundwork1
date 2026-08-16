-- =========================================================
-- 036_budget_composition.sql
--
-- Replace the budget composition model.
--
-- Until now a project had ONE money number — `budget_usd` — and every stage milestone was
-- `budget_usd × budget_pct / 100`. The client was quoted the construction cost and nothing
-- else; design and professional fees were not charged at all, and "permits" existed only
-- as an invented 2% slice of a six-way display split.
--
-- The model Groundwork actually sells is four lines:
--
--   construction_fee                     the take-off — what the trades cost
--   permit_fee       = 1% of construction    charged ON TOP, not inside
--   professional_fee = 50,000 XAF × 7 stages
--   design_fee       = 5,000 XAF per built m²
--   ─────────────────────────────────────
--   budget_usd       = the sum of those four
--
-- Two consequences drive everything in this file:
--
--   1. `budget_pct` shares are shares of the CONSTRUCTION FEE, not of `budget_usd`.
--      Leaving the old derivation in place would inflate every milestone by the whole fee
--      stack — on a typical build, by about 4%. So both start-tracking RPCs now take the
--      construction fee explicitly.
--
--      They take it rather than deriving it because the inverse
--      (`C = (total − professional − design) / 1.01`) already lives in TypeScript, and a
--      formula written in two languages is how the four disagreeing budget splits this
--      whole refactor exists to kill got there in the first place.
--
--   2. Design is an ABSOLUTE amount, not a share. `budget_pct` is INTEGER (003), so a
--      fixed fee was never expressible there at all. Hence `fixed_amount_usd`.
--
-- Permit and professional map to no stage — they are not site work — so they become rows
-- in `project_fees` rather than stages 11 and 12 of a 10-stage pipeline Vanessa signed off.
--
-- Existing projects are NOT re-priced. Migration 020's header gives the reasoning and it
-- applies verbatim: `payment_milestone_usd` derives from the confirmed budget, so
-- recomputing it silently moves money someone already agreed to pay.
--
-- Run in: Supabase Dashboard > SQL Editor (after 035)
-- =========================================================

-- ── 1. Absolute stage milestones ─────────────────────────
-- NULL means "derive from budget_pct", which is every stage except designCompleted.
ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS fixed_amount_usd NUMERIC(14,2);

COMMENT ON COLUMN public.project_stages.fixed_amount_usd IS
  'Absolute milestone in USD. When set it overrides budget_pct — used for the design fee, '
  'which is priced per built m² rather than as a share of the construction fee.';

-- ── 2. The two standalone fee milestones ─────────────────
CREATE TABLE IF NOT EXISTS public.project_fees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('permit', 'professional')),
  amount_usd     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);

CREATE INDEX IF NOT EXISTS project_fees_project_idx ON public.project_fees(project_id);

ALTER TABLE public.project_fees ENABLE ROW LEVEL SECURITY;

-- Mirrors the project_stages policies: the owner reads their own, admins read all, and an
-- accepted contractor reads the project they were invited to. No client-side writes at
-- all — amounts are set by createProject and by the start-tracking RPCs, both of which
-- derive them from one formula. A client that could edit its own permit fee could make
-- the four lines stop summing to the total.
DROP POLICY IF EXISTS "owners_select_fees"      ON public.project_fees;
DROP POLICY IF EXISTS "owners_insert_fees"      ON public.project_fees;
DROP POLICY IF EXISTS "admins_all_fees"         ON public.project_fees;
DROP POLICY IF EXISTS "contractors_select_fees" ON public.project_fees;

CREATE POLICY "owners_select_fees"
  ON public.project_fees FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_fees.project_id AND p.user_id = auth.uid()
  ));

-- INSERT only, and only on a project you own: createProject writes these rows as the
-- signed-in user immediately after inserting the project.
CREATE POLICY "owners_insert_fees"
  ON public.project_fees FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_fees.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "admins_all_fees"
  ON public.project_fees FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "contractors_select_fees"
  ON public.project_fees FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contractor_invites ci
    WHERE ci.project_id = project_fees.project_id
      AND ci.contractor_user_id = auth.uid()
      AND ci.status = 'accepted'
  ));

-- Backfill at zero so the payments UI has coherent rows to render for existing projects.
-- Deliberately NOT the real fee: re-pricing a live project is what 020 refuses to do.
INSERT INTO public.project_fees (project_id, kind, amount_usd)
SELECT p.id, k.kind, 0
FROM public.projects p
CROSS JOIN (VALUES ('permit'), ('professional')) AS k(kind)
ON CONFLICT (project_id, kind) DO NOTHING;

-- ── 3. Milestones now derive from the construction fee ───
-- Dropped rather than replaced: adding parameters changes the signature, and leaving the
-- 2-arg version in place would make `start_project_tracking(uuid, numeric)` resolve to the
-- old body — silently pricing milestones off the total for anyone on a stale client.
DROP FUNCTION IF EXISTS public.start_project_tracking(uuid, numeric);

CREATE FUNCTION public.start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Confirm the budget, stamp the start, flip the gate (owner-only, once)
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
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee, p_professional_fee
  );

  -- Activate stage 1
  UPDATE public.project_stages
    SET status = 'active'
    WHERE project_id = p_project_id
      AND stage_number = 1;

  -- Promote stage 1's substages so evidence upload can begin
  UPDATE public.project_substages sub
    SET status = 'pending'
    FROM public.project_stages ps
    WHERE sub.stage_id = ps.id
      AND ps.project_id = p_project_id
      AND ps.stage_number = 1
      AND sub.status = 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_start_project_tracking(uuid, numeric);

CREATE FUNCTION public.admin_start_project_tracking(
  p_project_id       uuid,
  p_final_budget     numeric,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
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
    p_project_id, p_construction_fee, p_design_fee, p_permit_fee, p_professional_fee
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

GRANT EXECUTE ON FUNCTION public.admin_start_project_tracking(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- ── 4. The shared milestone derivation ───────────────────
-- One body, called by both RPCs above. The owner-vs-admin authorisation differs; the
-- arithmetic must not, and it did drift between 018 and 019 before.
--
-- SECURITY DEFINER because the admin path has no UPDATE grant on project_stages (009).
-- Not callable directly — it does no authorisation of its own, so the grant is to the two
-- callers' definer context only, never to a client role.
--
-- ⚠️ That last sentence was WRONG when written, and migration 042 fixes it.
--    `start_project_tracking` above is SECURITY INVOKER (018 made it so, for RLS), so it
--    ran as `authenticated` and hit `42501: permission denied for function
--    apply_budget_milestones` on every client budget confirmation. Only the admin twin,
--    which really is DEFINER, ever worked. 042 makes the owner-facing one DEFINER too and
--    leaves this REVOKE in place.
CREATE OR REPLACE FUNCTION public.apply_budget_milestones(
  p_project_id       uuid,
  p_construction_fee numeric,
  p_design_fee       numeric,
  p_permit_fee       numeric,
  p_professional_fee numeric
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

  -- The two fee milestones. Upserted rather than updated: projects created before 036
  -- got backfilled $0 rows, and a project mid-flight may have none at all.
  INSERT INTO public.project_fees (project_id, kind, amount_usd)
  VALUES (p_project_id, 'permit',       p_permit_fee),
         (p_project_id, 'professional', p_professional_fee)
  ON CONFLICT (project_id, kind) DO UPDATE SET amount_usd = EXCLUDED.amount_usd;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apply_budget_milestones(uuid, numeric, numeric, numeric, numeric) IS
  'Shared milestone derivation for start_project_tracking and its admin twin. Stage '
  'milestones are shares of the CONSTRUCTION fee, not of the client total.';
