-- ============================================================================
-- 073  Rule-of-thumb rate per built m²
-- ============================================================================
--
-- WHAT THIS IS FOR
--
-- Not a pricing input. Nothing in the take-off reads it and no client is ever quoted
-- from it. It is the reference figure the estimate is sanity-checked against: if our
-- number lands below half of it, the screen tells the client the estimate looks low for
-- a building that size and to have a contractor confirm it. See src/lib/budget/sanity.ts.
--
-- Vanessa's back-of-envelope, given 4 September 2026: a Yaoundé build runs about
-- 180,000 XAF per built m² — footprint x floors x 180,000. It is crude on purpose. It
-- knows nothing about finish, shape, roof or room count, which is exactly why it works
-- as a check: a rough number that disagrees with a precise one by more than half means
-- the precise one is wrong, not the rough one.
--
-- WHY IT LIVES IN THE DATABASE
--
-- It sat in a TypeScript constant for one afternoon and that was one afternoon too long.
-- Every other rate in this system — base_rate_usd, the city concrete columns, the FX
-- rate — is a row someone can correct without a deploy, and the number a quantity
-- surveyor may revise after the next project is exactly the kind that must not need one.
--
-- ONE COLUMN, PER COUNTRY, SCALED PER CITY
--
-- The figure is a country baseline. Cities scale off `city_rates.cost_delta_pct`, which
-- is already documented as the whole-building cost difference against the baseline city
-- and is therefore the correct multiplier for a whole-building reference. Do NOT derive
-- this from `city_rates.rc_350`: Yaoundé's rc_350 is also 180,000, but that is XAF per
-- CUBIC metre of RC-350 concrete. The collision is a coincidence, and reading one off
-- the other would silently move the check the next time a concrete rate is corrected.
--
-- NULL means "no defensible reference for this country". Nigeria is null and stays null
-- until a Nigerian Bill of Quantity exists — a warning derived from a guess is a guess
-- wearing a warning's clothes. A null simply switches the check off; it never blocks.
-- ============================================================================

ALTER TABLE public.construction_rates
  ADD COLUMN IF NOT EXISTS rule_of_thumb_per_m2 NUMERIC(12,2);

COMMENT ON COLUMN public.construction_rates.rule_of_thumb_per_m2 IS
  'Reference cost per built m² (footprint x floors), in this row''s currency_code. '
  'Sanity check only — never a pricing input. NULL disables the check for the country.';

-- Cameroon: Vanessa, 4 Sep 2026. Baseline is Yaoundé; other CM cities scale by
-- city_rates.cost_delta_pct.
UPDATE public.construction_rates
   SET rule_of_thumb_per_m2 = 180000.00,
       updated_at           = now()
 WHERE country_code = 'CM';

-- Nigeria stays NULL on purpose. There is no Nigerian BQ; see the note in
-- src/lib/budget/model.ts above the ABUJA row.
UPDATE public.construction_rates
   SET rule_of_thumb_per_m2 = NULL
 WHERE country_code <> 'CM';
