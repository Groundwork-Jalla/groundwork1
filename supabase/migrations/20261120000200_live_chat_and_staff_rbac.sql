-- Wave 3: Staff RBAC (admin / ops / finance / growth), Unified Audit Log RPC,
-- and Native Real-Time Live Chat (signed-in app + public website + Admin console).
BEGIN;

-- =========================================================
-- 1. Staff RBAC — expand user_roles safely + helper functions
-- =========================================================
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.user_roles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', v_constraint);
  END IF;
  ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('homeowner', 'contractor', 'admin', 'verifier', 'ops', 'finance', 'growth'));
END $$;

CREATE OR REPLACE FUNCTION public.has_staff_role(p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND (role = 'admin' OR role = ANY(p_roles))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.has_staff_role(ARRAY['admin', 'ops', 'finance', 'growth']);
$$;

CREATE OR REPLACE FUNCTION public.set_staff_role(
  p_user uuid,
  p_role text,
  p_grant boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_count int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only a super admin may change staff roles';
  END IF;
  IF p_role NOT IN ('admin', 'ops', 'finance', 'growth', 'verifier') THEN
    RAISE EXCEPTION 'invalid_role: unsupported staff role';
  END IF;

  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF p_role = 'admin' THEN
      SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';
      IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'last_admin: keep at least one admin account';
      END IF;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user AND role = p_role;
  END IF;

  INSERT INTO public.project_audit_log (actor_id, person_id, action, entity_type, details)
  VALUES (
    auth.uid(),
    p_user,
    CASE WHEN p_grant THEN 'staff_role_granted' ELSE 'staff_role_revoked' END,
    'staff_role',
    jsonb_build_object('role', p_role, 'granted', p_grant)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_staff_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_role(uuid, text, boolean) TO authenticated;

-- =========================================================
-- 2. Unified Audit Log RPC (project_audit_log + deletions + security)
-- =========================================================
CREATE OR REPLACE FUNCTION public.list_unified_audit_log(
  p_limit int DEFAULT 60,
  p_before timestamptz DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  source text,
  category text,
  action text,
  actor_id uuid,
  person_id uuid,
  project_id uuid,
  project_name text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit int := greatest(1, least(coalesce(p_limit, 60), 200));
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not_staff: staff access required';
  END IF;

  RETURN QUERY
  WITH merged AS (
    SELECT
      'pal:' || l.id::text AS id,
      'project_audit_log'::text AS source,
      CASE
        WHEN l.action ~* '(payment|payout|receipt|release|fund|disburs|budget|milestone|price|reconcil)' THEN 'finance'
        WHEN l.action ~* '(role|mfa|2fa|password|device|security|login|auth|token|session)' THEN 'security'
        WHEN l.action ~* '(delete|remove|purge|archive)' THEN 'deletion'
        ELSE 'project'
      END AS category,
      l.action::text AS action,
      l.actor_id,
      l.person_id,
      l.project_id,
      p.name::text AS project_name,
      coalesce(l.details, '{}'::jsonb) AS details,
      l.created_at
    FROM public.project_audit_log l
    LEFT JOIN public.projects p ON p.id = l.project_id

    UNION ALL

    SELECT
      'del:' || d.id::text AS id,
      'admin_deleted_projects'::text AS source,
      'deletion'::text AS category,
      'project_deleted'::text AS action,
      d.deleted_by AS actor_id,
      d.owner_id AS person_id,
      NULL::uuid AS project_id,
      coalesce(d.project_name, '')::text AS project_name,
      jsonb_build_object(
        'project_id', d.project_id,
        'reason', d.reason,
        'project_name', d.project_name
      ) AS details,
      d.deleted_at AS created_at
    FROM public.admin_deleted_projects d

    UNION ALL

    SELECT
      'sec:' || s.id::text AS id,
      'security_notify_log'::text AS source,
      'security'::text AS category,
      coalesce(s.kind, 'security_event')::text AS action,
      s.user_id AS actor_id,
      s.user_id AS person_id,
      NULL::uuid AS project_id,
      ''::text AS project_name,
      jsonb_build_object('kind', s.kind, 'email', s.email) AS details,
      s.created_at
    FROM public.security_notify_log s
  )
  SELECT m.id, m.source, m.category, m.action, m.actor_id, m.person_id, m.project_id, m.project_name, m.details, m.created_at
  FROM merged m
  WHERE (p_before IS NULL OR m.created_at < p_before)
    AND (p_category IS NULL OR p_category = '' OR p_category = 'all' OR m.category = p_category)
  ORDER BY m.created_at DESC
  LIMIT v_limit + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_unified_audit_log(int, timestamptz, text) TO authenticated;

-- =========================================================
-- 3. Native Live Chat (signed-in app + public website + Admin)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.live_chat_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  online boolean NOT NULL DEFAULT true,
  greeting_en text NOT NULL DEFAULT 'Hi! How can we help with your build today?',
  greeting_fr text NOT NULL DEFAULT 'Bonjour ! Comment pouvons-nous vous aider pour votre chantier ?',
  away_message_en text NOT NULL DEFAULT 'Our team is currently away. Leave your message and we will reply shortly by chat and email.',
  away_message_fr text NOT NULL DEFAULT 'Notre équipe est momentanément absente. Laissez votre message et nous vous répondrons rapidement.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users ON DELETE SET NULL
);

INSERT INTO public.live_chat_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.live_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_token_hash text UNIQUE,
  user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  visitor_name text NOT NULL DEFAULT '',
  visitor_email text NOT NULL DEFAULT '',
  visitor_role text NOT NULL DEFAULT 'visitor' CHECK (visitor_role IN ('visitor', 'homeowner', 'contractor')),
  topic text,
  page_path text NOT NULL DEFAULT '/',
  project_id uuid REFERENCES public.projects ON DELETE SET NULL,
  lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr')),
  status text NOT NULL DEFAULT 'waiting_on_us' CHECK (status IN ('open', 'waiting_on_us', 'waiting_on_user', 'resolved')),
  assigned_to uuid REFERENCES auth.users ON DELETE SET NULL,
  unread_for_staff int NOT NULL DEFAULT 0,
  unread_for_user int NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS live_chat_sessions_last_msg ON public.live_chat_sessions (last_message_at DESC);
CREATE INDEX IF NOT EXISTS live_chat_sessions_user ON public.live_chat_sessions (user_id, last_message_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_chat_sessions_status ON public.live_chat_sessions (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.live_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.live_chat_sessions ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'staff', 'internal')),
  sender_id uuid REFERENCES auth.users ON DELETE SET NULL,
  sender_name text NOT NULL DEFAULT '',
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_chat_messages_session ON public.live_chat_messages (session_id, created_at ASC);

-- Trigger to keep session preview, timestamps, status and unread counters consistent
CREATE OR REPLACE FUNCTION public.live_chat_on_message_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.sender_type = 'internal' THEN
    RETURN NEW;
  END IF;

  UPDATE public.live_chat_sessions
  SET
    last_message_at = NEW.created_at,
    last_message_preview = left(btrim(NEW.body), 240),
    status = CASE
      WHEN NEW.sender_type = 'user' THEN 'waiting_on_us'
      ELSE 'waiting_on_user'
    END,
    resolved_at = CASE WHEN NEW.sender_type = 'user' THEN NULL ELSE resolved_at END,
    unread_for_staff = CASE WHEN NEW.sender_type = 'user' THEN unread_for_staff + 1 ELSE 0 END,
    unread_for_user = CASE WHEN NEW.sender_type = 'staff' THEN unread_for_user + 1 ELSE 0 END
  WHERE id = NEW.session_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_chat_message_insert ON public.live_chat_messages;
CREATE TRIGGER trg_live_chat_message_insert
  AFTER INSERT ON public.live_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.live_chat_on_message_insert();

-- RLS on live chat tables
ALTER TABLE public.live_chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.live_chat_settings, public.live_chat_sessions, public.live_chat_messages FROM anon, authenticated;
GRANT ALL ON public.live_chat_settings, public.live_chat_sessions, public.live_chat_messages TO service_role;

GRANT SELECT ON public.live_chat_settings TO anon, authenticated;
GRANT UPDATE ON public.live_chat_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.live_chat_sessions TO authenticated;
GRANT SELECT, INSERT ON public.live_chat_messages TO authenticated;

DROP POLICY IF EXISTS live_chat_settings_read ON public.live_chat_settings;
CREATE POLICY live_chat_settings_read ON public.live_chat_settings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS live_chat_settings_staff_write ON public.live_chat_settings;
CREATE POLICY live_chat_settings_staff_write ON public.live_chat_settings
  FOR UPDATE TO authenticated
  USING (public.has_staff_role(ARRAY['admin', 'ops']))
  WITH CHECK (public.has_staff_role(ARRAY['admin', 'ops']));

DROP POLICY IF EXISTS live_chat_sessions_staff_all ON public.live_chat_sessions;
CREATE POLICY live_chat_sessions_staff_all ON public.live_chat_sessions
  FOR ALL TO authenticated
  USING (public.has_staff_role(ARRAY['admin', 'ops', 'growth']))
  WITH CHECK (public.has_staff_role(ARRAY['admin', 'ops', 'growth']));

DROP POLICY IF EXISTS live_chat_sessions_owner_select ON public.live_chat_sessions;
CREATE POLICY live_chat_sessions_owner_select ON public.live_chat_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS live_chat_sessions_owner_insert ON public.live_chat_sessions;
CREATE POLICY live_chat_sessions_owner_insert ON public.live_chat_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND visitor_token_hash IS NULL);

DROP POLICY IF EXISTS live_chat_sessions_owner_update ON public.live_chat_sessions;
CREATE POLICY live_chat_sessions_owner_update ON public.live_chat_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS live_chat_messages_staff_all ON public.live_chat_messages;
CREATE POLICY live_chat_messages_staff_all ON public.live_chat_messages
  FOR ALL TO authenticated
  USING (public.has_staff_role(ARRAY['admin', 'ops', 'growth']))
  WITH CHECK (public.has_staff_role(ARRAY['admin', 'ops', 'growth']));

DROP POLICY IF EXISTS live_chat_messages_owner_select ON public.live_chat_messages;
CREATE POLICY live_chat_messages_owner_select ON public.live_chat_messages
  FOR SELECT TO authenticated
  USING (
    sender_type <> 'internal'
    AND EXISTS (
      SELECT 1 FROM public.live_chat_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS live_chat_messages_owner_insert ON public.live_chat_messages;
CREATE POLICY live_chat_messages_owner_insert ON public.live_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'user'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.live_chat_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'live_chat_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat_sessions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'live_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat_messages;
  END IF;
END $$;

COMMIT;
