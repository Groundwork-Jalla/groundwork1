-- =========================================================
-- 140 — A client cannot create their own project
--
-- PRODUCTION BUG. Every attempt by a client to create a project through the wizard
-- ends at step eleven with:
--
--   new row violates row-level security policy for table "projects"   (42501)
--
-- and the screen says "Groundwork would not save this project to your account."
--
-- It is not the INSERT. A plain insert by the owner succeeds; so does reading their
-- projects afterwards. What fails is the two together — `createProject` does
-- `.insert().select().single()`, and an INSERT ... RETURNING is only allowed to return
-- rows the SELECT policy can see.
--
-- 086 replaced 053's `owner_select_projects` with one policy for everybody:
--
--   member_select_projects USING (public.project_member(id))
--
-- and `project_member`'s first arm is
--
--   EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.user_id = auth.uid())
--
-- which RE-QUERIES the very row being inserted. While the INSERT is still running that
-- row is not visible to the subquery, so the owner is not yet a member of their own
-- project and RETURNING is refused.
--
-- This is a known shape. 120 fixed the identical problem for contractors and wrote the
-- rule down: "A project INSERT ... RETURNING policy must not re-query the row being
-- inserted. Check the returned row's own columns instead." The owner case was missed,
-- which is why a contractor creating a project FOR a client works (109 + 120) while a
-- client creating their own does not.
--
-- The fix is 120's, applied to the owner: a SELECT policy that reads the row's own
-- `user_id` and asks nothing of any table.
--
-- ── Not a widening of access ─────────────────────────────
-- `project_member` already intends the owner to be a member — that is its first arm.
-- This grants exactly what that arm grants and nothing else, so no row becomes visible
-- to anybody who could not already see it once the statement had finished. The only
-- difference is WHEN: this one can be evaluated against the row in flight.
--
-- Run in: Supabase Dashboard > SQL Editor (after 139)
-- =========================================================

BEGIN;

DROP POLICY IF EXISTS "owner_select_own_projects" ON public.projects;
CREATE POLICY "owner_select_own_projects"
  ON public.projects FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON POLICY "owner_select_own_projects" ON public.projects IS
  'The owner, decided from the row itself (140). `member_select_projects` covers the '
  'same people through project_member(), but that re-queries `projects` and so cannot '
  'see a row mid-INSERT — which made every client-created project fail at RETURNING. '
  'Same rule as 120 for contractors: never re-query the row being inserted.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   As a signed-in client with no projects, an insert that reads the row back must
--   now succeed:
--     POST /rest/v1/projects?select=*   with Prefer: return=representation
--     → 201 with the row, not 42501
--   And nothing else changes:
--     GET /rest/v1/projects  as another client → still only their own.
