-- Remove the project-creation cap entirely, for everyone.
--
-- 005 added it, 008 reworded it, 053 made it count archived projects, and 164
-- exempted contractors. Philip, 28 October: the self-verify project creation caps
-- "should be completely removed for both clients and contractors" — recorded as an
-- aligned decision, not a question.
--
-- So the half-measure in 164 goes with it. A rule that applies to nobody is worse
-- than no rule: it stays in the schema looking load-bearing, and the next person to
-- read it has to work out that the exemption swallows it.
--
-- WHAT IS REMOVED
--
-- Only the BEFORE INSERT trigger that refused the fourth project. The function is
-- dropped with it, because nothing else calls it.
--
-- WHAT IS NOT
--
-- Nothing about tiers, billing or entitlements. `self_verify` is still the tier every
-- project is created on, the tier guard (060/062) still refuses a tier change from the
-- browser, and owners still cannot delete a project (053). This migration says one
-- thing: how many projects you may create is no longer capped.
--
-- TO PUT IT BACK, recreate the trigger from 053 — the function body is there in full,
-- and 164 has the contractor exemption if a cap should ever apply to clients alone.
--
-- `plan-limits.ts` in the app already has no importers, so there is no client-side
-- cap to remove alongside this.

BEGIN;

DROP TRIGGER IF EXISTS enforce_starter_project_limit ON public.projects;
DROP FUNCTION IF EXISTS public.check_starter_project_limit();

COMMIT;
