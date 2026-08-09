-- =========================================================
-- 029_admin_assign_contractor.sql
--
-- Lets Jalla staff put a contractor onto a client's project.
--
-- Why this is needed: the Team section in Settings was specified as "contractors you
-- invited, OR those assigned to you by Jalla" — but only the first half existed.
-- `owner_all_invites` scopes contractor_invites to the project owner, so an admin
-- writing one is refused by RLS. For a Jalla Management client, who by definition is
-- not sourcing their own contractors, the Team tab was therefore always empty.
--
-- Follows the shape of admin_start_project_tracking (019): a SECURITY DEFINER
-- function that re-checks is_admin() itself, rather than widening the table policy.
-- Widening the policy would grant admins blanket write access to every invite row;
-- this grants exactly one operation and logs it.
--
-- Run in: Supabase Dashboard > SQL Editor.
-- =========================================================

-- ── Admins can read invites, for the admin project view ──
DROP POLICY IF EXISTS "admins_read_invites" ON public.contractor_invites;
CREATE POLICY "admins_read_invites"
  ON public.contractor_invites FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ── Assign ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_assign_contractor(
  p_project_id uuid,
  p_email      text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id uuid;
  v_email     text := lower(trim(p_email));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  -- Assigned, not invited: the client did not initiate this, so it lands accepted
  -- and shows in their Team tab immediately. UNIQUE (project_id, email) means
  -- re-assigning the same person promotes a pending invite rather than erroring.
  INSERT INTO public.contractor_invites (project_id, invited_by, email, role, status, accepted_at)
  VALUES (p_project_id, auth.uid(), v_email, 'contractor', 'accepted', now())
  ON CONFLICT (project_id, email) DO UPDATE
    SET status      = 'accepted',
        accepted_at = COALESCE(public.contractor_invites.accepted_at, now())
  RETURNING id INTO v_invite_id;

  INSERT INTO public.project_audit_log (project_id, actor_id, action, details)
  VALUES (
    p_project_id,
    auth.uid(),
    'admin_assigned_contractor',
    jsonb_build_object('email', v_email)
  );

  RETURN v_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_contractor(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_assign_contractor(uuid, text) TO authenticated;

-- ── Verify ───────────────────────────────────────────────
-- Should return one row: admin_assign_contractor.
SELECT proname FROM pg_proc WHERE proname = 'admin_assign_contractor';
