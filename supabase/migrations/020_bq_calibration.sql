-- 020_bq_calibration.sql
--
-- ⚠️  SUPERSEDED — DO NOT RUN. Kept for the reasoning below, which is still the record of
--     why the engine is calibrated the way it is.
--
--     This file NEVER RAN anywhere. It carried a plpgsql syntax error from the day it was
--     written: line 182 separated two DECLARE variables with a comma where a semicolon is
--     required, so `DO $$ ... $$` failed with 42601 every time. Discovered 16 Aug 2026.
--     The comma is fixed below so the file is at least correct, but nothing should execute
--     it now — its work is split across two migrations that supersede it:
--
--       037_city_rate_corrections.sql — creates and seeds construction_city_rates, with
--                                       Bali renamed and Adamawa's index corrected
--       040_cm_takeoff_model.sql      — the Cameroon take-off model and finish multipliers
--
--     Deliberately NOT carried forward: this file's `UPDATE construction_rates SET
--     base_rate_usd = 1600 WHERE country_code = 'NG'`. That is a 2.4x jump from the 672
--     migration 015 seeded, against a figure countries.ts derives as 180, with no Nigerian
--     bill of quantities behind any of the three. See question in docs/BQ-QUESTIONS.md.
--
-- Recalibrates the budget engine against four real Cameroonian bills of quantities
-- instead of one, and adds the city dimension those documents make possible.
--
-- Source documents (docs/*.xlsx):
--   1. CONSTRUCTION ESTIMATE OF G+1 BUILDING  — Mme. Rose Ndum Kenah, Yaoundé   59,675,280 XAF
--   2. BUEA RESIDENCE ESTIMATE                — Woyamukumbat, Buea             43,410,955 XAF
--   3. NI PAS CONSTRUCTION ESTIMATE G+1 SCHOOL— Naka                           42,213,867 XAF
--   4. MPANGOU                                — Mpangou, Kribi (G+3)           64,268,593 XAF
--
-- Why this migration exists
-- ------------------------
-- base_rate_usd = 640 for CM was fitted to document 1 alone. Tested against the other
-- three it reproduces document 1 to 0.02% and overshoots the rest by +146%, +63% and
-- +49% — a textbook single-point overfit. The replacement engine derives quantities
-- from geometry and room composition and prices them from the city rate book below.
--
-- What this migration does NOT do
-- -------------------------------
-- It deliberately does not backfill projects.budget_usd. Existing projects keep the
-- figures their owners were quoted and their milestone payments were derived from.
-- Recalculating those silently would move money users have already agreed.


-- ── 1. City rate book ──────────────────────────────────────
-- Verbatim from the 'unit cost calculation' sheet, which appears identically in three
-- of the four workbooks. It builds 1 m³ of concrete from cement, sand, gravel, steel,
-- binding wire, formwork, poles, labour, water, inspection and equipment, then adds
-- 25% overhead and profit.
--
-- Cross-check that makes this trustworthy: each BQ's own concrete rate matches its own
-- city's column — Rose 180,000 = Yaoundé, Buea 190,000 = Buea, Mpangou 179,000 = Kribi,
-- Naka 190,000 = Bali.

CREATE TABLE IF NOT EXISTS public.construction_city_rates (
  city_code         TEXT           PRIMARY KEY,
  country_code      CHAR(2)        NOT NULL,
  city_name         TEXT           NOT NULL,
  rc_350            NUMERIC(12,2)  NOT NULL,   -- reinforced concrete 350 kg/m³, all-in
  rc_250            NUMERIC(12,2)  NOT NULL,   -- concrete 250 kg/m³, all-in
  lean_concrete     NUMERIC(12,2)  NOT NULL,
  mortar            NUMERIC(12,2)  NOT NULL,
  index_vs_baseline NUMERIC(6,4)   NOT NULL,   -- rc_350 relative to Douala
  currency_code     CHAR(3)        NOT NULL,
  data_source       TEXT           NOT NULL DEFAULT 'real_bq'
                      CHECK (data_source IN ('real_bq', 'estimated_index')),
  notes             TEXT,
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS construction_city_rates_country_idx
  ON public.construction_city_rates (country_code);

ALTER TABLE public.construction_city_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON public.construction_city_rates;
CREATE POLICY "public_read" ON public.construction_city_rates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_write" ON public.construction_city_rates;
CREATE POLICY "service_write" ON public.construction_city_rates
  FOR ALL USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS construction_city_rates_updated_at ON public.construction_city_rates;
CREATE TRIGGER construction_city_rates_updated_at
  BEFORE UPDATE ON public.construction_city_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.construction_city_rates
  (city_code, country_code, city_name, rc_350, rc_250, lean_concrete, mortar,
   index_vs_baseline, currency_code, data_source, notes)
VALUES
  ('DOUALA',  'CM', 'Douala',   180000,  70750, 52000,  67250, 1.0000, 'XAF', 'real_bq',
   'Baseline. Direct cost 139,100 + 25% O&P.'),
  ('YAOUNDE', 'CM', 'Yaoundé',  180000,  67250, 48500,  69750, 1.0000, 'XAF', 'real_bq',
   'Source city for the Rose Ndum Kenah BQ.'),
  ('KRIBI',   'CM', 'Kribi',    179000,  72625, 54250,  66875, 0.9944, 'XAF', 'real_bq',
   'Source city for the Mpangou BQ. Cheapest in the book — coastal aggregate.'),
  ('BUEA',    'CM', 'Buea',     190000,  72875, 52250,  72625, 1.0556, 'XAF', 'real_bq',
   'Source city for the Buea Residence BQ.'),
  ('LIMBE',   'CM', 'Limbe',    190000,  71250, 51000,  70750, 1.0556, 'XAF', 'real_bq', NULL),
  ('BALI',    'CM', 'Bali',     190000,  71000, 48500,  72875, 1.0556, 'XAF', 'real_bq',
   'Source city for the Naka school BQ.'),
  ('ADAMAWA', 'CM', 'Adamawa',  260000,  86125, 61750,  88375, 1.4444, 'XAF', 'real_bq',
   'Most expensive in Cameroon — inland haulage on cement (45,500) and steel (102,000).'),
  ('ABUJA',   'NG', 'Abuja',    450000, 119000, 77750, 135750, 2.5000, 'NGN', 'real_bq',
   'The only non-Cameroon column. 2.50x Douala — steel 170,000 vs 55,250.')
ON CONFLICT (city_code) DO UPDATE SET
  country_code      = EXCLUDED.country_code,
  city_name         = EXCLUDED.city_name,
  rc_350            = EXCLUDED.rc_350,
  rc_250            = EXCLUDED.rc_250,
  lean_concrete     = EXCLUDED.lean_concrete,
  mortar            = EXCLUDED.mortar,
  index_vs_baseline = EXCLUDED.index_vs_baseline,
  currency_code     = EXCLUDED.currency_code,
  data_source       = EXCLUDED.data_source,
  notes             = EXCLUDED.notes,
  updated_at        = now();


-- ── 2. Take-off model on construction_rates ────────────────
-- Both columns are nullable. A NULL takeoff means "no quantity model for this country",
-- and the engine falls back to the existing multiplicative formula. That keeps every
-- country except CM behaving exactly as it does today.

ALTER TABLE public.construction_rates
  ADD COLUMN IF NOT EXISTS takeoff        JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fixture_prices JSONB DEFAULT NULL;

COMMENT ON COLUMN public.construction_rates.takeoff IS
  'Quantity take-off coefficients and unit rates. NULL = use the legacy formula.';
COMMENT ON COLUMN public.construction_rates.fixture_prices IS
  'Count-driven fixture prices (plumbing, electrical, joinery). NULL = use engine defaults.';


-- ── 3. Cameroon take-off model ─────────────────────────────
-- Unit rates are QUOTED PRICES lifted from the BQs, not fitted values. Geometry
-- coefficients are set from engineering practice, except two that are measured
-- directly from the two internally consistent documents (Rose and Naka):
--
--   footing_m3_per_m2  Rose 0.105, Naka 0.143  -> 0.115
--   paint_m2           Rose 2,767, Naka 2,813  -> 2,790  (agree to 1.7%)
--
-- Repeated attempts to tune the full coefficient set against all four documents
-- saturated at their bounds and produced an inverted rate card (luxury finishes
-- cheaper than premium). Two of the four documents omit internal partitions and one
-- under-provisions its foundation; fitting to them would bake those defects in.

DO $$
DECLARE
  v_takeoff JSONB := jsonb_build_object(
    'version', '2026.08-cm-4bq',
    'geometry', jsonb_build_object(
      'storey_height_m',        3.0,
      'slab_thickness_m',       0.12,   -- slab m³ ÷ 0.12 recovers the footprint in all four BQs
      'ground_slab_thickness_m',0.07,
      'partition_m_per_room',   14.0,   -- Rose measured 15.5 m/room, Naka 18
      'perimeter_factor',       4.0,    -- square-ish plan; Mpangou states L12 W12 perimeter 48
      'exc_m3_per_m2',          0.55,
      'lean_m3_per_m2',         0.011,
      'footing_m3_per_m2',      0.115,
      'footing_floor_uplift',   0.18,   -- taller buildings need bigger pads
      'col_m3_per_m2',          0.024,
      'beam_m3_per_m2',         0.045,
      'stair_m3',               2.5,
      'flat_roof_sheet_frac',   0.30,
      'pitched_roof_factor',    1.30,   -- 30° pitch + 600 mm overhang
      'railing_ml_per_floor',   12.0,
      'contingency_pct',        0.05
    ),
    'rates', jsonb_build_object(
      'excavation_m3',    1500,
      'backfill_m3',       800,
      'dpm_m2',           1000,
      'sand_bed_m2',      1000,
      'fdn_block_m2',     4000,
      'blockwork_m2',     7800,    -- BQ 305, Rose (the only file measuring wall in m²)
      'plaster_m2',       2600,    -- BQ 306, Rose 2,500 ground / 2,700 first
      'deck_plaster_m2',  3000,    -- BQ 307
      'floor_tiles_m2',  10900,    -- BQ 309, identical in all four files
      'wall_tiles_m2',    9000,    -- BQ 310
      'ceiling_m2',      13000,    -- BQ 311 staffing, 14,000 ground / 12,500 first
      'paint_m2',         2790,    -- BQ 901-906, measured
      'roof_sheet_m2',    7500,    -- BQ 503, identical in all four files
      'roof_timber_m2',   6500,
      'roof_accessories', 250000,  -- BQ 504, identical in all four files
      'parapet_ml',       4500,
      'door_avg',       110000,    -- BQ 601-604: 75k / 100k / 220k / 85k
      'window',          55000,    -- BQ 605
      'railing_ml',      24700     -- BQ 606-607, identical in all four files
    ),
    'electrical', jsonb_build_object(
      -- Rose, Buea and Naka are byte-identical at 2,326,600 despite having 12, 9 and 9
      -- rooms, so electrical tracks floors here, not rooms. Mpangou (4 floors) is
      -- 5,677,600. The per-room term is small and deliberate, so a 10-bedroom house
      -- still prices above a 2-bedroom one.
      'per_floor', 700000,
      'per_room',   90000
    )
  );  -- ← was `),`. A DECLARE section separates variables with semicolons, not commas.
  -- BQ 801-810. Reproduces the plumbing total of all four documents exactly.
  v_fixtures JSONB := jsonb_build_object(
    'supply', 250000, 'drainage', 300000, 'septic', 1000000, 'accessories', 300000,
    'wc', 120000, 'mirror', 120000, 'sink', 15000,
    'tub', 1500000, 'shower', 25000, 'kitchen_sink', 200000
  );
BEGIN

UPDATE public.construction_rates SET
  takeoff        = v_takeoff,
  fixture_prices = v_fixtures,
  -- 24.3 came from Rose alone. Across all four the upper-floor uplift is
  -- 20.6% / 22.1% / 24.3% / 25.4%, mean ≈ 23%. Only used by the legacy fallback now.
  upper_floor_addition_pct = 23.0,
  -- Refitted from the documents rather than guessed: Buea and Naka anchor standard,
  -- Rose anchors premium. Monotone by construction.
  finish_multipliers = '{"standard":1.00,"premium":1.45,"luxury":1.70}'::JSONB,
  data_source = 'real_bq',
  notes = 'Quantity take-off calibrated on 4 real BQs — Rose Ndum Kenah (Yaoundé), '
          'Buea Residence, Naka school, Mpangou (Kribi). Aug 2026.'
WHERE country_code = 'CM';

-- Nigeria was indexed at CM x1.05. The price book puts Abuja at 2.50x Douala, i.e. the
-- index had the direction wrong. Rebased on the Abuja column; still estimated_index
-- because we have no Nigerian BQ, only Nigerian unit rates.
UPDATE public.construction_rates SET
  base_rate_usd = 1600.00,
  data_source   = 'estimated_index',
  notes         = 'Rebased on the Abuja column of the Cameroon price book (2.50x Douala). '
                  'Was CM x1.05, which had the direction wrong. Needs a Nigerian BQ.'
WHERE country_code = 'NG';

END $$;
