-- =========================================================
-- 013_notifications_rpc.sql
--
-- SECURITY DEFINER RPCs so any authenticated user can trigger
-- cross-user notifications without needing direct access to
-- user_roles or other users' data.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

-- ── notify_admins ─────────────────────────────────────────
-- Inserts a notification row for every admin user.
-- Called by: project creation, evidence upload, verify request.
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type  text,
  p_title text,
  p_body  text,
  p_data  jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT user_id, p_type, p_title, p_body, p_data
  FROM   public.user_roles
  WHERE  role = 'admin';
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_admins TO authenticated;

-- ── notify_project_members ────────────────────────────────
-- Inserts a notification for the project owner AND all accepted
-- contractors on the project, excluding the sender.
-- Called by: message sent.
CREATE OR REPLACE FUNCTION public.notify_project_members(
  p_project_id uuid,
  p_sender_id  uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_data       jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Notify project owner (if they aren't the sender)
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT user_id, p_type, p_title, p_body, p_data
  FROM   public.projects
  WHERE  id = p_project_id
    AND  user_id != p_sender_id;

  -- Notify accepted contractors (if they aren't the sender)
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT contractor_user_id, p_type, p_title, p_body, p_data
  FROM   public.contractor_invites
  WHERE  project_id = p_project_id
    AND  status = 'accepted'
    AND  contractor_user_id IS NOT NULL
    AND  contractor_user_id != p_sender_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_project_members TO authenticated;

-- ── Verify ───────────────────────────────────────────────
SELECT routine_name
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name IN ('notify_admins', 'notify_project_members');
