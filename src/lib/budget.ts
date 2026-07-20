import type { BudgetBreakdown, BudgetCalcDetail, ConstructionRate, TradeSection, WizardFormData } from '@/types/project';
import { findCountry } from '@/lib/countries';

// ── BQ addon ───────────────────────────────────────────────
const BQ_ROOM_COST_USD = 8_000;

// ── Trade section display colors ──────────────────────────
const SECTION_COLORS: Record<string, string> = {
  preliminary:  '#94a3b8', // slate
  foundation:   '#78716c', // stone
  ground_floor: '#3b82f6', // blue
  upper_floor:  '#60a5fa', // blue-light (multi-floor addition)
  roof:         '#f59e0b', // amber
  joinery:      '#8b5cf6', // purple
  electrical:   '#eab308', // yellow
  plumbing:     '#06b6d4', // cyan
  finishing:    '#22c55e', // green
  bq:           '#f97316', // orange
};

// ── Core total computation ─────────────────────────────────

function computeTotal(data: Partial<WizardFormData>, rate: ConstructionRate): number {
  const {
    sqm             = 0,
    floors          = 1,
    finishLevel     = 'standard',
    buildingType    = 'single_family',
    roofType        = 'long_span_aluminum',
    hasBoysQuarters = false,
    bqRooms         = 0,
  } = data;

  const finishMult   = rate.finish_multipliers[finishLevel]                 ?? 1.0;
  const buildingMult = rate.building_type_multipliers[buildingType ?? '']   ?? 1.0;
  const roofMult     = rate.roof_type_multipliers[roofType ?? '']           ?? 1.0;
  const extraFloors  = Math.max(0, floors - 1);
  const floorMult    = 1 + extraFloors * (rate.upper_floor_addition_pct / 100);

  const base  = sqm * rate.base_rate_usd * finishMult * buildingMult * roofMult * floorMult;
  const bqCost = hasBoysQuarters && bqRooms > 0 ? bqRooms * BQ_ROOM_COST_USD : 0;
  return Math.round(base + bqCost);
}

// ── Public: simple total for createProject ─────────────────

export function calculateBudget(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
): BudgetBreakdown {
  let total: number;

  if (rate) {
    total = computeTotal(data, rate);
  } else {
    // Legacy fallback — uses countries.ts rates when no DB rate available
    const { country = 'NG', finishLevel = 'standard', sqm = 0, floors = 1,
            buildingType = 'single_family', roofType = 'long_span_aluminum',
            hasBoysQuarters = false, bqRooms = 0 } = data;
    const countryData  = findCountry(country);
    const baseRate     = countryData
      ? countryData[finishLevel === 'standard' ? 'rateStandard' : finishLevel === 'premium' ? 'ratePremium' : 'rateLuxury']
      : 200;
    const BUILDING_MULT: Record<string, number> = {
      single_family: 1.0, multi_family: 1.15, townhouse: 1.05, semi_detached: 1.03,
      office: 1.25, retail: 1.20, warehouse_commercial: 0.85, hotel: 1.45, factory: 0.90,
    };
    const ROOF_MULT: Record<string, number> = {
      long_span_aluminum: 1.0, clay_tiles: 1.05, concrete_flat: 1.03, shingle: 1.04,
    };
    const floorMult    = 1 + Math.max(0, floors - 1) * 0.08;
    const buildingMult = BUILDING_MULT[buildingType ?? ''] ?? 1.0;
    const roofMult     = ROOF_MULT[roofType ?? '']        ?? 1.0;
    const bqCost       = hasBoysQuarters && bqRooms > 0 ? bqRooms * BQ_ROOM_COST_USD : 0;
    total = Math.round(sqm * baseRate * buildingMult * floorMult * roofMult + bqCost);
  }

  return {
    total,
    materials:   Math.round(total * 0.41),
    labor:       Math.round(total * 0.23),
    engineering: Math.round(total * 0.16),
    permits:     Math.round(total * 0.02),
    contingency: Math.round(total * 0.08),
    management:  Math.round(total * 0.10),
  };
}

// ── Public: trade-section detail for display ───────────────

export function calculateBudgetDetail(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
): BudgetCalcDetail {
  // If no rate provided, build a synthetic one from countries.ts for backward compat
  const effectiveRate: ConstructionRate = rate ?? buildLegacyRate(data);

  const {
    sqm             = 0,
    floors          = 1,
    finishLevel     = 'standard',
    buildingType    = 'single_family',
    roofType        = 'long_span_aluminum',
    hasBoysQuarters = false,
    bqRooms         = 0,
  } = data;

  const total      = computeTotal(data, effectiveRate);
  const local      = (usd: number) => Math.round(usd * effectiveRate.approx_fx_rate);
  const extraFloors = Math.max(0, floors - 1);
  const secs       = effectiveRate.sections;

  // Single-storey base cost (before floor multiplier)
  const finishMult   = effectiveRate.finish_multipliers[finishLevel]                ?? 1.0;
  const buildingMult = effectiveRate.building_type_multipliers[buildingType ?? '']  ?? 1.0;
  const roofMult     = effectiveRate.roof_type_multipliers[roofType ?? '']          ?? 1.0;
  const singleBase   = sqm * effectiveRate.base_rate_usd * finishMult * buildingMult * roofMult;

  const sections: TradeSection[] = [];

  function addSection(key: string, label: string, pct: number, amountUSD: number) {
    if (amountUSD <= 0) return;
    sections.push({
      key, label,
      pct:         Math.round(pct * 10) / 10,
      amountUSD:   Math.round(amountUSD),
      amountLocal: local(Math.round(amountUSD)),
      color:       SECTION_COLORS[key] ?? '#9ca3af',
    });
  }

  // Base 8 trade sections (from rate percentages × single-storey base)
  addSection('preliminary',  'Site & Preliminary',    secs.preliminary,  singleBase * secs.preliminary  / 100);
  addSection('foundation',   'Foundation',            secs.foundation,   singleBase * secs.foundation   / 100);
  addSection('ground_floor', 'Ground Floor Structure',secs.ground_floor, singleBase * secs.ground_floor / 100);
  addSection('roof',         'Roof & Covering',       secs.roof,         singleBase * secs.roof         / 100);
  addSection('joinery',      'Doors & Windows',       secs.joinery,      singleBase * secs.joinery      / 100);
  addSection('electrical',   'Electrical',            secs.electrical,   singleBase * secs.electrical   / 100);
  addSection('plumbing',     'Plumbing & Sanitary',   secs.plumbing,     singleBase * secs.plumbing     / 100);
  addSection('finishing',    'Finishing & Painting',  secs.finishing,    singleBase * secs.finishing    / 100);

  // Upper floor(s) — each costs upper_floor_addition_pct % of the single-storey base
  for (let f = 1; f <= extraFloors; f++) {
    const floorUSD = singleBase * (effectiveRate.upper_floor_addition_pct / 100);
    addSection(
      'upper_floor',
      extraFloors === 1 ? 'Upper Floor Structure' : `Floor ${f + 1} Structure`,
      (floorUSD / total) * 100,
      floorUSD,
    );
  }

  // Boys' quarters add-on
  if (hasBoysQuarters && bqRooms > 0) {
    const bqUSD = bqRooms * BQ_ROOM_COST_USD;
    addSection('bq', `Boys' Quarters (${bqRooms} room${bqRooms > 1 ? 's' : ''})`, (bqUSD / total) * 100, bqUSD);
  }

  return {
    sections,
    total,
    totalLocal:    local(total),
    currencyCode:  effectiveRate.currency_code,
    approxFxRate:  effectiveRate.approx_fx_rate,
    dataSource:    effectiveRate.data_source,
  };
}

// ── Legacy rate builder (backward compat when no DB rate) ──

function buildLegacyRate(data: Partial<WizardFormData>): ConstructionRate {
  const { country = 'NG', finishLevel = 'standard' } = data;
  const countryData = findCountry(country);
  const baseRate    = countryData
    ? countryData[finishLevel === 'premium' ? 'ratePremium' : finishLevel === 'luxury' ? 'rateLuxury' : 'rateStandard']
    : 200;
  return {
    country_code: country,
    base_rate_usd: baseRate,
    upper_floor_addition_pct: 24.3,
    sections: {
      preliminary: 1.1, foundation: 9.6, ground_floor: 29.4, roof: 12.5,
      joinery: 8.7, electrical: 4.8, plumbing: 13.4, finishing: 20.5,
    },
    finish_multipliers:        { standard: 1.0, premium: 1.0, luxury: 1.0 }, // already baked into baseRate
    building_type_multipliers: {
      single_family: 1.0, bungalow: 1.0, townhouse: 1.05, semi_detached: 1.03,
      duplex: 1.05, multi_family: 1.15, apartment: 1.15, office: 1.25,
      retail: 1.20, warehouse_commercial: 0.85, hotel: 1.45,
    },
    roof_type_multipliers: {
      long_span_aluminum: 1.0, clay_tiles: 1.05, concrete_flat: 1.03, shingle: 1.04,
    },
    currency_code:  countryData ? getCurrencyCode(country) : 'USD',
    approx_fx_rate: countryData ? getApproxFx(country) : 1,
    data_source:    'estimated_index',
  };
}

function getCurrencyCode(code: string): string {
  const MAP: Record<string, string> = {
    CM: 'XAF', CI: 'XOF', SN: 'XOF', TG: 'XOF', BJ: 'XOF',
    NG: 'NGN', GH: 'GHS', KE: 'KES', UG: 'UGX', TZ: 'TZS',
    RW: 'RWF', ET: 'ETB', ZA: 'ZAR', ZM: 'ZMW', ZW: 'USD',
    MZ: 'MZN', BW: 'BWP', CD: 'CDF', MA: 'MAD', EG: 'EGP',
    GB: 'GBP', US: 'USD',
  };
  return MAP[code] ?? 'USD';
}

function getApproxFx(code: string): number {
  const MAP: Record<string, number> = {
    CM: 600, CI: 600, SN: 600, TG: 600, BJ: 600,
    NG: 1600, GH: 16, KE: 130, UG: 3700, TZ: 2500,
    RW: 1300, ET: 57, ZA: 18, ZM: 28, ZW: 1,
    MZ: 64, BW: 14, CD: 2800, MA: 10, EG: 48,
    GB: 0.79, US: 1,
  };
  return MAP[code] ?? 1;
}

// ── Formatting helpers ─────────────────────────────────────

export function formatUSD(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000)     return `$${Math.round(amount / 1_000).toLocaleString('en-US')}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

export function formatUSDFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

export function formatLocalCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currencyCode,
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencyCode} ${Math.round(amount).toLocaleString('en-US')}`;
  }
}
