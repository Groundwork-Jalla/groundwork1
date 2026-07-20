-- Recalculate budget_usd for all existing projects using the calibrated
-- construction rates seeded in migration 015.
--
-- Run AFTER 015_construction_rates.sql is applied.
--
-- Two steps:
--   1. Update projects.budget_usd from the new formula.
--   2. Update project_stages.payment_milestone_usd to match the new total.
--
-- Projects with no matching construction_rate row (unknown country) or
-- sqm = 0 are skipped and their values are left unchanged.
-- Safe to run more than once.

-- ── Step 1: Recalculate projects.budget_usd ───────────────

UPDATE public.projects p
SET
  budget_usd = ROUND(
    p.sqm::NUMERIC
    * cr.base_rate_usd
    * COALESCE((cr.finish_multipliers  ->> p.finish_level)::NUMERIC,        1.0)
    * COALESCE((cr.building_type_multipliers ->> p.building_type::TEXT)::NUMERIC, 1.0)
    * COALESCE((cr.roof_type_multipliers     ->> p.roof_type::TEXT)::NUMERIC,     1.0)
    * (1 + GREATEST(0, p.num_floors - 1) * (cr.upper_floor_addition_pct / 100.0))
    + CASE WHEN p.has_boys_quarters AND p.bq_rooms > 0
        THEN p.bq_rooms * 8000
        ELSE 0
      END
  )
FROM public.construction_rates cr
WHERE cr.country_code = p.country
  AND p.sqm IS NOT NULL
  AND p.sqm > 0;

-- ── Step 2: Recalculate project_stages.payment_milestone_usd ─

UPDATE public.project_stages ps
SET payment_milestone_usd = ROUND(p.budget_usd * ps.budget_pct / 100.0)
FROM public.projects p
WHERE ps.project_id   = p.id
  AND p.budget_usd    IS NOT NULL
  AND ps.budget_pct   IS NOT NULL;
