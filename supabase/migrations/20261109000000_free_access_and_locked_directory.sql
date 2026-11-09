-- Keep directory records and introductions available to staff only for now.
DROP POLICY IF EXISTS "anyone_reads_active_contractors" ON public.contractors;

CREATE OR REPLACE FUNCTION public.contractor_directory_entitled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin()
$$;

-- Invitations are no longer limited by the project plan.
DROP TRIGGER IF EXISTS enforce_contractor_invite_limit ON public.contractor_invites;

-- Subscription changes must not change a project's operating workflow.
DROP TRIGGER IF EXISTS profiles_sync_projects_tier ON public.profiles;
