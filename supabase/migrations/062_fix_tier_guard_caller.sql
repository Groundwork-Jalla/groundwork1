-- =========================================================
-- 062  Fix the tier guards — they were no-ops
--
-- 060 and 061 tested `current_user IN ('authenticated','anon')` to decide whether a
-- change came from a browser. Inside a SECURITY DEFINER function `current_user` is the
-- FUNCTION'S OWNER, not the caller — so the test was always false, the guards allowed
-- everything, and both migrations were elaborate no-ops.
--
-- Caught by attempting the exploit rather than by reading the code: a self_verify ->
-- jalla_management upgrade succeeded through the REST API using only that account's own
-- password, with 060 applied. A guard nobody attacks is a comment.
--
-- THE RELIABLE SIGNAL is the JWT role PostgREST puts in `request.jwt.claims`, which is
-- a session setting and therefore unaffected by SECURITY DEFINER:
--
--   'authenticated' / 'anon'   a browser  -> guard applies
--   'service_role'             the server -> allow
--   absent                     no JWT at all: a direct connection, the SQL editor, or a
--                              trigger fired inside a webhook's session -> allow
--
-- `SECURITY DEFINER` is kept, because the audit INSERT below needs to write to a table
-- the caller has no policy for. It is the caller-detection that had to change, not the
-- privilege the function runs with.
-- =========================================================

-- One place that answers "did this come from somebody's browser?", so the two guards
-- cannot drift apart the way they just did.
CREATE OR REPLACE FUNCTION public.is_client_request()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims TEXT := current_setting('request.jwt.claims', true);
  role_  TEXT;
BEGIN
  IF claims IS NULL OR claims = '' THEN
    RETURN FALSE;                       -- no JWT: not a PostgREST request
  END IF;
  role_ := (claims::jsonb) ->> 'role';
  RETURN role_ IN ('authenticated', 'anon');
EXCEPTION WHEN OTHERS THEN
  -- Malformed claims should fail CLOSED. A guard that opens when it cannot read the
  -- request is worse than no guard, because it looks like protection.
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_client_request() FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.guard_project_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_browser BOOLEAN := public.is_client_request();
BEGIN
  IF NEW.tier IS NOT DISTINCT FROM OLD.tier THEN
    RETURN NEW;
  END IF;

  IF from_browser AND NOT public.is_admin() THEN
    RAISE EXCEPTION
      'tier_change_denied: a project plan cannot be changed from the client. Upgrades '
      'happen through billing; jalla_management is set by an administrator.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF from_browser THEN
    INSERT INTO public.project_audit_log (project_id, action, actor_id, details)
    VALUES (NEW.id, 'tier_changed', auth.uid(),
            jsonb_build_object('from', OLD.tier, 'to', NEW.tier, 'by', 'admin'));
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.clamp_project_tier_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entitled TEXT;
BEGIN
  IF NOT public.is_client_request() OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.tier = 'self_verify' THEN
    RETURN NEW;
  END IF;

  SELECT subscription_tier INTO entitled FROM public.profiles WHERE id = NEW.user_id;

  IF COALESCE(entitled, 'self_verify') IS DISTINCT FROM NEW.tier THEN
    NEW.tier := 'self_verify';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_tier()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clamp_project_tier_on_insert()  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.is_client_request() IS
  'True when the statement came from a browser through PostgREST, read from the JWT '
  'role. Do NOT use current_user for this — inside SECURITY DEFINER it is the function '
  'owner, which made migrations 060 and 061 no-ops.';
