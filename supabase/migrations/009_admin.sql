-- =========================================================
-- 009_admin.sql
-- Admin panel: notifications table, is_admin() helper,
-- admin RLS policies on all core tables
-- =========================================================

-- ── notifications ─────────────────────────────────────────

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

CREATE POLICY "users_own_notifications"
  ON public.notifications FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications(user_id, created_at DESC);

-- ── is_admin() helper ─────────────────────────────────────
-- SECURITY DEFINER so it can read user_roles without RLS loops

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ── Admin SELECT policies ─────────────────────────────────

CREATE POLICY "admin_select_all_projects"
  ON public.projects FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_stages"
  ON public.project_stages FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_substages"
  ON public.project_substages FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_messages"
  ON public.project_messages FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_documents"
  ON public.project_documents FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_audit_log"
  ON public.project_audit_log FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_invites"
  ON public.contractor_invites FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin_select_all_profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- NOTE: No admin SELECT policy on user_roles — is_admin() queries user_roles internally,
-- so a policy calling is_admin() on that table would cause infinite recursion.

-- ── Admin UPDATE/INSERT policies ──────────────────────────

CREATE POLICY "admin_update_stages"
  ON public.project_stages FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "admin_update_substages"
  ON public.project_substages FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "admin_insert_notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "admin_insert_audit_log"
  ON public.project_audit_log FOR INSERT
  WITH CHECK (public.is_admin() OR actor_id = auth.uid());

-- ── Admin can send messages on any project ────────────────

CREATE POLICY "admin_insert_messages"
  ON public.project_messages FOR INSERT
  WITH CHECK (public.is_admin());

-- ── Contractors table admin access ───────────────────────
-- (contractors table from migration 006)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contractors') THEN
    EXECUTE $pol$
      CREATE POLICY "admin_select_all_contractors"
        ON public.contractors FOR SELECT
        USING (public.is_admin())
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "admin_update_contractors"
        ON public.contractors FOR UPDATE
        USING (public.is_admin())
    $pol$;
  END IF;
END $$;
