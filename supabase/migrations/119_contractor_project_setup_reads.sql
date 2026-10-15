-- A contractor must be able to read the rows returned by the creation inserts.
--
-- `createProject()` uses INSERT ... RETURNING for the project and seeded stages.
-- Contractors only became project members in `contractor_take_own_client_project`,
-- which runs after those inserts, so the member-only SELECT policies hid the new
-- rows and PostgREST rejected the inserts before the contractor could finish setup.
-- Allow read access only to an unstarted project this contractor created for their
-- own linked client. Once tracking starts, the ordinary member policy applies.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_my_client_project_setup(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.projects p
     WHERE p.id = p_project
       AND p.created_by = auth.uid()
       AND p.tracking_started_at IS NULL
       AND public.is_my_clients_project(p.id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_my_client_project_setup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_client_project_setup(uuid) TO authenticated;

DROP POLICY IF EXISTS "contractors_select_own_client_setup_projects" ON public.projects;
CREATE POLICY "contractors_select_own_client_setup_projects"
  ON public.projects FOR SELECT TO authenticated
  USING (public.is_my_client_project_setup(id));

DROP POLICY IF EXISTS "contractors_select_own_client_setup_stages" ON public.project_stages;
CREATE POLICY "contractors_select_own_client_setup_stages"
  ON public.project_stages FOR SELECT TO authenticated
  USING (public.is_my_client_project_setup(project_id));

COMMIT;
