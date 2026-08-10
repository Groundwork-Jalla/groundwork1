-- =========================================================
-- 032_admin_user_directory.sql
--
-- Give the admin panel a way to read users.
--
-- Every admin list page was written against columns that do not exist:
--   /admin/users     selects profiles(email, tier, role) — profiles has none of them.
--                    Email lives in auth.users; roles live in user_roles (001 is
--                    explicit that roles are NEVER on profiles); tier is per-project.
--   /admin/projects, /admin/reviews, /admin/budgets
--                    embed `profiles!inner(full_name, email)` off projects. PostgREST
--                    cannot infer that relationship at all — projects.user_id
--                    references auth.users, not profiles — so the request 400s.
--
-- Each page destructured only `data` and ignored `error`, so a 400 rendered as an
-- empty list. That is why Overview counted 7 projects while /admin/projects showed 0:
-- the counts select just `id` and succeed, the lists select the missing columns.
--
-- The browser cannot read auth.users, and it should not be able to. This function is
-- the narrow, admin-gated exception: SECURITY DEFINER so it may read auth.users, with
-- is_admin() re-checked inside so being able to call it is not the same as being
-- allowed to. It returns only what the admin screens display.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id         uuid,
  email      text,
  full_name  text,
  country    text,
  roles      text,
  tier       text,
  created_at timestamptz
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
    -- Roles are a set. Flatten to a display string; empty means a plain client,
    -- which the UI renders rather than inventing a 'homeowner' row that isn't there.
    COALESCE((
      SELECT string_agg(r.role, ', ' ORDER BY r.role)
      FROM public.user_roles r WHERE r.user_id = u.id
    ), '') AS roles,
    -- "Plan" is a property of a project, not a person. The most recent project's tier
    -- is the closest honest answer; NULL when they have no projects yet.
    (
      SELECT pr.tier FROM public.projects pr
      WHERE pr.user_id = u.id
      ORDER BY pr.created_at DESC
      LIMIT 1
    ) AS tier,
    u.created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE public.is_admin()
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMENT ON FUNCTION public.admin_list_users() IS
  'Admin-only user directory. SECURITY DEFINER to reach auth.users; re-checks is_admin() '
  'internally, so a non-admin caller gets zero rows rather than data.';

DO $$
DECLARE v_auth int; v_profiles int;
BEGIN
  SELECT count(*) INTO v_auth FROM auth.users;
  SELECT count(*) INTO v_profiles FROM public.profiles;
  RAISE NOTICE '% auth users, % profile rows.', v_auth, v_profiles;
  IF v_auth <> v_profiles THEN
    RAISE NOTICE 'Mismatch: % account(s) have no profile row. They will still list, with a blank name.',
      v_auth - v_profiles;
  END IF;
END $$;
