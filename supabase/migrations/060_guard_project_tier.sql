-- =========================================================
-- 060  A project owner may not change their own tier
--
-- THE HOLE. `owner_update_projects` (053, inherited from `owner_all_projects` in 003)
-- lets an owner update any column on their own row. `projects.tier` is one of those
-- columns, and nothing checked it. So any signed-in user could grant themselves
-- jalla_management with the public anon key and a single REST call:
--
--   PATCH /rest/v1/projects?id=eq.<their own project>
--   { "tier": "jalla_management" }
--
-- That is a self-service upgrade around billing. It bypasses the 3-project cap (053) and
-- the 1-contractor-per-project limit (030), both of which read `tier`. Confirmed by
-- doing it: the recording account was moved from self_verify to jalla_management using
-- only its own credentials.
--
-- WHY A TRIGGER RATHER THAN A COLUMN POLICY. Postgres RLS grants per COMMAND, not per
-- column, so there is no way to say "you may UPDATE this row but not this field" in a
-- policy. Column privileges could revoke UPDATE(tier) from `authenticated`, but that
-- would also block the SECURITY DEFINER sync path, which runs the UPDATE as its owner
-- yet is invoked in the caller's session. A BEFORE UPDATE trigger can tell the two
-- apart, which is exactly what is needed.
--
-- HOW IT TELLS THEM APART. `current_user` is the role actually executing the statement:
--
--   authenticated / anon   a browser, through PostgREST            -> refuse
--   postgres / service_role  a SECURITY DEFINER function or the
--                            server holding the service key        -> allow
--
-- So the two legitimate paths keep working untouched:
--   · Stripe -> profiles.subscription_tier -> sync_projects_to_subscription() (021),
--     which is SECURITY DEFINER and therefore runs as postgres
--   · anything server-side using the service-role key
--
-- Admins are allowed too, because "give this customer the managed tier we negotiated" is
-- real support work — and jalla_management is a contract, not a Stripe product (021 says
-- so explicitly and refuses to sync it). Every admin change is written to the audit log,
-- since a billing-affecting field changed by hand should leave a trace.
-- =========================================================

CREATE OR REPLACE FUNCTION public.guard_project_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_browser BOOLEAN := current_user IN ('authenticated', 'anon');
BEGIN
  IF NEW.tier IS NOT DISTINCT FROM OLD.tier THEN
    RETURN NEW;                       -- not a tier change; nothing to police
  END IF;

  IF from_browser AND NOT public.is_admin() THEN
    RAISE EXCEPTION
      'tier_change_denied: a project plan cannot be changed from the client. Upgrades '
      'happen through billing; jalla_management is set by an administrator.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reaching here means an admin did it by hand, or a server-side path did. Record the
  -- former: a tier moved outside billing is exactly the event someone will later want
  -- to explain.
  IF from_browser THEN
    INSERT INTO public.project_audit_log (project_id, action, actor_id, details)
    VALUES (NEW.id, 'tier_changed', auth.uid(),
            jsonb_build_object('from', OLD.tier, 'to', NEW.tier, 'by', 'admin'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_tier ON public.projects;
CREATE TRIGGER projects_guard_tier
  BEFORE UPDATE OF tier ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_tier();

REVOKE ALL ON FUNCTION public.guard_project_tier() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_project_tier() IS
  'Refuses owner-initiated changes to projects.tier. RLS grants per command, not per '
  'column, so without this an owner could PATCH themselves onto a paid plan. Billing '
  'and admins still work; admin changes are written to project_audit_log.';
