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
-- 020_bq_calibration.sql is applied and must never be edited; this supersedes those two
-- rows instead.
--
-- Run in: Supabase Dashboard > SQL Editor (after 036)
-- =========================================================

-- ── 1. Bali becomes Bamenda ──────────────────────────────
-- Insert-then-delete rather than UPDATE city_code: if 037 is ever run twice, or if a
-- BAMENDA row already exists from a later seed, this converges instead of erroring on
-- the primary key.
INSERT INTO public.construction_city_rates
  (city_code, country_code, city_name, rc_350, rc_250, lean_concrete, mortar,
   index_vs_baseline, currency_code, data_source, notes)
SELECT
  'BAMENDA', country_code, 'Bamenda', rc_350, rc_250, lean_concrete, mortar,
  index_vs_baseline, currency_code, data_source,
  'Source city for the Naka school BQ. Listed as Bali until Aug 2026 (migration 037); '
  'rates unchanged by the rename.'
FROM public.construction_city_rates
WHERE city_code = 'BALI'
ON CONFLICT (city_code) DO NOTHING;

-- Fallback for a database that never had the BALI row (fresh install after 037).
INSERT INTO public.construction_city_rates
  (city_code, country_code, city_name, rc_350, rc_250, lean_concrete, mortar,
   index_vs_baseline, currency_code, data_source, notes)
VALUES
  ('BAMENDA', 'CM', 'Bamenda', 190000, 71000, 48500, 72875, 1.0556, 'XAF', 'real_bq',
   'Source city for the Naka school BQ.')
ON CONFLICT (city_code) DO NOTHING;

DELETE FROM public.construction_city_rates WHERE city_code = 'BALI';

-- ── 2. Adamawa is +7.5%, not +44% ────────────────────────
UPDATE public.construction_city_rates
  SET index_vs_baseline = 1.0750,
      notes = 'Inland haulage on cement (45,500) and steel (102,000). Index corrected '
              'from 1.4444 to 1.0750 in migration 037 — Vanessa put Adamawa at +7-8% '
              'over Douala, not +44%.'
  WHERE city_code = 'ADAMAWA';

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
