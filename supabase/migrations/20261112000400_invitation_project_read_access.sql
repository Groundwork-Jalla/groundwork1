-- Invitation acceptance must grant the same project reads regardless of account role.
BEGIN;
CREATE OR REPLACE FUNCTION public.project_member(p_project uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = p_project AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.contractor_invites ci
                WHERE ci.project_id = p_project
                  AND ci.contractor_user_id = auth.uid()
                  AND ci.status = 'accepted')
    OR EXISTS (SELECT 1 FROM public.project_verifiers pv
                WHERE pv.project_id = p_project
                  AND pv.user_id = auth.uid()
                  AND pv.status = 'active')
    -- 112: somebody the owner invited to watch. Read only, because everything behind
    -- this function is a SELECT policy.
    OR EXISTS (SELECT 1 FROM public.project_viewers v
                WHERE v.project_id = p_project
                  AND v.user_id = auth.uid()
                  AND v.accepted_at IS NOT NULL
                  AND v.revoked_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.project_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_member(uuid) TO authenticated;
DO $$ DECLARE v_table text; v_column text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['projects','project_stages','project_substages','project_documents','project_fees','payments'] LOOP
    v_column := CASE WHEN v_table='projects' THEN 'id' ELSE 'project_id' END;
    EXECUTE format('DROP POLICY IF EXISTS review_members_read ON public.%I',v_table);
    IF v_table='payments' THEN
      -- Shared project totals use incoming client receipts; releases to other
      -- beneficiaries retain their existing, narrower ledger policies.
      EXECUTE 'CREATE POLICY review_members_read ON public.payments FOR SELECT TO authenticated USING (public.is_admin() OR (direction=''in'' AND public.project_member(project_id)))';
    ELSE
      EXECUTE format('CREATE POLICY review_members_read ON public.%I FOR SELECT TO authenticated USING (public.is_admin() OR public.project_member(%I))',v_table,v_column);
    END IF;
  END LOOP;
END $$;
COMMIT;
