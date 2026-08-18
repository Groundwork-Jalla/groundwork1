import type { ConstructionRate, WizardFormData } from '@/types/project';
import { findCountry } from '@/lib/countries';
import { CM_RATE_FALLBACK } from './model';
import { roofMultipliers } from './roof';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';

/**
 * The pre-take-off multiplicative estimate.
 *
 *   total = footprint × base_rate_usd × finish × building × roof × (1 + extraFloors × pct)
 *
 * Still used for every country that has no take-off model, which is all of them except
 * Cameroon. Do not calibrate anything new against this — it was fitted to a single BQ and
 * overshoots other real projects by 49–146%. See 020_bq_calibration.sql.
 */

export function legacyTotal(data: Partial<WizardFormData>, rate: ConstructionRate): number {
  const {
    sqm = 0, floors = 1, finishLevel = 'standard',
    buildingType = 'single_family', roofType = 'long_span_aluminum',
  } = data;

  const finishMult   = rate.finish_multipliers[finishLevel]               ?? 1.0;
  const buildingMult = rate.building_type_multipliers[buildingType ?? ''] ?? 1.0;
  const roofMult     = rate.roof_type_multipliers[roofType ?? '']         ?? 1.0;
  const extraFloors  = Math.max(0, floors - 1);
  const floorMult    = 1 + extraFloors * (rate.upper_floor_addition_pct / 100);

  // Boys' quarters used to add $8,000 per room here and in the take-off path. The figure
  // had no Bill of Quantity behind it and was 19–27% of a typical total, so it is gone
  // until Vanessa supplies one. The wizard still asks the question; it just costs nothing.
  return Math.round(sqm * rate.base_rate_usd * finishMult * buildingMult * roofMult * floorMult);
}

/**
 * Synthesise a rate row from countries.ts when the DB has none.
 *
 * Cameroon returns the calibrated row instead, so that the synchronous call sites which
 * never fetch a rate (project detail, costing tab, PDF export) still price by take-off
 * rather than falling back to flat 1.0 finish multipliers.
 */
export function buildLegacyRate(data: Partial<WizardFormData>): ConstructionRate {
  const { country = DEFAULT_COUNTRY_CODE, finishLevel = 'standard' } = data;
  if (country === 'CM') return CM_RATE_FALLBACK;
  const countryData = findCountry(country);
  const baseRate    = countryData
    ? countryData[finishLevel === 'premium' ? 'ratePremium'
                : finishLevel === 'luxury'  ? 'rateLuxury'
                : 'rateStandard']
    : 200;
  return {
    country_code: country,
    base_rate_usd: baseRate,
    upper_floor_addition_pct: 23.0,
    sections: {
      preliminary: 1.1, foundation: 9.6, ground_floor: 29.4, roof: 12.5,
      joinery: 8.7, electrical: 4.8, plumbing: 13.4, finishing: 20.5,
    },
    finish_multipliers:        { standard: 1.0, premium: 1.0, luxury: 1.0 }, // baked into baseRate
    building_type_multipliers: {
      single_family: 1.0, bungalow: 1.0, townhouse: 1.05, semi_detached: 1.03,
      duplex: 1.05, multi_family: 1.15, apartment: 1.15, office: 1.25,
      retail: 1.20, warehouse_commercial: 0.85, hotel: 1.45,
    },
    // Was clay 1.05 / concrete 1.03 / shingle 1.04 — a different set from model.ts and
    // from the badges the wizard printed. All three now come from roof.ts.
    roof_type_multipliers: roofMultipliers(),
    currency_code:  countryData ? getCurrencyCode(country) : 'USD',
    approx_fx_rate: countryData ? getApproxFx(country) : 1,
    data_source:    'estimated_index',
    takeoff:        null,
  };
}

export function getCurrencyCode(code: string): string {
  const MAP: Record<string, string> = {
    CM: 'XAF', CI: 'XOF', SN: 'XOF', TG: 'XOF', BJ: 'XOF',
    NG: 'NGN', GH: 'GHS', KE: 'KES', UG: 'UGX', TZ: 'TZS',
    RW: 'RWF', ET: 'ETB', ZA: 'ZAR', ZM: 'ZMW', ZW: 'USD',
    MZ: 'MZN', BW: 'BWP', CD: 'CDF', MA: 'MAD', EG: 'EGP',
    GB: 'GBP', US: 'USD',
  };
  return MAP[code] ?? 'USD';
}

export function getApproxFx(code: string): number {
  const MAP: Record<string, number> = {
    CM: 600, CI: 600, SN: 600, TG: 600, BJ: 600,
    NG: 1600, GH: 16, KE: 130, UG: 3700, TZ: 2500,
    RW: 1300, ET: 57, ZA: 18, ZM: 28, ZW: 1,
    MZ: 64, BW: 14, CD: 2800, MA: 10, EG: 48,
    GB: 0.79, US: 1,
  };
  return MAP[code] ?? 1;
}
