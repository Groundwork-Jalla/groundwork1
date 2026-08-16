-- =========================================================
-- 040_cm_takeoff_model.sql
--
-- Put the Cameroon quantity take-off model into the database.
--
-- This was migration 020's job. That file never ran — it carried a plpgsql syntax error
-- from the day it was written (a comma where a semicolon belongs, between two DECLARE
-- variables), so every attempt failed with 42601. Found on 16 Aug 2026 when 037 failed
-- with 42P01 on a table 020 was supposed to have created.
--
-- ── What was actually broken, and what was not ───────────
--
-- Almost nothing. `runTakeoff` falls back to the bundled CM_TAKEOFF when a rate row has no
-- `takeoff`, and `getCityRate` falls back to the bundled CITY_RATES — which is exactly
-- what those fallbacks are for. Cameroon has been priced by the take-off model all along,
-- from src/lib/budget/model.ts.
--
-- ONE thing was wrong. `finish_multipliers` IS read from the database row, and 015 seeded
-- Cameroon with premium = 1.35. 020 was meant to raise it to 1.45 on the evidence of the
-- four documents. So every Cameroonian premium-finish project has been priced about 7.4%
-- under since 015. Luxury (1.70) and standard (1.00) were already right.
--
-- ── What this migration deliberately does NOT do ─────────
--
-- 020 also set Nigeria's base_rate_usd to 1600. That is not carried forward: it is a 2.4x
-- jump from the 672 that 015 seeded, against a figure countries.ts derives as 180, and
-- there is no Nigerian bill of quantities behind any of the three. Settling that is a
-- question for Vanessa (docs/BQ-QUESTIONS.md), not a side effect of fixing Cameroon.
--
-- Existing budgets are NOT recalculated. `payment_milestone_usd` derives from
-- `budget_usd`, so re-pricing a confirmed project would silently move money already
-- agreed — the rule migration 020 itself set out and 036 follows. New estimates pick up
-- the corrected multiplier immediately.
--
-- Values mirror src/lib/budget/model.ts (CM_TAKEOFF, DEFAULT_FIXTURE_PRICES,
-- CM_RATE_FALLBACK). Those two must move together or a project prices differently
-- depending on whether the database was reachable.
--
-- Written as plain UPDATEs rather than a DO block: 020's only defect was in its plpgsql
-- envelope, and there is nothing here that needs one.
--
-- Run in: Supabase Dashboard > SQL Editor (after 039)
-- =========================================================

-- ── 1. The columns 020 never added ───────────────────────
-- Both nullable. NULL takeoff means "no quantity model for this country", and the engine
-- falls back to the multiplicative formula — which keeps every country except CM behaving
-- exactly as it does today.
ALTER TABLE public.construction_rates
  ADD COLUMN IF NOT EXISTS takeoff        JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fixture_prices JSONB DEFAULT NULL;

COMMENT ON COLUMN public.construction_rates.takeoff IS
  'Quantity take-off coefficients and unit rates. NULL = use the legacy formula.';
COMMENT ON COLUMN public.construction_rates.fixture_prices IS
  'Count-driven fixture prices (plumbing, sanitary). NULL = use engine defaults.';

-- ── 2. Cameroon ──────────────────────────────────────────
-- Unit rates are QUOTED PRICES lifted from the four BQs, not values fitted to make the
-- totals line up. Geometry coefficients come from engineering practice, except
-- footing_m3_per_m2 and paint_m2, which are measured from the two internally consistent
-- documents (Rose 0.105 / Naka 0.143 -> 0.115; Rose 2,767 / Naka 2,813 -> 2,790).
UPDATE public.construction_rates SET
  takeoff = jsonb_build_object(
    'version', '2026.08-cm-4bq',
    'geometry', jsonb_build_object(
      'storey_height_m',         3.0,
      'slab_thickness_m',        0.12,   -- slab m³ ÷ 0.12 recovers the footprint in all four
      'ground_slab_thickness_m', 0.07,
      'partition_m_per_room',    14.0,   -- Rose measured 15.5 m/room, Naka 18
      'perimeter_factor',        4.0,    -- square-ish plan; Mpangou states L12 W12 perim 48
      'exc_m3_per_m2',           0.55,
      'lean_m3_per_m2',          0.011,
      'footing_m3_per_m2',       0.115,
      'footing_floor_uplift',    0.18,
      'col_m3_per_m2',           0.024,
      'beam_m3_per_m2',          0.045,
      'stair_m3',                2.5,
      'flat_roof_sheet_frac',    0.30,
      'pitched_roof_factor',     1.30,   -- 30° pitch + 600 mm overhang
      'railing_ml_per_floor',    12.0,
      'contingency_pct',         0.05
    ),
    'rates', jsonb_build_object(
      'excavation_m3',      1500,
      'backfill_m3',         800,
      'dpm_m2',             1000,
      'sand_bed_m2',        1000,
      'fdn_block_m2',       4000,
      'blockwork_m2',       7800,    -- BQ 305, Rose — the only file measuring wall in m²
      'plaster_m2',         2600,    -- BQ 306
      'deck_plaster_m2',    3000,    -- BQ 307
      'floor_tiles_m2',    10900,    -- BQ 309, identical in all four files
      'wall_tiles_m2',      9000,    -- BQ 310
      'ceiling_m2',        13000,    -- BQ 311
      'paint_m2',           2790,    -- BQ 901-906, measured
      'roof_sheet_m2',      7500,    -- BQ 503, identical in all four files
      'roof_timber_m2',     6500,
      'roof_accessories', 250000,    -- BQ 504, identical in all four files
      'parapet_ml',         4500,
      'door_avg',         110000,    -- BQ 601-604: 75k / 100k / 220k / 85k
      'window',            55000,    -- BQ 605
      'railing_ml',        24700     -- BQ 606-607, identical in all four files
    ),
    -- Rose, Buea and Naka are byte-identical at 2,326,600 despite having 12, 9 and 9
    -- rooms, so in this data electrical tracks floors, not rooms. Whether that is a quoted
    -- package is Q9 in docs/BQ-QUESTIONS.md. The per-room term is small and deliberate, so
    -- a 10-bedroom house still prices above a 2-bedroom one.
    'electrical', jsonb_build_object('per_floor', 700000, 'per_room', 90000)
  ),
  -- BQ 801-810. Reproduces the plumbing total of three of the four documents exactly;
  -- Mpangou diverges on mirrors, which is Q10 in docs/BQ-QUESTIONS.md.
  fixture_prices = jsonb_build_object(
    'supply', 250000, 'drainage', 300000, 'septic', 1000000, 'accessories', 300000,
    'wc', 120000, 'mirror', 120000, 'sink', 15000,
    'tub', 1500000, 'shower', 25000, 'kitchen_sink', 200000
  ),
  -- 24.3 came from Rose alone. Across all four the uplift is 20.6 / 22.1 / 24.3 / 25.4,
  -- mean ≈ 23. Only the legacy fallback uses it now.
  upper_floor_addition_pct = 23.0,
  -- THE ONE LIVE CORRECTION. Was premium 1.35 from 015; the documents put it at 1.45.
  -- Buea and Naka anchor standard, Rose anchors premium. Monotone by construction.
  finish_multipliers = '{"standard":1.00,"premium":1.45,"luxury":1.70}'::JSONB,
  data_source = 'real_bq',
  notes = 'Quantity take-off calibrated on 4 real BQs — Rose Ndum Kenah (Yaoundé), Buea '
          'Residence, Naka school, Mpangou (Kribi). Aug 2026. Applied by migration 040; '
          'migration 020 intended this but never ran.'
WHERE country_code = 'CM';

-- ── 3. The new flat roof option ──────────────────────────
-- `aluminium_deck` was added to the roof taxonomy in Aug 2026. An absent key already
-- resolves to 1.0 in the engine, so this changes no price — it just stops the stored map
-- disagreeing with src/lib/budget/roof.ts, which is how the three-way multiplier
-- disagreement that migration started.
UPDATE public.construction_rates SET
  roof_type_multipliers = roof_type_multipliers || '{"aluminium_deck":1.0}'::JSONB
WHERE roof_type_multipliers IS NOT NULL
  AND NOT (roof_type_multipliers ? 'aluminium_deck');
