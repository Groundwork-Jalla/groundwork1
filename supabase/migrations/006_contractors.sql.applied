-- =========================================================
-- 006_contractors.sql
-- Verified contractor directory (curated by the Jalla team)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractors (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT          NOT NULL,
  trade               TEXT          NOT NULL,
  location            TEXT          NOT NULL,
  rating              NUMERIC(3,1)  NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  review_count        INTEGER       NOT NULL DEFAULT 0,
  verified            BOOLEAN       NOT NULL DEFAULT false,
  years_exp           INTEGER       NOT NULL DEFAULT 0,
  completed_projects  INTEGER       NOT NULL DEFAULT 0,
  specialties         TEXT[]        NOT NULL DEFAULT '{}',
  bio                 TEXT,
  phone               TEXT,
  email               TEXT,
  avatar_initials     TEXT          NOT NULL DEFAULT '',
  active              BOOLEAN       NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active contractor listings
CREATE POLICY "contractors_read"
  ON public.contractors FOR SELECT
  TO authenticated
  USING (active = true);
