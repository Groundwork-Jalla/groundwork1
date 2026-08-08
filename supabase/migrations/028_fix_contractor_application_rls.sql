-- =========================================================
-- 028_fix_contractor_application_rls.sql
--
-- Symptom: submitting the contractor form fails with
--   42501: new row violates row-level security policy for table "contractor_applications"
--
-- Cause: the SQL editor runs a script as ONE transaction. Migration 026 created the
-- table, enabled RLS, created the policies — and then hit the storage section, where
-- `CREATE POLICY ... ON storage.objects` fails with "must be owner of table objects":
-- storage.objects is owned by supabase_storage_admin, not by the postgres role the
-- editor runs as. That error aborted the transaction and rolled back the policies
-- along with it, leaving RLS enabled with no INSERT policy — which denies every write.
--
-- The fix is structural, not a retry: each storage statement now runs inside its own
-- DO block with an exception handler. A DO block is a subtransaction, so a privilege
-- error is caught and reported as a NOTICE instead of aborting the outer transaction.
-- The table policies above it therefore always commit, whatever storage does.
--
-- Safe to run repeatedly. Run in: Supabase Dashboard > SQL Editor.
-- =========================================================

-- ── Table RLS ────────────────────────────────────────────
-- These are the statements that actually unblock the form. Nothing below them can
-- roll them back any more.

ALTER TABLE public.contractor_applications ENABLE ROW LEVEL SECURITY;

-- Anyone may apply. The form is public and applicants have no account.
DROP POLICY IF EXISTS "anyone_can_apply" ON public.contractor_applications;
CREATE POLICY "anyone_can_apply"
  ON public.contractor_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Applications hold phone numbers, client references and credentials.
-- Admin-only read; never the applicant, never another visitor.
DROP POLICY IF EXISTS "admins_read_applications" ON public.contractor_applications;
CREATE POLICY "admins_read_applications"
  ON public.contractor_applications FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admins_update_applications" ON public.contractor_applications;
CREATE POLICY "admins_update_applications"
  ON public.contractor_applications FOR UPDATE
  TO authenticated
  USING (public.is_admin());

-- ── Storage bucket for credentials ───────────────────────
-- Private: business registrations, tax certificates, bar licences.
-- Each block is isolated. If the role lacks storage privileges the block raises a
-- NOTICE and execution continues — see the fallback instructions at the bottom.

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'contractor-docs', 'contractor-docs', false,
    10485760,   -- 10 MB
    ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic']
  )
  ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760;
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED bucket contractor-docs (%) — create it in Storage > New bucket', SQLERRM;
END $$;

-- Applicants are anonymous, so uploads cannot be tied to auth.uid(). The bucket is
-- write-only to the public: you may add a file but can never list or read one back,
-- so an uploaded credential is exposed to nobody but an admin.
DO $$
BEGIN
  DROP POLICY IF EXISTS "contractor_docs_upload" ON storage.objects;
  CREATE POLICY "contractor_docs_upload"
    ON storage.objects FOR INSERT
    TO anon, authenticated
    WITH CHECK (bucket_id = 'contractor-docs');
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED policy contractor_docs_upload (%) — add it in Storage > Policies', SQLERRM;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "contractor_docs_read" ON storage.objects;
  CREATE POLICY "contractor_docs_read"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'contractor-docs' AND public.is_admin());
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED policy contractor_docs_read (%) — add it in Storage > Policies', SQLERRM;
END $$;

-- ── Verify ───────────────────────────────────────────────
-- Must return exactly 3 rows: anyone_can_apply (INSERT),
-- admins_read_applications (SELECT), admins_update_applications (UPDATE).
SELECT policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename  = 'contractor_applications'
 ORDER BY policyname;

-- If either storage block reported SKIPPED, do that part in the Dashboard UI instead
-- (it runs as the storage owner role, which the SQL editor is not):
--   1. Storage > New bucket > name `contractor-docs`, Public = OFF, limit 10 MB.
--   2. Storage > contractor-docs > Policies > New policy:
--        INSERT, target roles anon + authenticated, WITH CHECK  bucket_id = 'contractor-docs'
--        SELECT, target role authenticated,        USING  bucket_id = 'contractor-docs' AND public.is_admin()
