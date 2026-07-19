import type { BudgetBreakdown, WizardFormData } from '@/types/project';
import { findCountry } from '@/lib/countries';

// Multipliers for building type over base residential rate
const BUILDING_TYPE_MULTIPLIER: Record<string, number> = {
  single_family:               1.00,
  multi_family:                1.15,
  townhouse:                   1.05,
  semi_detached:               1.03,
  office:                      1.25,
  retail:                      1.20,
  warehouse_commercial:        0.85,
  hotel:                       1.45,
  factory:                     0.90,
  warehouse_industrial:        0.80,
  industrial_complex:          0.92,
  distribution_centre:         0.82,
  mixed_residential_commercial:1.22,
  live_work:                   1.12,
  mixed_retail_residential:    1.18,
  transit_oriented:            1.30,
};

// Per-additional-floor surcharge (stacks: floor 2 = +8 %, floor 3 = +16 %, …)
const FLOOR_SURCHARGE_PER_FLOOR = 0.08;

const ROOF_MULTIPLIER: Record<string, number> = {
  long_span_aluminum: 1.00,
  clay_tiles:         1.05,
  concrete_flat:      1.03,
  shingle:            1.04,
};

// Fixed USD cost per boys'-quarters room
const BQ_ROOM_COST_USD = 8_000;

// Budget slice percentages (must sum to 1.00)
const SLICES = {
  materials:   0.41,
  labor:       0.23,
  engineering: 0.16,
  permits:     0.02,
  contingency: 0.08,
  management:  0.10,
} as const;

export function calculateBudget(data: Partial<WizardFormData>): BudgetBreakdown {
  const {
    country       = 'NG',
    finishLevel   = 'standard',
    sqm           = 0,
    floors        = 1,
    buildingType  = 'single_family',
    roofType      = 'long_span_aluminum',
    hasBoysQuarters = false,
    bqRooms       = 0,
  } = data;

  const countryData = findCountry(country);
  const baseRate = countryData
    ? countryData[finishLevel === 'standard' ? 'rateStandard' : finishLevel === 'premium' ? 'ratePremium' : 'rateLuxury']
    : 200;

  const buildingMult = BUILDING_TYPE_MULTIPLIER[buildingType ?? 'single_family'] ?? 1.0;
  const roofMult     = ROOF_MULTIPLIER[roofType ?? 'long_span_aluminum'] ?? 1.0;
  const floorMult    = 1 + Math.max(0, floors - 1) * FLOOR_SURCHARGE_PER_FLOOR;

  let total = sqm * baseRate * buildingMult * floorMult * roofMult;

  if (hasBoysQuarters && bqRooms > 0) {
    total += bqRooms * BQ_ROOM_COST_USD;
  }

  total = Math.max(0, Math.round(total));

  return {
    total,
    materials:   Math.round(total * SLICES.materials),
    labor:       Math.round(total * SLICES.labor),
    engineering: Math.round(total * SLICES.engineering),
    permits:     Math.round(total * SLICES.permits),
    contingency: Math.round(total * SLICES.contingency),
    management:  Math.round(total * SLICES.management),
  };
}

export function formatUSD(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000).toLocaleString('en-US')}K`;
  }
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
