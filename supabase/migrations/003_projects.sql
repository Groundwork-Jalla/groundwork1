-- =========================================================
-- 003_projects.sql
-- Core project management tables: projects, stages, substages
-- =========================================================

-- -------------------------------------------------------
-- PROJECTS
-- -------------------------------------------------------
CREATE TABLE public.projects (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- identity
  name                  TEXT          NOT NULL,
  country               TEXT          NOT NULL,   -- ISO 3166-1 alpha-2
  city                  TEXT,

  -- configuration
  project_type          TEXT          NOT NULL
                        CHECK (project_type IN ('residential','commercial','industrial','mixed_use')),
  building_type         TEXT          NOT NULL,
  num_floors            INTEGER       NOT NULL DEFAULT 1 CHECK (num_floors >= 1),
  sqm                   NUMERIC(10,2) NOT NULL CHECK (sqm > 0),
  finish_level          TEXT          NOT NULL DEFAULT 'standard'
                        CHECK (finish_level IN ('standard','premium','luxury')),

  -- optional features
  has_boys_quarters     BOOLEAN       NOT NULL DEFAULT false,
  bq_rooms              INTEGER       NOT NULL DEFAULT 0 CHECK (bq_rooms >= 0),
  roof_type             TEXT          NOT NULL,

  -- rooms
  bedrooms              INTEGER       NOT NULL DEFAULT 0 CHECK (bedrooms >= 0),
  bathrooms             INTEGER       NOT NULL DEFAULT 0 CHECK (bathrooms >= 0),
  living_rooms          INTEGER       NOT NULL DEFAULT 0 CHECK (living_rooms >= 0),
  kitchens              INTEGER       NOT NULL DEFAULT 0 CHECK (kitchens >= 0),

  -- budget
  budget_usd            NUMERIC(14,2),

  -- platform tier & lifecycle
  tier                  TEXT          NOT NULL DEFAULT 'self_verify'
                        CHECK (tier IN ('self_verify','jalla_verify','jalla_management')),
  status                TEXT          NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','on_hold','completed','archived')),
  current_stage         INTEGER       NOT NULL DEFAULT 1,

  -- timeline
  target_start          DATE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- -------------------------------------------------------
-- PROJECT STAGES  (10 per project, seeded on creation by project type)
-- -------------------------------------------------------
CREATE TABLE public.project_stages (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_number          INTEGER       NOT NULL CHECK (stage_number BETWEEN 1 AND 10),
  name                  TEXT          NOT NULL,
  status                TEXT          NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('locked','active','pending_review','complete')),
  budget_pct            INTEGER       NOT NULL DEFAULT 0,  -- % of total project budget
  payment_milestone_usd NUMERIC(14,2),                    -- calculated USD allocation
  payment_status        TEXT          NOT NULL DEFAULT 'unpaid'
                        CHECK (payment_status IN ('unpaid','partial','paid')),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (project_id, stage_number)
);

-- -------------------------------------------------------
-- PROJECT SUBSTAGES  (seeded per stage by project type)
-- -------------------------------------------------------
CREATE TABLE public.project_substages (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id              UUID          NOT NULL REFERENCES public.project_stages(id) ON DELETE CASCADE,
  project_id            UUID          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  substage_number       INTEGER       NOT NULL,
  name                  TEXT          NOT NULL,
  status                TEXT          NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('locked','pending','in_progress','complete')),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- -------------------------------------------------------
-- ROW-LEVEL SECURITY
-- -------------------------------------------------------
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_substages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_projects"
  ON public.projects FOR ALL
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_all_stages"
  ON public.project_stages FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "owner_all_substages"
  ON public.project_substages FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- -------------------------------------------------------
-- UPDATED_AT TRIGGER
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
