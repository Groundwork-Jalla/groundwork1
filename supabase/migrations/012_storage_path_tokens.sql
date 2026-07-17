-- =========================================================
-- 012_storage_path_tokens.sql
-- Rewrite storage policies using path_tokens[] — Supabase's
-- native generated column (= string_to_array(name, '/')).
--
-- Path layout: {project_id}/{stage_id}/{substage_id}/{timestamp}_{file}
--   path_tokens[1] = project_id
--
-- TO authenticated prevents the policy running for anon role.
-- =========================================================

-- ── Drop all existing policies ────────────────────────────
DROP POLICY IF EXISTS "evidence_upload"            ON storage.objects;
DROP POLICY IF EXISTS "evidence_read"              ON storage.objects;
DROP POLICY IF EXISTS "evidence_delete"            ON storage.objects;
DROP POLICY IF EXISTS "contractor_evidence_upload" ON storage.objects;
DROP POLICY IF EXISTS "contractor_evidence_read"   ON storage.objects;
DROP POLICY IF EXISTS "documents_upload"           ON storage.objects;
DROP POLICY IF EXISTS "documents_read"             ON storage.objects;
DROP POLICY IF EXISTS "documents_delete"           ON storage.objects;

-- ── Evidence: project owner ───────────────────────────────
CREATE POLICY "evidence_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

CREATE POLICY "evidence_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

CREATE POLICY "evidence_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

-- ── Evidence: accepted contractors ───────────────────────
CREATE POLICY "contractor_evidence_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = path_tokens[1]
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

CREATE POLICY "contractor_evidence_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND auth.uid() IN (
      SELECT ci.contractor_user_id
      FROM public.contractor_invites ci
      WHERE ci.project_id::text = path_tokens[1]
        AND ci.status = 'accepted'
        AND ci.contractor_user_id IS NOT NULL
    )
  );

-- ── Documents: project owner ──────────────────────────────
CREATE POLICY "documents_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

CREATE POLICY "documents_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

CREATE POLICY "documents_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND auth.uid() IN (
      SELECT user_id FROM public.projects
      WHERE id::text = path_tokens[1]
    )
  );

-- ── Verify: shows all storage.objects policies ────────────
SELECT policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
