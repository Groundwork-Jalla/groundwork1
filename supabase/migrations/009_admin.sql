-- Legacy admin bootstrap. This is NOT the communication delivery migration:
-- use 20261113000900_communication_delivery_and_replies.sql for that release.
-- Replay preserves existing policies and the current is_admin() definition.
BEGIN;
DO $bootstrap$
DECLARE p record;
BEGIN
  -- Migration 089 deliberately removed browser audit writes. Never resurrect
  -- those old permissions by replaying this bootstrap on a newer database.
  IF to_regprocedure('public.log_activity(uuid,text,text,uuid,uuid,jsonb)') IS NOT NULL THEN
    RAISE NOTICE 'Legacy 009_admin setup is already superseded. No changes made. For communications, apply 20261113000800_groundwork_communications.sql, 20261113000900_communication_delivery_and_replies.sql, then 20261113001000_activation_invitation_priority.sql.';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.notifications (
    id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    data       JSONB DEFAULT '{}' NOT NULL,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  );
  ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  CREATE INDEX IF NOT EXISTS notifications_user_idx
    ON public.notifications(user_id, created_at DESC);

  -- Preserve helpers and grants installed by later security migrations.
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin'
      )
    $$;
    GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
  END IF;

  -- Add only missing policies; never drop or replace an existing definition.
  -- No admin SELECT policy is needed on user_roles: is_admin reads it as definer.
  FOR p IN SELECT * FROM (VALUES
    ('notifications',    'users_own_notifications',     'ALL',    'USING (user_id = auth.uid())'),
    ('projects',         'admin_select_all_projects',   'SELECT', 'USING (public.is_admin())'),
    ('project_stages',   'admin_select_all_stages',     'SELECT', 'USING (public.is_admin())'),
    ('project_substages','admin_select_all_substages',  'SELECT', 'USING (public.is_admin())'),
    ('project_messages', 'admin_select_all_messages',   'SELECT', 'USING (public.is_admin())'),
    ('project_documents','admin_select_all_documents',  'SELECT', 'USING (public.is_admin())'),
    ('project_audit_log','admin_select_all_audit_log',  'SELECT', 'USING (public.is_admin())'),
    ('contractor_invites','admin_select_all_invites',   'SELECT', 'USING (public.is_admin())'),
    ('profiles',         'admin_select_all_profiles',   'SELECT', 'USING (public.is_admin())'),
    ('project_stages',   'admin_update_stages',         'UPDATE', 'USING (public.is_admin())'),
    ('project_substages','admin_update_substages',       'UPDATE', 'USING (public.is_admin())'),
    ('notifications',    'admin_insert_notifications', 'INSERT', 'WITH CHECK (public.is_admin())'),
    ('project_audit_log','admin_insert_audit_log',       'INSERT', 'WITH CHECK (public.is_admin() OR actor_id = auth.uid())'),
    ('project_messages', 'admin_insert_messages',       'INSERT', 'WITH CHECK (public.is_admin())'),
    ('contractors',      'admin_select_all_contractors','SELECT', 'USING (public.is_admin())'),
    ('contractors',      'admin_update_contractors',    'UPDATE', 'USING (public.is_admin())')
  ) AS policies(table_name, policy_name, command, expression) LOOP
    -- Only the public directory table is relevant; it is optional.
    IF p.table_name = 'contractors' AND to_regclass('public.contractors') IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy policy
      JOIN pg_catalog.pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = p.table_name AND policy.polname = p.policy_name
    ) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s %s',
        p.policy_name, p.table_name, p.command, p.expression);
    END IF;
  END LOOP;
END;
$bootstrap$;
COMMIT;
