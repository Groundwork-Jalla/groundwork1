-- =========================================================
-- 035_admin_delete.sql
--
-- Let an admin remove a waitlist entry or a user account from the admin panel.
--
-- Contractors already work: `admins_write_contractors` (033) is FOR ALL, so DELETE is
-- covered. `waitlist_emails` only ever had SELECT (031), so it needs a policy.
--
-- Deleting a *user* is the one that needs care and cannot be done from the browser at
-- all — auth.users is not reachable with an anon key. Worse, `projects.user_id` is
-- ON DELETE CASCADE (003), so removing an account silently destroys every project that
-- account owns along with its stages, budget, documents, messages and audit history.
-- We hit this in practice: an account that looked disposable owned a live project, and
-- only an unrelated foreign-key restriction stopped the delete going through.
--
-- So `admin_delete_user()` does three things the dashboard's own delete does not:
--   - refuses to delete you, or the last remaining admin
--   - clears the references that would otherwise abort the delete halfway
--   - reports how many projects went with it, so the UI can say so
--
-- `admin_list_users()` gains project_count so the confirmation can warn BEFORE the fact.
--
-- Run in: Supabase Dashboard > SQL Editor (after 034)
-- =========================================================

-- ── waitlist ─────────────────────────────────────────────
DROP POLICY IF EXISTS "admins_delete_waitlist" ON public.waitlist_emails;
CREATE POLICY "admins_delete_waitlist"
  ON public.waitlist_emails FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ── user directory, now with a project count ─────────────
-- Dropped first, not CREATE OR REPLACE: adding project_count changes the return type,
-- and Postgres refuses to replace a function whose OUT parameters differ (42P13).
DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id            uuid,
  email         text,
  full_name     text,
  country       text,
  roles         text,
  tier          text,
  project_count integer,
  created_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email::text,
    p.full_name,
    p.country,
    COALESCE((
      SELECT string_agg(r.role, ', ' ORDER BY r.role)
      FROM public.user_roles r WHERE r.user_id = u.id
    ), '') AS roles,
    (
      SELECT pr.tier FROM public.projects pr
      WHERE pr.user_id = u.id ORDER BY pr.created_at DESC LIMIT 1
    ) AS tier,
    (SELECT count(*)::integer FROM public.projects pr WHERE pr.user_id = u.id) AS project_count,
    u.created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE public.is_admin()
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ── delete a user ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS TABLE (deleted_projects integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projects   integer;
  v_admins     integer;
  v_is_admin   boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may delete a user';
  END IF;

  -- Locking yourself out of the admin panel is not a recoverable mistake from inside
  -- the product — user_roles has no INSERT policy, so it would need the SQL editor.
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'self_delete: you cannot delete your own account';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin')
    INTO v_is_admin;
  SELECT count(*) INTO v_admins FROM public.user_roles WHERE role = 'admin';
  IF v_is_admin AND v_admins <= 1 THEN
    RAISE EXCEPTION 'last_admin: that is the only administrator left';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'not_found: no such user';
  END IF;

  -- Their projects. Everything hanging off a project cascades from here.
  DELETE FROM public.projects WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_projects = ROW_COUNT;

  -- References with no ON DELETE clause. Any one of these left behind aborts the
  -- delete with a foreign-key violation, which is what happens in the dashboard.
  DELETE FROM public.contractor_invites  WHERE invited_by = p_user_id;
  UPDATE public.contractor_invites  SET contractor_user_id = NULL WHERE contractor_user_id = p_user_id;
  DELETE FROM public.project_documents   WHERE uploaded_by = p_user_id;
  DELETE FROM public.project_messages    WHERE sender_id   = p_user_id;
  UPDATE public.project_audit_log   SET actor_id    = NULL WHERE actor_id    = p_user_id;
  UPDATE public.project_substages   SET approved_by = NULL WHERE approved_by = p_user_id;

  -- The account. Cascades profiles, user_profiles, user_roles, notifications;
  -- billing_events.user_id is ON DELETE SET NULL so billing history survives.
  DELETE FROM auth.users WHERE id = p_user_id;

  deleted_projects := v_projects;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_user(UUID) IS
  'Delete a user and everything that cascades from them. Refuses self-deletion and the '
  'last remaining admin. Returns the number of projects destroyed.';
