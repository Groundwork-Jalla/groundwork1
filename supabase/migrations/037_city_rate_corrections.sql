-- =========================================================
-- 037_city_rate_corrections.sql
--
-- Two corrections to the Cameroon city rate book, from Vanessa Gwanvoma's review of
-- 7 Aug 2026. Mirrors src/lib/budget/model.ts, which is the offline fallback for the
-- same data — the two must move together or a project prices differently depending on
-- whether the DB was reachable.
--
--   1. BALI → BAMENDA. Vanessa's point was that the city offered in the wizard should be
--      Bamenda; the rates themselves are not in dispute, so the whole row carries over
--      unchanged, index included. Bali is ~20 km from Bamenda and the BQ behind these
--      numbers (Naka school) was priced there.
--
--   2. Adamawa index 1.4444 → 1.0750. The +44% came from reading the region's absolute
--      concrete rates as an index. Vanessa puts Adamawa at +7–8% over the Douala
--      baseline; 1.075 is the mid-point. The rc_350/rc_250/lean/mortar figures are
--      correct and unchanged — only the multiplier applied to every OTHER trade was wrong.
--
-- On the rename: `projects.city` is free text, so rows created before today still say
-- 'Bali'. They are deliberately NOT rewritten — see the note at the bottom.
--
-- NOTE: 020_bq_calibration.sql turned out never to have run here (42P01 on 16 Aug), so
-- this migration creates and seeds the city rate book itself rather than patching two
-- rows of it. 020 must still never be edited; it just is not a prerequisite.
--
-- Run in: Supabase Dashboard > SQL Editor (after 036)
-- =========================================================

-- ── 0. The table itself ──────────────────────────────────
--
-- Migration 020 creates and seeds this. It was NEVER RUN on the production database —
-- discovered on 16 Aug when this migration failed with 42P01. Nothing was mispriced by
-- that: `getCityRate` falls back to the bundled CITY_RATES and `runTakeoff` falls back to
-- CM_TAKEOFF for Cameroon, which is exactly what those fallbacks are for.
--
-- So this migration seeds the book itself rather than depending on 020. Running 020 now
-- would also set Nigeria's base_rate_usd to 1600 — a 2.4x jump from the 672 that 015
-- seeded, against a figure countries.ts derives as 180, with no Nigerian BQ behind any of
-- the three. That is a decision to make deliberately, not a side effect of fixing two
-- Cameroonian city rows.
--
-- Values are the corrected book: verbatim from the 'unit cost calculation' sheet shared by
-- three of the four workbooks, with BALI renamed and ADAMAWA's index fixed. Mirrors
-- src/lib/budget/model.ts.

CREATE TABLE IF NOT EXISTS public.construction_city_rates (
  city_code         TEXT           PRIMARY KEY,
  country_code      CHAR(2)        NOT NULL,
  city_name         TEXT           NOT NULL,
  rc_350            NUMERIC(12,2)  NOT NULL,
  rc_250            NUMERIC(12,2)  NOT NULL,
  lean_concrete     NUMERIC(12,2)  NOT NULL,
  mortar            NUMERIC(12,2)  NOT NULL,
  index_vs_baseline NUMERIC(8,4)   NOT NULL,
  currency_code     TEXT           NOT NULL,
  data_source       TEXT           NOT NULL DEFAULT 'real_bq',
  notes             TEXT,
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS construction_city_rates_country_idx
  ON public.construction_city_rates (country_code);

ALTER TABLE public.construction_city_rates ENABLE ROW LEVEL SECURITY;

-- The rate book is reference data — it prices the public /tools/budget estimator, which
-- has no session. Writes are service-role only.
DROP POLICY IF EXISTS "public_read" ON public.construction_city_rates;
CREATE POLICY "public_read" ON public.construction_city_rates
  FOR SELECT TO anon, authenticated USING (true);

-- ── 1. Seed the corrected book ───────────────────────────
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
  -- Listed as BALI until Aug 2026. Rates unchanged by the rename; resolveCityRate keeps
  -- an alias so projects that stored "Bali" as free text still price identically.
  ('BAMENDA', 'CM', 'Bamenda',  190000,  71000, 48500,  72875, 1.0556, 'XAF', 'real_bq',
   'Source city for the Naka school BQ. Listed as Bali until Aug 2026.'),
  -- Index was 1.4444 (+44%), from reading the region's absolute concrete rates as an
  -- index. Vanessa puts Adamawa at +7-8% over Douala; 1.0750 is the mid-point. The
  -- rc_350/rc_250/lean/mortar figures are correct and unchanged.
  ('ADAMAWA', 'CM', 'Adamawa',  260000,  86125, 61750,  88375, 1.0750, 'XAF', 'real_bq',
   'Inland haulage on cement (45,500) and steel (102,000). Index corrected from 1.4444 '
   'to 1.0750 in migration 037.'),
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

-- If 020 ever does get run, it would recreate BALI. Removed last so this migration
-- converges either way.
DELETE FROM public.construction_city_rates WHERE city_code = 'BALI';

-- ── What is deliberately NOT done ────────────────────────
-- `projects.city` is not rewritten from 'Bali' to 'Bamenda'.
--
-- resolveCityRate() carries a CITY_ALIASES entry mapping BALI → BAMENDA, so those rows
-- keep pricing off exactly the same numbers they always did. Rewriting stored user input
-- to match a relabelled dropdown would edit a record of what someone actually entered,
-- for no pricing benefit.
--
-- Existing budgets are not recalculated either. Any Adamawa project confirmed before
-- today keeps its budget_usd: payment_milestone_usd derives from it, so re-pricing would
-- silently move money already agreed. New estimates pick up 1.0750 immediately; a live
-- project's owner can revise their budget themselves if they want the correction.
