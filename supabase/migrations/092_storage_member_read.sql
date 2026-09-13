-- =========================================================
-- 092  Staff and project members can open a project's files
--
-- Phase 5 of the admin re-architecture, step 1 (docs/groundwork-admin/05-project-workspace.md
-- §11, §14). Depends on 086 (project_member) and on is_admin() (009).
--
-- WHAT WAS MISSING. The `evidence` and `documents` buckets have SELECT policies with an
-- owner arm (011/012) and, for evidence, an accepted-contractor arm (20260714). Nothing
-- else. So today an admin cannot open a client's evidence photo or document — Stages &
-- Reviews renders the bare storage paths as links that do not resolve — and a verifier
-- assigned in 086 can see the stage rows but not the photos they are meant to assess.
-- The table-level reads were widened in 086 (project_member) and 009 (admin); the files
-- were not. This closes that.
--
-- WHAT THIS DOES. Two additive SELECT policies on storage.objects:
--   evidence  : is_admin() OR project_member(project id from path_tokens[1])
--   documents : is_admin() OR project_member(project id from path_tokens[1])
-- SELECT only. INSERT and DELETE are untouched — an admin still cannot upload or delete
-- a client's document from the browser; that is a Phase 7 decision (05 §15.2). Membership
-- grants sight; every write stays behind its RPC (03 §6).
--
-- The existing owner/contractor policies are left in place, not replaced: RLS policies
-- are OR-ed, and a narrower policy that still holds is not a risk.
--
-- path_tokens[1] is the project id on both buckets (documents.ts writes
-- `${projectId}/…`, EvidenceUpload writes `${projectId}/…`, and 088 refuses any other
-- prefix). A stray object whose first segment is not a uuid must not make the policy
-- ERROR for everyone, so the cast goes through try_uuid(), which yields NULL — and
-- project_member(NULL) is false.
--
-- storage.objects belongs to supabase_storage_admin, so each policy is created inside a
-- DO block that reports rather than fails if the editor lacks the privilege (028's
-- pattern); the Dashboard fallback is written at the end.
--
-- Run in: Supabase Dashboard > SQL Editor (after 091)
-- =========================================================

-- ── 1. A cast that cannot throw ──────────────────────────
CREATE OR REPLACE FUNCTION public.try_uuid(p text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  RETURN p::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, anon;

-- ── 2. Evidence: staff and members read ──────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "member_evidence_read" ON storage.objects;
  CREATE POLICY "member_evidence_read"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'evidence'
      AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
    );
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED policy member_evidence_read (%) — add it in Storage > Policies', SQLERRM;
END $$;

-- ── 3. Documents: staff and members read ─────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "member_documents_read" ON storage.objects;
  CREATE POLICY "member_documents_read"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'documents'
      AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
    );
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED policy member_documents_read (%) — add it in Storage > Policies', SQLERRM;
END $$;

COMMENT ON FUNCTION public.try_uuid(text) IS
  'text → uuid, NULL instead of an error on bad input. Used by storage policies that key on path_tokens[1]. See 092.';

-- ── Verify ───────────────────────────────────────────────
-- Expect the two new SELECT policies alongside the existing owner/contractor ones.
SELECT policyname, cmd, roles::text
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname IN ('member_evidence_read', 'member_documents_read',
                      'evidence_read', 'contractor_evidence_read', 'documents_read')
 ORDER BY policyname;

-- If either block reported SKIPPED, add the policy in the Dashboard instead:
--   Storage > evidence  > Policies > New policy: SELECT, role authenticated,
--     USING  bucket_id = 'evidence'  AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
--   Storage > documents > Policies > New policy: SELECT, role authenticated,
--     USING  bucket_id = 'documents' AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))

-- ── Rollback (not run) ────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "member_evidence_read"  ON storage.objects;
-- DROP POLICY IF EXISTS "member_documents_read" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.try_uuid(text);
