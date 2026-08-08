-- =========================================================
-- 028_fix_contractor_application_rls.sql
--
-- Repair for a partially-applied migration 026.
--
-- Symptom: submitting the contractor form failed with
--   42501: new row violates row-level security policy for table "contractor_applications"
--
-- Cause: the table was created and RLS was enabled, but execution stopped before
-- the policies were created — the Supabase SQL editor halts at the first failing
-- statement, so everything after that point silently never ran. RLS with no
-- INSERT policy denies every write, which is exactly what we saw.
--
-- This file re-runs ONLY the parts after the table definition, and is safe to run
-- repeatedly: every statement is guarded by DROP ... IF EXISTS or ON CONFLICT.
--
-- Run in: Supabase Dashboard > SQL Editor.
-- Run it as ONE statement at a time if anything errors, and tell me which line
-- fails — a mid-file failure is what caused this in the first place.
-- =========================================================

-- ── Table RLS ────────────────────────────────────────────
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
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contractor-docs', 'contractor-docs', false,
  10485760,   -- 10 MB
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760;

DROP POLICY IF EXISTS "contractor_docs_upload" ON storage.objects;
DROP POLICY IF EXISTS "contractor_docs_read"   ON storage.objects;

-- Applicants are anonymous, so uploads cannot be tied to auth.uid(). The bucket
-- is write-only to the public: you may add a file but can never list or read one
-- back, so an uploaded credential is exposed to nobody but an admin.
CREATE POLICY "contractor_docs_upload"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'contractor-docs');

CREATE POLICY "contractor_docs_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contractor-docs' AND public.is_admin());

-- ── Verify (should return 3 policy rows) ─────────────────
-- SELECT policyname, cmd FROM pg_policies
--  WHERE tablename = 'contractor_applications';
