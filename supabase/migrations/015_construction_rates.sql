-- Construction cost rates per country
-- Used by the budget estimation formula in the project creation wizard.
-- One row per country. Sections percentages must sum to 100.
-- CM is calibrated from a real BQ (Mrs. Rose Ndum Kenah, Yaoundé, July 2026).
-- All other countries are indexed from CM until real BQ data is available.

CREATE TABLE IF NOT EXISTS public.construction_rates (
  country_code              CHAR(2)        PRIMARY KEY,
  base_rate_usd             NUMERIC(10,2)  NOT NULL,            -- all-in $/sqm, single-storey, standard finish
  upper_floor_addition_pct  NUMERIC(5,2)   NOT NULL DEFAULT 24.3, -- % of single-storey base added per extra floor
  sections                  JSONB          NOT NULL,            -- trade section % breakdown (must sum to 100)
  finish_multipliers        JSONB          NOT NULL,
  building_type_multipliers JSONB          NOT NULL,
  roof_type_multipliers     JSONB          NOT NULL,
  currency_code             CHAR(3)        NOT NULL,
  approx_fx_rate            NUMERIC(12,4)  NOT NULL,            -- local units per 1 USD
  data_source               TEXT           NOT NULL DEFAULT 'estimated_index'
                              CHECK (data_source IN ('real_bq', 'estimated_index')),
  notes                     TEXT,
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE public.construction_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON public.construction_rates
  FOR SELECT USING (true);

CREATE POLICY "service_write" ON public.construction_rates
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER construction_rates_updated_at
  BEFORE UPDATE ON public.construction_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Seed data ──────────────────────────────────────────────
-- Common JSONB values reused across rows

DO $$
DECLARE
  v_sections  JSONB := '{"preliminary":1.1,"foundation":9.6,"ground_floor":29.4,"roof":12.5,"joinery":8.7,"electrical":4.8,"plumbing":13.4,"finishing":20.5}';
  v_finish    JSONB := '{"standard":1.0,"premium":1.35,"luxury":1.70}';
  v_building  JSONB := '{"single_family":1.0,"bungalow":1.0,"townhouse":1.05,"semi_detached":1.03,"duplex":1.05,"multi_family":1.15,"apartment":1.15,"office":1.25,"retail":1.20,"warehouse_commercial":0.75,"hotel":1.45,"guest_house":1.25,"villa":1.15,"commercial":1.20,"mixed_residential_commercial":1.22,"live_work":1.12,"mixed_retail_residential":1.18,"transit_oriented":1.30,"factory":0.85,"warehouse_industrial":0.75,"industrial_complex":0.90,"distribution_centre":0.78}';
  v_roof      JSONB := '{"long_span_aluminum":1.0,"clay_tiles":1.10,"concrete_flat":1.08,"shingle":1.05}';
BEGIN

INSERT INTO public.construction_rates
  (country_code, base_rate_usd, upper_floor_addition_pct, sections, finish_multipliers, building_type_multipliers, roof_type_multipliers, currency_code, approx_fx_rate, data_source, notes)
VALUES

-- ── Cameroon — calibrated from real BQ ────────────────────
('CM', 640.00, 24.3, v_sections, v_finish, v_building, v_roof, 'XAF', 600.0000,
 'real_bq', 'Calibrated from real BQ — G+1 residential, Nkozoa-Yaoundé, July 2026'),

-- ── West Africa — CFA zone (same currency base as CM) ─────
('CI', 621.00, 24.3, v_sections, v_finish, v_building, v_roof, 'XOF', 600.0000,
 'estimated_index', 'Indexed from CM ×0.97'),
('SN', 608.00, 24.3, v_sections, v_finish, v_building, v_roof, 'XOF', 600.0000,
 'estimated_index', 'Indexed from CM ×0.95'),
('TG', 589.00, 24.3, v_sections, v_finish, v_building, v_roof, 'XOF', 600.0000,
 'estimated_index', 'Indexed from CM ×0.92'),
('BJ', 589.00, 24.3, v_sections, v_finish, v_building, v_roof, 'XOF', 600.0000,
 'estimated_index', 'Indexed from CM ×0.92'),

-- ── Nigeria & Ghana ────────────────────────────────────────
('NG', 672.00, 24.3, v_sections, v_finish, v_building, v_roof, 'NGN', 1600.0000,
 'estimated_index', 'Indexed from CM ×1.05'),
('GH', 608.00, 24.3, v_sections, v_finish, v_building, v_roof, 'GHS', 16.0000,
 'estimated_index', 'Indexed from CM ×0.95'),

-- ── East Africa ────────────────────────────────────────────
('KE', 704.00, 24.3, v_sections, v_finish, v_building, v_roof, 'KES', 130.0000,
 'estimated_index', 'Indexed from CM ×1.10'),
('UG', 576.00, 24.3, v_sections, v_finish, v_building, v_roof, 'UGX', 3700.0000,
 'estimated_index', 'Indexed from CM ×0.90'),
('TZ', 576.00, 24.3, v_sections, v_finish, v_building, v_roof, 'TZS', 2500.0000,
 'estimated_index', 'Indexed from CM ×0.90'),
('RW', 736.00, 24.3, v_sections, v_finish, v_building, v_roof, 'RWF', 1300.0000,
 'estimated_index', 'Indexed from CM ×1.15'),
('ET', 544.00, 24.3, v_sections, v_finish, v_building, v_roof, 'ETB', 57.0000,
 'estimated_index', 'Indexed from CM ×0.85'),

-- ── Southern Africa ────────────────────────────────────────
('ZA', 1056.00, 24.3, v_sections, v_finish, v_building, v_roof, 'ZAR', 18.0000,
 'estimated_index', 'Indexed from CM ×1.65'),
('ZM', 563.00, 24.3, v_sections, v_finish, v_building, v_roof, 'ZMW', 28.0000,
 'estimated_index', 'Indexed from CM ×0.88'),
('ZW', 544.00, 24.3, v_sections, v_finish, v_building, v_roof, 'USD', 1.0000,
 'estimated_index', 'Indexed from CM ×0.85 — USD economy'),
('MZ', 544.00, 24.3, v_sections, v_finish, v_building, v_roof, 'MZN', 64.0000,
 'estimated_index', 'Indexed from CM ×0.85'),
('BW', 736.00, 24.3, v_sections, v_finish, v_building, v_roof, 'BWP', 14.0000,
 'estimated_index', 'Indexed from CM ×1.15'),

-- ── Central Africa ─────────────────────────────────────────
('CD', 512.00, 24.3, v_sections, v_finish, v_building, v_roof, 'CDF', 2800.0000,
 'estimated_index', 'Indexed from CM ×0.80'),

-- ── North Africa ───────────────────────────────────────────
('MA', 768.00, 24.3, v_sections, v_finish, v_building, v_roof, 'MAD', 10.0000,
 'estimated_index', 'Indexed from CM ×1.20'),
('EG', 512.00, 24.3, v_sections, v_finish, v_building, v_roof, 'EGP', 48.0000,
 'estimated_index', 'Indexed from CM ×0.80'),

-- ── Diaspora origin countries (UK / US) ───────────────────
('GB', 2880.00, 24.3, v_sections, v_finish, v_building, v_roof, 'GBP', 0.7900,
 'estimated_index', 'Indexed from CM ×4.50 — UK residential rate'),
('US', 3200.00, 24.3, v_sections, v_finish, v_building, v_roof, 'USD', 1.0000,
 'estimated_index', 'Indexed from CM ×5.00 — US residential rate')

ON CONFLICT (country_code) DO UPDATE SET
  base_rate_usd             = EXCLUDED.base_rate_usd,
  upper_floor_addition_pct  = EXCLUDED.upper_floor_addition_pct,
  sections                  = EXCLUDED.sections,
  finish_multipliers        = EXCLUDED.finish_multipliers,
  building_type_multipliers = EXCLUDED.building_type_multipliers,
  roof_type_multipliers     = EXCLUDED.roof_type_multipliers,
  currency_code             = EXCLUDED.currency_code,
  approx_fx_rate            = EXCLUDED.approx_fx_rate,
  data_source               = EXCLUDED.data_source,
  notes                     = EXCLUDED.notes,
  updated_at                = now();

END $$;
