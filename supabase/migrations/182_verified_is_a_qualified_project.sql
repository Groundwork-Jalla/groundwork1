-- =========================================================
-- 182  "Verified" means a QUALIFIED project with both sides on it
--
-- ── THE DEFINITION, AS CONFIRMED 9 NOV 2026 ────────────────────────────────────────
--
--   Activated project:  A real project brought onto Groundwork.
--   Qualified project:  A project with a bill of quantities on the platform and a
--                       start date within 60 days of its creation.
--   Verified project:   A QUALIFIED PROJECT with a contractor delivering the work and
--                       the client financing it, both active on the project in
--                       Groundwork.
--
-- ── WHAT 169 ACTUALLY COMPUTES ─────────────────────────────────────────────────────
--
-- Both the function and the view rank the cases like this:
--
--     WHEN client_joined AND has_ground_updates THEN 'verified'
--     WHEN has_boq AND starts_soon              THEN 'qualified'
--     ELSE 'general'
--
-- The first branch never asks about a bill of quantities or a start date. So a project
-- with a client on it and something posted from site is reported as VERIFIED even when
-- it is not qualified at all — which the definition says is impossible, because verified
-- is a qualified project that has gone further.
--
-- Reproduced on PostgreSQL 16 against real rows before this was written, which turned up
-- TWO ways through that branch rather than the one expected:
--
--   · no bill of quantities at all      169: verified   182: general
--   · a BQ, but a start date 90 days out 169: verified   182: general
--
-- The second is the easier one to hit by accident and the harder one to spot, because
-- the project looks complete from every angle except the date. Both now fall out of
-- 'verified', and the function and the view agree on every case — which they did not
-- have to, and the 30 Oct meeting opened with those two numbers disagreeing.
--
-- ── WHY IT HAS NOT SHOWN UP ────────────────────────────────────────────────────────
--
-- Checked against production on 9 Nov 2026: 3 qualified, and 0 verified. Nothing has
-- ever taken that branch, so no reported number has been wrong yet.
--
-- That is exactly why it is worth fixing now. This week's target is TWO verified
-- projects, and Ruth and Philip are working the qualified pipeline by hand to get them.
-- The first project that picks up a client and a site update without a bill of
-- quantities on file would be counted as verified on the board and would not be one.
-- A metric that is correct only while its count is zero is not yet a metric.
--
-- ── WHAT CHANGES, AND WHAT DOES NOT ────────────────────────────────────────────────
--
-- Only the ordering clause: verified now carries the qualified conditions as well. The
-- four signals are untouched, `security_invoker` on the view is untouched, and the
-- grants are untouched. No project that is correctly verified today stops being so —
-- there are none, and any that appear will have had to be qualified first, which is
-- what the team already believed the number meant.
-- =========================================================

CREATE OR REPLACE FUNCTION public.project_business_status(p_project uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH p AS (
    SELECT projects.target_start, projects.created_at
      FROM public.projects
     WHERE projects.id = p_project
  ),
  signals AS (
    SELECT
      -- A bill of quantities on file. 096 added the category; before it, a BQ was
      -- filed as 'contract', so those older rows read as general. Deliberate: we
      -- cannot tell a real BQ from a contract in that data, and guessing would
      -- inflate the number this whole exercise exists to make trustworthy.
      EXISTS (SELECT 1 FROM public.project_documents d
               WHERE d.project_id = p_project AND d.category = 'boq') AS has_boq,
      -- Within 60 days of creation, and not before it.
      (SELECT p.target_start IS NOT NULL
          AND p.target_start >= p.created_at::date
          AND p.target_start <= (p.created_at::date + 60) FROM p) AS starts_soon,
      -- The client is actually here, not merely invited.
      EXISTS (SELECT 1 FROM public.project_viewers v
               WHERE v.project_id = p_project
                 AND v.accepted_at IS NOT NULL
                 AND v.revoked_at IS NULL) AS client_joined,
      -- Something has happened on the ground.
      EXISTS (SELECT 1 FROM public.site_updates s
               WHERE s.project_id = p_project) AS has_ground_updates
  )
  SELECT CASE
    -- Verified is qualified AND MORE. The qualified conditions are repeated here
    -- rather than relied on by ordering, because the ordering said the opposite.
    WHEN has_boq AND starts_soon AND client_joined AND has_ground_updates
      THEN 'verified'
    WHEN has_boq AND starts_soon
      THEN 'qualified'
    ELSE 'general'
  END
  FROM signals;
$$;

REVOKE ALL ON FUNCTION public.project_business_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_business_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_business_status(uuid) IS
  'general | qualified | verified (169, corrected by 182). Verified is a QUALIFIED '
  'project with the client joined and work reported from site — not either alone. '
  'Independent of projects.status, which is the product lifecycle, not the business one.';

-- ── The bulk view has to agree, to the letter ──────────────────────────────────────
--
-- The admin cards count thousands of rows at a time and read the view, not the
-- function. Two copies of one definition is how the numbers diverged in the first place
-- (the 30 Oct meeting opened with the funnel figures disagreeing with each other), so
-- the same correction is applied here in the same shape.

CREATE OR REPLACE VIEW public.project_business_statuses AS
SELECT
  p.id                AS project_id,
  p.user_id,
  p.created_at,
  p.target_start,
  d.has_boq,
  (p.target_start IS NOT NULL
     AND p.target_start >= p.created_at::date
     AND p.target_start <= (p.created_at::date + 60))         AS starts_soon,
  v.client_joined,
  s.has_ground_updates,
  CASE
    WHEN d.has_boq
     AND p.target_start IS NOT NULL
     AND p.target_start >= p.created_at::date
     AND p.target_start <= (p.created_at::date + 60)
     AND v.client_joined AND s.has_ground_updates                THEN 'verified'
    WHEN d.has_boq
     AND p.target_start IS NOT NULL
     AND p.target_start >= p.created_at::date
     AND p.target_start <= (p.created_at::date + 60)             THEN 'qualified'
    ELSE 'general'
  END                 AS business_status
FROM public.projects p
LEFT JOIN LATERAL (
  SELECT EXISTS (SELECT 1 FROM public.project_documents d2
                  WHERE d2.project_id = p.id AND d2.category = 'boq') AS has_boq
) d ON TRUE
LEFT JOIN LATERAL (
  SELECT EXISTS (SELECT 1 FROM public.project_viewers v2
                  WHERE v2.project_id = p.id
                    AND v2.accepted_at IS NOT NULL
                    AND v2.revoked_at IS NULL) AS client_joined
) v ON TRUE
LEFT JOIN LATERAL (
  SELECT EXISTS (SELECT 1 FROM public.site_updates s2
                  WHERE s2.project_id = p.id) AS has_ground_updates
) s ON TRUE;

-- The view runs as the CALLER, so RLS on `projects` still decides which rows anyone
-- sees. Unchanged from 169 and restated because CREATE OR REPLACE VIEW does not keep it.
ALTER VIEW public.project_business_statuses SET (security_invoker = true);

REVOKE ALL ON public.project_business_statuses FROM PUBLIC, anon;
GRANT SELECT ON public.project_business_statuses TO authenticated;

COMMENT ON VIEW public.project_business_statuses IS
  'Per-project business status plus the signals behind it (169, corrected by 182), so '
  'a dashboard can show not just the count but why a project is not qualified yet.';
