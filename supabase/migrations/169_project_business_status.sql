-- One definition of what a project is worth to the business (30 Oct 2026).
--
-- WHY THIS EXISTS
--
-- Philip, in the working session: the admin dashboard must report "total projects,
-- qualified projects, verified projects" and the team must "use one shared definition
-- of an activated project". There was none. Every count was going to be written by
-- hand in whichever page needed it, and two pages written a week apart would have
-- disagreed — which is exactly what had already happened to the partner funnel
-- numbers that opened that meeting.
--
-- So the definition lives here, in SQL, once. The admin cards, the filters and any
-- later report all read the same column, and changing the rule is a migration rather
-- than a search across the app.
--
-- THE THREE STATUSES, AS AGREED
--
--   general    Anything that does not qualify. Test entries and half-explored
--              projects people made while looking around. The default, not a failure.
--
--   qualified  "A bill of quantities and a project start date within 60 days of
--              creation." Both, not either: a BQ with no date is a costing exercise,
--              and a date with no BQ is an intention. 60 days is measured from when
--              the project was CREATED, not from today, so a project does not quietly
--              fall out of qualified as the calendar moves — the question is whether
--              they were ready to build when they signed up, and that answer is fixed.
--
--   verified   "Active client participation, stakeholder involvement, and ongoing
--              ground updates." Rendered as: a client who was invited AND accepted,
--              plus at least one site update. Qualified is about intent; verified is
--              about a project that is actually running with its client watching, and
--              that is the one that earns revenue.
--
-- These are BUSINESS statuses and are deliberately independent of `projects.status`
-- (active / on_hold / completed / archived), which is the product lifecycle. Philip
-- was explicit that the two must not be conflated. A completed project can be
-- verified; an active one can be general.
--
-- WHY A FUNCTION AND A VIEW, NOT A COLUMN
--
-- A stored column would need a trigger on four tables (documents, viewers, site
-- updates, projects) to stay true, and the one thing worse than no number is a stale
-- one. This is derived on read. If it ever becomes too slow to read, the fix is a
-- materialised view refreshed on a schedule — not a column that can drift.
--
-- Run in: Supabase Dashboard > SQL Editor

BEGIN;

-- ── The rule ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_business_status(p_project uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH p AS (
    SELECT id, created_at, target_start
      FROM public.projects WHERE id = p_project
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
    WHEN client_joined AND has_ground_updates THEN 'verified'
    WHEN has_boq AND starts_soon              THEN 'qualified'
    ELSE 'general'
  END
  FROM signals;
$$;

REVOKE ALL ON FUNCTION public.project_business_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_business_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_business_status(uuid) IS
  'general | qualified | verified (169). The one shared definition, agreed 30 Oct 2026. '
  'Independent of projects.status, which is the product lifecycle, not the business one.';

-- ── Reading it in bulk ───────────────────────────────────
--
-- The admin cards count thousands of rows at a time, and calling the function per row
-- would be one scan per project. This computes the same three cases set-wise, from the
-- same signals, so the view and the function cannot disagree about a single project.

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
    WHEN v.client_joined AND s.has_ground_updates THEN 'verified'
    WHEN d.has_boq
     AND p.target_start IS NOT NULL
     AND p.target_start >= p.created_at::date
     AND p.target_start <= (p.created_at::date + 60)          THEN 'qualified'
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
-- sees. Staff read every project because their policies on `projects` already say so;
-- a contractor reading this view sees only their own. Nothing here widens access.
ALTER VIEW public.project_business_statuses SET (security_invoker = true);

REVOKE ALL ON public.project_business_statuses FROM PUBLIC, anon;
GRANT SELECT ON public.project_business_statuses TO authenticated;

COMMENT ON VIEW public.project_business_statuses IS
  'Per-project business status plus the signals behind it (169), so a dashboard can '
  'show not just the count but why a project is not qualified yet.';

COMMIT;
