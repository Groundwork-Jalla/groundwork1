-- =========================================================
-- 004_phase3.sql
-- Phase 3: Evidence tracking, document vault, chat,
--           contractor invites, audit log, storage buckets
-- Run with: npx supabase db push
-- =========================================================

-- -------------------------------------------------------
-- Update tier names: starter / pro / enterprise
-- -------------------------------------------------------
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_tier_check;
UPDATE public.projects SET tier = 'starter'    WHERE tier = 'self_verify';
UPDATE public.projects SET tier = 'pro'        WHERE tier = 'jalla_verify';
UPDATE public.projects SET tier = 'enterprise' WHERE tier = 'jalla_management';
ALTER TABLE public.projects
  ADD CONSTRAINT projects_tier_check
  CHECK (tier IN ('starter','pro','enterprise'));
ALTER TABLE public.projects ALTER COLUMN tier SET DEFAULT 'starter';

-- -------------------------------------------------------
-- Extend project_substages with evidence + approval fields
-- -------------------------------------------------------
ALTER TABLE public.project_substages
  ADD COLUMN IF NOT EXISTS evidence_urls  JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS approved_by   UUID         REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ;

-- Extend status check to include pending_review
ALTER TABLE public.project_substages
  DROP CONSTRAINT IF EXISTS project_substages_status_check;
ALTER TABLE public.project_substages
  ADD CONSTRAINT project_substages_status_check
  CHECK (status IN ('locked','pending','in_progress','complete','pending_review'));

-- -------------------------------------------------------
-- PROJECT AUDIT LOG
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_audit_log (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id    UUID          REFERENCES public.project_stages(id),
  action      TEXT          NOT NULL,
  actor_id    UUID          REFERENCES auth.users(id),
  details     JSONB         NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.project_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_audit_log"
  ON public.project_audit_log FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "owner_insert_audit_log"
  ON public.project_audit_log FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- -------------------------------------------------------
-- PROJECT DOCUMENTS
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_documents (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name    TEXT          NOT NULL,
  file_path    TEXT          NOT NULL,
  file_size    INTEGER,
  mime_type    TEXT,
  uploaded_by  UUID          NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_documents"
  ON public.project_documents FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- -------------------------------------------------------
-- PROJECT MESSAGES
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_messages (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sender_id    UUID          NOT NULL REFERENCES auth.users(id),
  sender_name  TEXT          NOT NULL,
  content      TEXT          NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.project_messages REPLICA IDENTITY FULL;
ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_messages"
  ON public.project_messages FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "owner_send_messages"
  ON public.project_messages FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
    AND auth.uid() = sender_id
  );

-- -------------------------------------------------------
-- CONTRACTOR INVITES
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contractor_invites (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invited_by   UUID          NOT NULL REFERENCES auth.users(id),
  email        TEXT          NOT NULL,
  role         TEXT          NOT NULL DEFAULT 'contractor',
  status       TEXT          NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','rejected')),
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

ALTER TABLE public.contractor_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_invites"
  ON public.contractor_invites FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- -------------------------------------------------------
-- STORAGE BUCKETS + RLS
-- Note: bucket INSERT requires superuser or dashboard —
-- run via Supabase Dashboard > Storage > New bucket, OR
-- apply via the service_role key during CI setup.
-- -------------------------------------------------------

-- Evidence bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "evidence_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "evidence_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "evidence_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'evidence' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );

-- Documents bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "documents_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "documents_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "documents_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = (storage.foldername(name))[1]
    )
  );
