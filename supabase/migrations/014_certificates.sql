-- =========================================================
-- 014_certificates.sql
-- Stage completion certificates issued on admin approval.
-- Anyone can read (for public /verify/:id page).
-- Only authenticated users may insert (via service calls).
-- =========================================================

CREATE TABLE IF NOT EXISTS public.certificates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  stage_id     UUID NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  stage_number INT  NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_to    TEXT NOT NULL,        -- homeowner full name
  project_name TEXT NOT NULL,
  stage_name   TEXT NOT NULL,
  storage_path TEXT NOT NULL,        -- path inside 'certificates' bucket
  pdf_url      TEXT,                 -- public URL (set after upload)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

-- Public read so /verify/:id works without auth
CREATE POLICY "public_read_certificates"
  ON public.certificates
  FOR SELECT
  USING (true);

-- Authenticated users may insert (admin page calls this)
CREATE POLICY "authenticated_insert_certificates"
  ON public.certificates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
