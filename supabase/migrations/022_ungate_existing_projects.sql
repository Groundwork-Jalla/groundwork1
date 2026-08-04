-- 022_ungate_existing_projects.sql
--
-- Releases projects that are stuck behind the pre-tracking budget gate.
--
-- WHY THESE EXIST
-- Migration 018 added the gate and grandfathered everything that existed at the time:
--   UPDATE projects SET tracking_started_at = created_at WHERE tracking_started_at IS NULL;
-- But createProject() has set every new project gated ever since, so each project created
-- after 018 landed in the gate. The gate then rendered *instead of* the project on the
-- detail page, so owners could not open a build they had just costed.
--
-- The gate has since moved into the wizard as its final step: Self Verify and Jalla
-- Verify confirm their budget before the project row exists, and the detail page no
-- longer blocks. This migration clears the backlog those two changes leave behind.
--
-- Jalla Management is deliberately left gated — a Jalla admin still produces and confirms
-- that budget via admin_start_project_tracking, and that has not changed.

DO $$
DECLARE
  v_released INT;
BEGIN

-- Activate stage 1 and open its substages for the stuck projects.
--
-- 018's backfill only set tracking_started_at. Doing just that here would leave these
-- projects in an incoherent state — tracking "started" with every stage still locked and
-- no active stage — because createProject seeds all stages 'locked' when gated. So the
-- work start_project_tracking does has to happen too.

UPDATE public.project_stages ps
   SET status = 'active'
  FROM public.projects p
 WHERE ps.project_id = p.id
   AND p.tracking_started_at IS NULL
   AND p.tier <> 'jalla_management'
   AND ps.stage_number = 1
   AND ps.status = 'locked';

UPDATE public.project_substages sub
   SET status = 'pending'
  FROM public.project_stages ps
  JOIN public.projects p ON p.id = ps.project_id
 WHERE sub.stage_id = ps.id
   AND p.tracking_started_at IS NULL
   AND p.tier <> 'jalla_management'
   AND ps.stage_number = 1
   AND sub.status = 'locked';

-- Milestones are already derived from budget_usd at creation, so there is no figure to
-- re-derive here: these owners never got to enter a different one. Left as-is rather than
-- recalculated, so no stored amount silently changes.

UPDATE public.projects
   SET tracking_started_at = COALESCE(tracking_started_at, created_at)
 WHERE tracking_started_at IS NULL
   AND tier <> 'jalla_management';

GET DIAGNOSTICS v_released = ROW_COUNT;
RAISE NOTICE 'ungated % project(s); jalla_management left awaiting admin confirmation', v_released;

END $$;
