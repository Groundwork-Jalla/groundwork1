-- =========================================================
-- 131  Project members can upload — documents, and a verifier's evidence
--
-- WHY
--
-- Reported from testing: "when I try to upload a document as the contractor, it takes me
-- to an empty page and I don't think anything is uploaded." Both halves were true, and
-- they had different causes.
--
-- The upload half is this migration. A contractor was refused at BOTH layers, so nothing
-- could have worked:
--
--   · `owner_insert_documents` (086) — WITH CHECK (project_id IN (SELECT id FROM projects
--     WHERE user_id = auth.uid())). The project OWNER and nobody else.
--   · `documents_upload` on storage.objects (012) — the same test against path_tokens[1].
--
-- 092 widened only SELECT, so a contractor could read every document on their project and
-- add none. That is backwards: the contractor is the person who HAS the permit, the
-- delivery note and the receipt.
--
-- ── And the same gap for a VERIFIER's evidence ──────────────────────────────────────
-- `contractor_evidence_upload` (012) lets an accepted contractor write to the `evidence`
-- bucket, which is why that half has always worked. There is no equivalent for a
-- verifier, so an engineer photographing what they found on site had nowhere to put it.
-- One member-based policy covers owner, contractor and verifier together; the narrower
-- 012 policies stay and simply stop being the only way in — RLS policies are PERMISSIVE
-- and OR'd, so adding one widens and removes nothing.
--
-- ── Who may add one, and who may still remove one ───────────────────────────────────
-- Adding: any active project member — `project_member()` (086), the same set that can
-- already read them. Removing: unchanged, still the owner. Deletion is destructive and
-- a contractor who leaves a project should not be able to take the record of the build
-- with them.
--
-- ── `uploaded_by` is pinned to the caller ───────────────────────────────────────────
-- The old policy got this free: only the owner could insert, so only the owner's id could
-- be there. Widening the WHO means the WITH CHECK has to say it, or a member could file a
-- document under somebody else's name on a project they both belong to.
--
-- Run in: Supabase Dashboard > SQL Editor (after 130)
-- =========================================================

BEGIN;

-- ── The metadata row ───────────────────────────────────────
DROP POLICY IF EXISTS "owner_insert_documents"  ON public.project_documents;
DROP POLICY IF EXISTS "member_insert_documents" ON public.project_documents;
CREATE POLICY "member_insert_documents"
  ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (
    public.project_member(project_id)
    -- Filed under the person who filed it. Not decoration: `uploaded_by` is who the
    -- document is attributed to, and a member must not be able to name another.
    AND uploaded_by = auth.uid()
  );

COMMENT ON TABLE public.project_documents IS
  'Documents attached to a project. Readable by any project member (086/092) and since '
  '131 uploadable by one too — the contractor holds the permit and the receipts. Deletion '
  'stays with the owner.';

COMMIT;

-- ── The file itself ────────────────────────────────────────
-- Separate from the transaction above and guarded, because `storage.objects` is not
-- always owned by the role running a migration from the SQL editor. 092 established this
-- shape: if it cannot be applied here it says so loudly rather than half-applying.
DO $$
BEGIN
  DROP POLICY IF EXISTS "member_documents_upload" ON storage.objects;
  CREATE POLICY "member_documents_upload"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'documents'
      AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
    );
-- `invalid_schema_name` too, which 092 omits: a database with no `storage` schema at
-- all raises that rather than undefined_table, and an uncaught error here would abort
-- the rest of the file.
EXCEPTION WHEN insufficient_privilege OR undefined_table OR invalid_schema_name THEN
  RAISE NOTICE 'SKIPPED policy member_documents_upload (%) — add it in Storage > Policies', SQLERRM;
END $$;

-- ── A verifier's evidence ──────────────────────────────────
-- 012 covers the accepted contractor and nobody else. A verifier records what they found
-- on site, and a finding with no photograph is an opinion.
DO $$
BEGIN
  DROP POLICY IF EXISTS "member_evidence_upload" ON storage.objects;
  CREATE POLICY "member_evidence_upload"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'evidence'
      AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
    );
EXCEPTION WHEN insufficient_privilege OR undefined_table OR invalid_schema_name THEN
  RAISE NOTICE 'SKIPPED policy member_evidence_upload (%) — add it in Storage > Policies', SQLERRM;
END $$;

-- ── Verify ───────────────────────────────────────────────
--   -- the table: one INSERT policy, naming project_member and uploaded_by
--   SELECT policyname, cmd, with_check FROM pg_policies
--    WHERE tablename = 'project_documents' AND cmd = 'INSERT';
--
--   -- the buckets: upload must no longer be owner-only
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'objects'
--      AND policyname IN ('member_documents_upload', 'member_evidence_upload');
--
--   -- If the DO block printed SKIPPED, add it by hand:
--   --   Storage > documents > Policies > New policy: INSERT, role authenticated,
--   --   WITH CHECK  bucket_id = 'documents'
--   --               AND (public.is_admin() OR public.project_member(public.try_uuid(path_tokens[1])))
