-- =========================================================
-- 083 · Admin-provisioned client accounts
--
-- Jalla Management clients do not sign up. Their details are collected in person, an
-- admin creates the account, and the client is handed a username (their email) and a
-- temporary password. The server side of that lives in api/_handlers/admin-provision-
-- user.ts; this migration holds the two things the browser must never be able to fake:
--
--   · the record of WHO provisioned the account and WHEN, and
--   · the flag that forces a password change on first sign-in, which must clear only
--     when the password genuinely changes — not when the client says it has.
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provisioned_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioned_at       TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'Set by admin provisioning. The app refuses to enter until the password is changed. '
  'Cleared by on_auth_user_password_changed, never by the client — see migration 083.';
COMMENT ON COLUMN public.profiles.provisioned_by IS
  'The admin who created this account on the client''s behalf. NULL for self sign-ups.';

-- ── 1. Clear the flag when the password really changes ─────────────────────────────
--
-- GoTrue writes auth.users directly, on its own connection, with no request JWT. That is
-- the only writer of encrypted_password, so a change to that column IS a password change
-- — a recovery link, the /auth/new-password page, or an admin reset all land here. The
-- client never gets to assert "done"; the database observes it.
--
-- `app.password_sync` is the same exemption device as `app.email_sync` in 025: the guard
-- below must let THIS write through while refusing the same write from a browser.

CREATE OR REPLACE FUNCTION public.sync_password_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.password_sync', 'on', true);
  UPDATE public.profiles
     SET must_change_password = false
   WHERE id = NEW.id
     AND must_change_password;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_password_changed ON auth.users;
CREATE TRIGGER on_auth_user_password_changed
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.sync_password_changed();

-- ── 2. Guard ────────────────────────────────────────────────────────────────────────
--
-- "Users can update their own profile" (001) is FOR UPDATE with no column list, so
-- without this a provisioned client could PATCH must_change_password = false from the
-- browser console and keep the password the admin knows. Same shape as 021 and 025:
-- service_role and our own sync path pass; everyone else has the columns silently
-- restored so the rest of their profile update still lands.
--
-- provisioned_by is allowed to go NULL by anyone: ON DELETE SET NULL is an UPDATE and
-- fires this trigger, so pinning it would make deleting a former admin fail on every
-- account they ever created. The cost — a client erasing the name of who set them up —
-- is nil, because provisioned_at is pinned and still proves the account was provisioned.

CREATE OR REPLACE FUNCTION public.guard_provisioning_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.password_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  -- NULLIF: once a request-scoped GUC has been set in a session and the transaction
  -- ends, current_setting() reports '' rather than NULL, and ''::json is an error.
  -- A direct connection (a migration backfill, psql) must not trip over a claim it
  -- never made.
  IF coalesce(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.must_change_password := OLD.must_change_password;
  NEW.provisioned_at       := OLD.provisioned_at;
  IF NEW.provisioned_by IS NOT NULL THEN
    NEW.provisioned_by := OLD.provisioned_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_provisioning_columns ON public.profiles;
CREATE TRIGGER trg_guard_provisioning_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_provisioning_columns();

-- ── 3. The admin directory shows provisioning state ─────────────────────────────────
--
-- Rebased on the 035 definition (which added project_count). Return type changes, so
-- DROP first — CREATE OR REPLACE refuses a different OUT list (42P13). The new columns
-- let the users page say "awaiting first sign-in" against an account that was handed
-- over and never used, which is the question the admin who created it will ask.

DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id                   uuid,
  email                text,
  full_name            text,
  country              text,
  roles                text,
  tier                 text,
  project_count        integer,
  created_at           timestamptz,
  provisioned_by       uuid,
  must_change_password boolean,
  last_sign_in_at      timestamptz
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
    u.created_at,
    p.provisioned_by,
    COALESCE(p.must_change_password, false),
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE public.is_admin()
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMENT ON FUNCTION public.admin_list_users() IS
  'Admin-only user directory. SECURITY DEFINER to reach auth.users; re-checks is_admin() '
  'inside. 035 added project_count; 083 added provisioning state and last sign-in.';
