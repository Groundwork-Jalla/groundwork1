-- =========================================================
-- 033_contractor_directory.sql
--
-- Two jobs.
--
-- 1. Bring `public.contractors` under migration control. It exists in production but
--    no migration ever created it — it was made by hand — so a database rebuilt from
--    this folder would not have it, and both /admin/contractors and the public
--    directory would silently render empty (they ignore `error`). The CREATE below is
--    IF NOT EXISTS, so it is a no-op on production and the definition of record
--    everywhere else. Column list mirrors the live table exactly.
--
-- 2. Wire acceptance to publication. Accepting an application only ever set
--    contractor_applications.status; nothing wrote to the directory, so an accepted
--    contractor never appeared anywhere. `admin_promote_application()` does that
--    mapping in one place, server-side, and is idempotent.
--
-- Run in: Supabase Dashboard > SQL Editor (after 032)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.contractors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT    NOT NULL,
  trade              TEXT    NOT NULL,
  location           TEXT    NOT NULL,
  rating             NUMERIC NOT NULL DEFAULT 0,
  review_count       INTEGER NOT NULL DEFAULT 0,
  verified           BOOLEAN NOT NULL DEFAULT false,
  years_exp          INTEGER NOT NULL DEFAULT 0,
  completed_projects INTEGER NOT NULL DEFAULT 0,
  specialties        TEXT[]  NOT NULL DEFAULT '{}',
  bio                TEXT,
  phone              TEXT,
  email              TEXT,
  avatar_initials    TEXT    NOT NULL DEFAULT '',
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defaults on the existing production table, so an insert need not supply all sixteen
-- columns. Harmless where they already match.
ALTER TABLE public.contractors
  ALTER COLUMN rating             SET DEFAULT 0,
  ALTER COLUMN review_count       SET DEFAULT 0,
  ALTER COLUMN verified           SET DEFAULT false,
  ALTER COLUMN years_exp          SET DEFAULT 0,
  ALTER COLUMN completed_projects SET DEFAULT 0,
  ALTER COLUMN specialties        SET DEFAULT '{}',
  ALTER COLUMN avatar_initials    SET DEFAULT '',
  ALTER COLUMN active             SET DEFAULT true;

-- The link back to the application a directory entry came from. UNIQUE is what makes
-- promotion idempotent: pressing Accept twice updates the same row instead of adding
-- a duplicate contractor. Nullable because rows that predate this migration, and any
-- entry added by hand, have no application behind them.
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS application_id UUID
    REFERENCES public.contractor_applications(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contractors_application_id_key
  ON public.contractors (application_id) WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contractors_active_idx ON public.contractors (active, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

-- The directory is a public feature: signed-in clients browse it to pick a contractor.
-- Only active entries, and never the ones an admin has taken down.
DROP POLICY IF EXISTS "anyone_reads_active_contractors" ON public.contractors;
CREATE POLICY "anyone_reads_active_contractors"
  ON public.contractors FOR SELECT
  TO anon, authenticated
  USING (active);

-- Admins see everything, including deactivated entries, and are the only writers.
DROP POLICY IF EXISTS "admins_read_all_contractors" ON public.contractors;
CREATE POLICY "admins_read_all_contractors"
  ON public.contractors FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admins_write_contractors" ON public.contractors;
CREATE POLICY "admins_write_contractors"
  ON public.contractors FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Accept -> publish ────────────────────────────────────
-- SECURITY DEFINER so it can read the application (admin-only under 026) and write the
-- directory in one transaction; is_admin() is re-checked inside, so being able to call
-- it is not the same as being allowed to.
CREATE OR REPLACE FUNCTION public.admin_promote_application(p_application_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          public.contractor_applications%ROWTYPE;
  v_id       UUID;
  v_years    INTEGER;
  v_initials TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only an administrator may publish a contractor';
  END IF;

  SELECT * INTO a FROM public.contractor_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no application %', p_application_id;
  END IF;

  -- years_experience is a bucket key from the form, not a number. Take the lower bound
  -- of the bucket — the honest floor, never an overstatement of experience.
  v_years := CASE a.years_experience
               WHEN 'under1' THEN 0
               WHEN 'y1_3'   THEN 1
               WHEN 'y3_5'   THEN 3
               WHEN 'y5_10'  THEN 5
               WHEN 'y10'    THEN 10
               ELSE 0
             END;

  v_initials := upper(
    left(coalesce(split_part(a.full_name, ' ', 1), ''), 1) ||
    left(coalesce(NULLIF(split_part(a.full_name, ' ', 2), ''), ''), 1)
  );

  INSERT INTO public.contractors (
    name, trade, location, verified, years_exp, completed_projects,
    specialties, bio, phone, email, avatar_initials, active, application_id
  ) VALUES (
    a.full_name,
    a.role,                                   -- role key; the UI translates it
    trim(both ', ' FROM concat_ws(', ', NULLIF(a.city,''), NULLIF(a.country,''))),
    true,                                     -- accepted by Jalla == verified
    v_years,
    COALESCE(jsonb_array_length(a.projects), 0),
    COALESCE(a.project_types, '{}'),          -- already TEXT[] on the application
    NULLIF(a.differentiator, ''),
    NULLIF(a.phone, ''),
    NULLIF(a.email, ''),
    v_initials,
    true,
    a.id
  )
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL
  DO UPDATE SET
    name               = EXCLUDED.name,
    trade              = EXCLUDED.trade,
    location           = EXCLUDED.location,
    years_exp          = EXCLUDED.years_exp,
    completed_projects = EXCLUDED.completed_projects,
    specialties        = EXCLUDED.specialties,
    bio                = EXCLUDED.bio,
    phone              = EXCLUDED.phone,
    email              = EXCLUDED.email,
    avatar_initials    = EXCLUDED.avatar_initials,
    active             = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_promote_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_promote_application(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_promote_application(UUID) IS
  'Publish an accepted contractor application into the public directory. Idempotent on '
  'contractors.application_id. Admin-only; re-checks is_admin() internally.';

DO $$
DECLARE v_total int; v_linked int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE application_id IS NOT NULL)
    INTO v_total, v_linked FROM public.contractors;
  RAISE NOTICE 'contractors: % row(s), % linked to an application.', v_total, v_linked;
END $$;
