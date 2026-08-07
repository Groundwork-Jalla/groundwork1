-- =========================================================
-- 026_contractor_applications.sql
--
-- Native contractor application form (replaces the embedded GHL iframe).
--
-- Supabase is the SOURCE OF TRUTH for the full application: all nine sections,
-- the repeatable project history, and the uploaded credentials. GoHighLevel gets
-- a lead-shaped summary forwarded from api/ghl/contractor.ts and is the CRM /
-- notification layer — not the document store. That split is deliberate: GHL
-- custom fields are flat, and 3+ project histories (8 fields each) plus file
-- attachments do not belong in them.
--
-- Applicants are ANONYMOUS — this form is public, no auth. So `anon` may INSERT
-- but never SELECT; reading applications is admin-only.
--
-- Run in: Supabase Dashboard > SQL Editor (after migration 025)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractor_applications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Section 1: basic information ──────────────────────
  full_name     TEXT NOT NULL,
  business_name TEXT,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL,
  country       TEXT NOT NULL,
  city          TEXT NOT NULL,
  portfolio_url TEXT,

  -- ── Section 2: professional category (dynamic trigger) ─
  role          TEXT NOT NULL,
  role_other    TEXT,

  -- ── Section 3: experience & operations ────────────────
  years_experience TEXT NOT NULL,
  operates_as      TEXT NOT NULL,
  team_size        TEXT,
  project_types    TEXT[] NOT NULL DEFAULT '{}',

  -- ── Section 4: credentials (shape varies by role) ─────
  -- Role-specific answers + uploaded file paths live here rather than in dozens
  -- of mostly-NULL columns. Storage paths, not public URLs — the bucket is
  -- private and links are signed on demand from the admin panel.
  credentials  JSONB NOT NULL DEFAULT '{}',
  uploads      JSONB NOT NULL DEFAULT '[]',

  -- ── Section 5: project history + client references ────
  -- An array of at least three {project, reference} objects. Repeatable and
  -- variable-length: a JSONB array, not 24 flat columns.
  projects     JSONB NOT NULL DEFAULT '[]',

  -- ── Section 6: professional standards ─────────────────
  -- All three must be true to qualify. A "no" on any of them is recorded rather
  -- than discarded: knowing who screened themselves out is useful, and silently
  -- dropping a submission loses data we cannot recover.
  accepts_milestones   BOOLEAN NOT NULL,
  accepts_verification BOOLEAN NOT NULL,
  accepts_no_side_pay  BOOLEAN NOT NULL,

  -- ── Section 7: future alignment ───────────────────────
  video_url        TEXT,
  why_join         TEXT NOT NULL,
  differentiator   TEXT NOT NULL,
  ready_for_early  BOOLEAN NOT NULL,

  -- ── Section 8: regional capacity ──────────────────────
  regions          TEXT NOT NULL,
  concurrent_projects TEXT NOT NULL,

  -- ── Section 9: final agreement ────────────────────────
  agreed_to_terms  BOOLEAN NOT NULL,

  -- ── Review workflow ───────────────────────────────────
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','disqualified','reviewing','accepted','rejected')),

  -- Language the form was submitted in, so follow-up email is written to match.
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','fr')),

  -- Mirrors the waitlist pattern (migration 023): a fire-and-forget CRM forward is
  -- invisible when it fails, so record delivery and leave a trail to backfill from.
  synced_to_ghl    BOOLEAN NOT NULL DEFAULT false,
  synced_to_ghl_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.contractor_applications IS
  'Founding-network applications. Source of truth; GHL holds a lead summary only.';
COMMENT ON COLUMN public.contractor_applications.uploads IS
  'Array of {label, path, size} — storage paths in the contractor-docs bucket, not URLs.';
COMMENT ON COLUMN public.contractor_applications.status IS
  '"disqualified" is set automatically when any Section 6 answer is "no".';

CREATE INDEX IF NOT EXISTS contractor_applications_status_idx
  ON public.contractor_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS contractor_applications_email_idx
  ON public.contractor_applications (email);
CREATE INDEX IF NOT EXISTS contractor_applications_unsynced_idx
  ON public.contractor_applications (created_at)
  WHERE NOT synced_to_ghl;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE public.contractor_applications ENABLE ROW LEVEL SECURITY;

-- Anyone may apply. The form is public and applicants have no account.
DROP POLICY IF EXISTS "anyone_can_apply" ON public.contractor_applications;
CREATE POLICY "anyone_can_apply"
  ON public.contractor_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Applications contain phone numbers, client references, and credentials.
-- Only admins may read them — never the applicant, never another visitor.
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
-- Private: these are business registrations, tax certificates and bar licences.
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
-- is write-only to the public: you may add a file, but you can never list or read
-- one back — so an uploaded credential is not exposed to anyone but an admin.
CREATE POLICY "contractor_docs_upload"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'contractor-docs');

CREATE POLICY "contractor_docs_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contractor-docs' AND public.is_admin());
