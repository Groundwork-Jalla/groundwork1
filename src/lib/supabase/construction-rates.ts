import { supabase } from '@/lib/supabase/client';
import { CITY_RATES, resolveCityRate } from '@/lib/budget';
import { CM_RATE_FALLBACK } from '@/lib/budget/model';
import type { CityRate, ConstructionRate } from '@/types/project';

// v2: rows now carry the take-off model and fixture prices from migration 020.
// The version bump invalidates v1 entries cached before those columns existed.
const CACHE_KEY = (code: string) => `gw_rate_v2_${code}`;
const CITY_CACHE_KEY = (code: string) => `gw_city_v1_${code}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  rate: ConstructionRate;
  cachedAt: number;
}

// Hardcoded fallback — the calibrated CM row, shared with the budget engine so the two
// can never drift. Used when the DB is unreachable (offline, timeout, cold start).
const FALLBACK_RATE: ConstructionRate = CM_RATE_FALLBACK;

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

  // 3. Fallback — use CM rates with a note that it's a fallback.
  //    The take-off only applies to Cameroon, so strip it for anywhere else rather than
  //    pricing (say) a Kenyan build off the Cameroon rate card.
  return countryCode === 'CM'
    ? { ...FALLBACK_RATE, country_code: countryCode }
    : { ...FALLBACK_RATE, country_code: countryCode, takeoff: null, fixture_prices: null };
}

/**
 * City rate for the quantity take-off. Falls back to the bundled book (and from there to
 * the country baseline) so the wizard still prices correctly offline.
 */
export async function getCityRate(
  city: string | null | undefined,
  countryCode: string,
): Promise<CityRate | null> {
  if (!countryCode) return null;

  const cached = readCityCache(countryCode);
  if (cached) return resolveCityRate(city, countryCode, cached);

  try {
    const { data } = await supabase
      .from('construction_city_rates')
      .select('*')
      .eq('country_code', countryCode);

    if (data && data.length > 0) {
      const book: Record<string, CityRate> = {};
      for (const row of data as CityRate[]) book[row.city_code] = row;
      writeCityCache(countryCode, book);
      return resolveCityRate(city, countryCode, book);
    }
  } catch {
    // DB unreachable — fall through to the bundled book
  }
  return resolveCityRate(city, countryCode, CITY_RATES);
}

function readCityCache(country: string): Record<string, CityRate> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CITY_CACHE_KEY(country));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { book: Record<string, CityRate>; cachedAt: number };
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(CITY_CACHE_KEY(country));
      return null;
    }
    return entry.book;
  } catch {
    return null;
  }
}

function writeCityCache(country: string, book: Record<string, CityRate>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CITY_CACHE_KEY(country),
      JSON.stringify({ book, cachedAt: Date.now() }));
  } catch {
    // sessionStorage full — not critical
  }
}
