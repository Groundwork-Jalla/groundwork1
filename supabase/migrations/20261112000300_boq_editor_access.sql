-- BQ authoring belongs to assigned contractors and staff, independent of row ownership.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_edit_project_boq(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_admin()
    OR (public.is_contractor_on(p_project,auth.uid()) AND NOT public.is_project_client(p_project)));
$$;
REVOKE ALL ON FUNCTION public.can_edit_project_boq(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_edit_project_boq(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.project_team_access(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_owner uuid; v_primary boolean; v_client boolean; v_owner_contractor boolean;
  v_named_client boolean; v_contractor boolean; v_pending boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT user_id INTO v_owner FROM public.projects WHERE id=p_project;
  IF NOT FOUND OR NOT (public.is_admin() OR public.project_member(p_project)) THEN
    RAISE EXCEPTION 'not_permitted: this project is not available';
  END IF;
  v_primary:=public.is_primary_project_contractor(p_project);
  v_client:=public.is_project_client(p_project);
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project
    AND status='accepted' AND is_primary AND contractor_user_id=v_owner) INTO v_owner_contractor;
  SELECT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id=p_project AND is_client AND revoked_at IS NULL) INTO v_named_client;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='accepted') INTO v_contractor;
  SELECT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id=p_project AND status='pending') INTO v_pending;
  RETURN jsonb_build_object('can_invite',v_primary OR v_client,
    'can_edit_boq',public.can_edit_project_boq(p_project),
    'assigned_contractor',public.is_contractor_on(p_project,auth.uid()),
    'primary_client',v_client AND NOT v_primary,'primary_contractor',v_primary,
    'can_invite_client',v_primary AND v_owner_contractor AND NOT v_named_client,
    'can_invite_contractor',v_client AND NOT v_primary AND NOT v_contractor AND NOT v_pending,
    'has_client_invitation',v_named_client,'has_contractor',v_contractor,'has_pending_contractor',v_pending,
    'can_change_roles',public.is_admin(),
    'needs_primary_review',v_contractor AND NOT EXISTS(SELECT 1 FROM public.contractor_invites
      WHERE project_id=p_project AND status='accepted' AND is_primary));
END $$;

-- Keep the existing published-quote read policy for clients. Authoring is stricter.
DROP POLICY IF EXISTS "authors_select_takeoffs" ON public.project_takeoffs;
CREATE POLICY "authors_select_takeoffs" ON public.project_takeoffs FOR SELECT TO authenticated
  USING(created_by=auth.uid() AND public.can_edit_project_boq(project_id));
DROP POLICY IF EXISTS "authors_insert_takeoffs" ON public.project_takeoffs;
CREATE POLICY "authors_insert_takeoffs" ON public.project_takeoffs FOR INSERT TO authenticated
  WITH CHECK(created_by=auth.uid() AND public.can_edit_project_boq(project_id) AND status IN('draft','submitted'));
DROP POLICY IF EXISTS "authors_update_takeoffs" ON public.project_takeoffs;
CREATE POLICY "authors_update_takeoffs" ON public.project_takeoffs FOR UPDATE TO authenticated
  USING(created_by=auth.uid() AND public.can_edit_project_boq(project_id) AND status IN('draft','submitted'))
  WITH CHECK(created_by=auth.uid() AND public.can_edit_project_boq(project_id) AND status IN('draft','submitted'));
DROP POLICY IF EXISTS "authors_delete_takeoffs" ON public.project_takeoffs;
CREATE POLICY "authors_delete_takeoffs" ON public.project_takeoffs FOR DELETE TO authenticated
  USING(created_by=auth.uid() AND public.can_edit_project_boq(project_id) AND status='draft');
COMMIT;
