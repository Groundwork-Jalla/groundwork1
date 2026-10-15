-- A project INSERT ... RETURNING policy must not re-query the row being inserted.
--
-- Migration 119's helper reads the new project back from `projects`, which can be
-- invisible to that policy check while the INSERT statement is still running. Check
-- the returned row's own columns instead. Keep the access limited to the contractor
-- who created it, their own linked client, and the pre-tracking setup window.

BEGIN;

DROP POLICY IF EXISTS "contractors_select_own_client_setup_projects" ON public.projects;
CREATE POLICY "contractors_select_own_client_setup_projects"
  ON public.projects FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND tracking_started_at IS NULL
    AND public.is_my_client(user_id)
  );

COMMIT;
