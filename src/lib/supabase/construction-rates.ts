import { supabase } from '@/lib/supabase/client';
import type { ConstructionRate } from '@/types/project';

const CACHE_KEY = (code: string) => `gw_rate_v1_${code}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  rate: ConstructionRate;
  cachedAt: number;
}

// Hardcoded fallback — CM rates calibrated from real BQ.
// Used when the DB is unreachable (offline, timeout, cold start).
const FALLBACK_RATE: ConstructionRate = {
  country_code: 'CM',
  base_rate_usd: 640,
  upper_floor_addition_pct: 24.3,
  sections: {
    preliminary: 1.1,
    foundation: 9.6,
    ground_floor: 29.4,
    roof: 12.5,
    joinery: 8.7,
    electrical: 4.8,
    plumbing: 13.4,
    finishing: 20.5,
  },
  finish_multipliers:        { standard: 1.0, premium: 1.35, luxury: 1.70 },
  building_type_multipliers: {
    single_family: 1.0, bungalow: 1.0, townhouse: 1.05, semi_detached: 1.03,
    duplex: 1.05, multi_family: 1.15, apartment: 1.15, office: 1.25,
    retail: 1.20, warehouse_commercial: 0.75, hotel: 1.45, guest_house: 1.25,
    villa: 1.15, commercial: 1.20, mixed_residential_commercial: 1.22,
    live_work: 1.12, mixed_retail_residential: 1.18, transit_oriented: 1.30,
    factory: 0.85, warehouse_industrial: 0.75, industrial_complex: 0.90,
    distribution_centre: 0.78,
  },
  roof_type_multipliers: {
    long_span_aluminum: 1.0, clay_tiles: 1.10, concrete_flat: 1.08, shingle: 1.05,
  },
  currency_code:  'XAF',
  approx_fx_rate: 600,
  data_source:    'real_bq',
  notes:          'Fallback — CM calibrated from real BQ, Yaoundé 2026',
};

function readCache(code: string): ConstructionRate | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY(code));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(CACHE_KEY(code));
      return null;
    }
    return entry.rate;
  } catch {
    return null;
  }
}

function writeCache(rate: ConstructionRate): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry = { rate, cachedAt: Date.now() };
    sessionStorage.setItem(CACHE_KEY(rate.country_code), JSON.stringify(entry));
  } catch {
    // sessionStorage full — not critical, silently ignore
  }
}

export async function getConstructionRate(countryCode: string): Promise<ConstructionRate> {
  if (!countryCode) return FALLBACK_RATE;

  // 1. Check sessionStorage cache
  const cached = readCache(countryCode);
  if (cached) return cached;

  // 2. Fetch from DB
  try {
    const { data } = await supabase
      .from('construction_rates')
      .select('*')
      .eq('country_code', countryCode)
      .single();

    if (data) {
      const rate = data as ConstructionRate;
      writeCache(rate);
      return rate;
    }
  } catch {
    // DB unreachable — fall through to fallback
  }

  // 3. Fallback — use CM rates with a note that it's a fallback
  return { ...FALLBACK_RATE, country_code: countryCode };
}
