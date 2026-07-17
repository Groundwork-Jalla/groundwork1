-- =========================================================
-- 011_fix_storage_policies.sql
-- Ensure evidence + documents storage buckets exist and
-- have correct RLS policies using split_part() which is
-- more reliable across Supabase versions than foldername()[1].
--
-- Storage path format: {project_id}/{stage_id}/{substage_id}/{timestamp}_{filename}
-- split_part(name, '/', 1) extracts the project_id.
--
-- Run in: Supabase Dashboard > SQL Editor
-- =========================================================

-- ── Ensure buckets exist ────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence', 'evidence', false,
  10485760,   -- 10 MB
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 'documents', false,
  20971520,   -- 20 MB
  ARRAY['application/pdf','image/jpeg','image/png','image/gif','image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520;

-- ── Drop old evidence policies (may be missing or wrong) ─
DROP POLICY IF EXISTS "evidence_upload"          ON storage.objects;
DROP POLICY IF EXISTS "evidence_read"            ON storage.objects;
DROP POLICY IF EXISTS "evidence_delete"          ON storage.objects;
DROP POLICY IF EXISTS "contractor_evidence_upload" ON storage.objects;
DROP POLICY IF EXISTS "contractor_evidence_read"   ON storage.objects;

-- ── Drop old documents policies ───────────────────────────
DROP POLICY IF EXISTS "documents_upload" ON storage.objects;
DROP POLICY IF EXISTS "documents_read"   ON storage.objects;
DROP POLICY IF EXISTS "documents_delete" ON storage.objects;

-- ── Evidence: project owner policies ─────────────────────
-- Upload: project owner only
CREATE POLICY "evidence_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );

-- Read: project owner
CREATE POLICY "evidence_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );

-- Delete: project owner
CREATE POLICY "evidence_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );

-- ── Evidence: accepted contractor policies ─────────────────
-- Upload: accepted contractors
CREATE POLICY "contractor_evidence_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = split_part(name, '/', 1)
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

-- Read: accepted contractors
CREATE POLICY "contractor_evidence_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = split_part(name, '/', 1)
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

-- ── Documents: project owner policies ────────────────────
CREATE POLICY "documents_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY "documents_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY "documents_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = split_part(name, '/', 1)
    )
  );
