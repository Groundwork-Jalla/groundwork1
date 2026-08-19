-- =========================================================
-- 045  City rates re-baselined on Vanessa Gwanvoma's 17 Aug 2026 review
--
-- Two changes, and the second is the subtle one.
--
-- 1. THE BASELINE MOVES FROM DOUALA TO YAOUNDÉ.
--    Vanessa's list: Yaoundé base, Douala 5% cheaper, Buea same, Bamenda +10%,
--    Kribi +5%, Garoua +10%, Limbe 3% cheaper. Adamawa +7% comes from her Q11
--    answer. This finally settles the Douala/Yaoundé question that migration 020
--    left open and that Philip raised independently — Douala IS the cheaper city.
--
-- 2. `index_vs_baseline` IS NOT HER PERCENTAGE, AND MUST NOT BE SET TO IT.
--    The engine reads concrete from each city's own rc_350/rc_250/lean columns and
--    indexes only the other trades (engine.ts). Those concrete columns are real
--    measured data — Vanessa's own review verifies each source document's concrete
--    rate against its city's column. So the index is the NON-CONCRETE trade index,
--    and setting it to her whole-building figure would double-count the concrete
--    difference. That is exactly the bug this migration fixes for Adamawa, which
--    priced +15.2% overall while carrying her stated +7% in the index column.
--
--    `cost_delta_pct` is the new column and it holds HER figure — the whole-building
--    delta. It is the only city number the engine reads, and the only one that is a
--    claim about the world rather than machinery.
--
--    The index is SOLVED AT RUNTIME, per building, from that percentage. It is not
--    stored, because a stored one cannot be right: how much of a build is concrete
--    depends on the building, so a value fitted to one shape drifts on every other —
--    measured at up to 2.3 points on Adamawa and Garoua. Solving per build puts every
--    city exactly on its stated figure for every shape. See runTakeoff.
--
--    `index_vs_baseline` is therefore set to 1 and is vestigial. It is left on the
--    table because older cached rate books carry it; nothing reads it.
--
-- NOT VERIFIED, and flagged as such: Adamawa and Garoua concrete columns
-- (260,000 XAF/m³) have no Bill of Quantity behind them — Vanessa's verification
-- table covers Yaoundé, Buea, Bamenda and Kribi only. Their solved indices come out
-- BELOW 1.0, i.e. northern trades priced cheaper than Yaoundé to offset concrete
-- priced 44% dearer. Only the total is hers; the split between the two is ours.
-- =========================================================

ALTER TABLE public.construction_city_rates
  ADD COLUMN IF NOT EXISTS cost_delta_pct NUMERIC(6,2);

COMMENT ON COLUMN public.construction_city_rates.cost_delta_pct IS
  'Whole-building cost vs the country baseline city, in percent (Yaoundé = 0 for CM). '
  'Vanessa Gwanvoma, 17 Aug 2026. The only city figure the engine reads; it solves the '
  'trade index from this, per building, at run time.';

COMMENT ON COLUMN public.construction_city_rates.index_vs_baseline IS
  'VESTIGIAL since 045. The engine solves the non-concrete trade index per building '
  'from cost_delta_pct instead; a stored index drifts by up to 2.3 points across '
  'building shapes. Kept only because older cached rate books carry the column.';

-- Garoua: a city on Vanessa's list that we did not carry. Concrete columns are
-- Adamawa's, the nearest northern proxy, and are a guess — see the header.
INSERT INTO public.construction_city_rates
  (city_code, country_code, city_name, rc_350, rc_250, lean_concrete, mortar,
   index_vs_baseline, cost_delta_pct, currency_code, data_source, notes)
VALUES
  ('GAROUA', 'CM', 'Garoua', 260000, 86125, 61750, 88375,
   1.0000, 10.00, 'XAF', 'estimated_index',
   'Added 045. Vanessa: +10% overall. Concrete columns copied from Adamawa — northern proxy, no BQ.')
ON CONFLICT (city_code) DO UPDATE SET
  city_name         = EXCLUDED.city_name,
  rc_350            = EXCLUDED.rc_350,
  rc_250            = EXCLUDED.rc_250,
  lean_concrete     = EXCLUDED.lean_concrete,
  mortar            = EXCLUDED.mortar,
  index_vs_baseline = EXCLUDED.index_vs_baseline,
  cost_delta_pct    = EXCLUDED.cost_delta_pct,
  data_source       = EXCLUDED.data_source,
  notes             = EXCLUDED.notes,
  updated_at        = now();

-- The solved indices. Concrete columns are untouched: they are measured data.
UPDATE public.construction_city_rates SET
  index_vs_baseline = v.idx,
  cost_delta_pct    = v.delta,
  notes             = v.note,
  updated_at        = now()
FROM (VALUES
  ('YAOUNDE', 1.0000, 0.00, 'Baseline city for Cameroon from 045. Was tied with Douala at 1.0000.'),
  ('DOUALA', 1.0000, -5.00, 'Vanessa: 5% cheaper than Yaoundé. Was the baseline at 1.0000.'),
  ('BUEA', 1.0000, 0.00, 'Vanessa: same as Yaoundé. Was 1.0556 against a Douala baseline.'),
  ('BAMENDA', 1.0000, 10.00, 'Vanessa: +10%. Was 1.0556.'),
  ('KRIBI', 1.0000, 5.00, 'Vanessa: +5%. Was 0.9944.'),
  ('LIMBE', 1.0000, -3.00, 'Vanessa: 3% cheaper. Was 1.0556.'),
  ('ADAMAWA', 1.0000, 7.00, 'Vanessa Q11: +7% on construction cost. Was 1.0750, which realised +15.2% because the concrete column is +44% and is not indexed. Concrete column unverified.')
) AS v(code, idx, delta, note)
WHERE public.construction_city_rates.city_code = v.code;

-- Nigeria is on pause for the beta and has no BQ behind it. Recorded rather than
-- silently left null, so the column does not read as "no difference".
UPDATE public.construction_city_rates
   SET notes = COALESCE(notes, '') || ' cost_delta_pct unset: no Nigerian BQ (045).'
 WHERE country_code = 'NG' AND cost_delta_pct IS NULL;
