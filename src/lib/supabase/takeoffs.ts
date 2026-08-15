import { supabase } from './client';
import { trackEvent } from '@/lib/analytics';
import { runTakeoff, CM_TAKEOFF, resolveCityRate, CITY_RATES, sectionsFromLines, SECTION_KEYS } from '@/lib/budget';
import type { ConstructionRate, CityRate } from '@/types/project';
import type { DetailedTakeoffInput, OverrideMap, TakeoffLine } from '@/lib/budget';

// =========================================================
// Contractor take-offs (migration 039).
//
// Stores what the author supplied — geometry inputs and per-BQ-code overrides — and
// recomputes the lines from them. Never stores line rows: they are deterministic given
// inputs + overrides + rate card, and materialising them guarantees drift against the
// engine.
//
// The exception is submission, which freezes a snapshot. See `submitTakeoff`.
// =========================================================

export type TakeoffStatus = 'draft' | 'submitted' | 'accepted' | 'superseded';

export interface ProjectTakeoffRow {
  id: string;
  project_id: string;
  created_by: string;
  inputs: DetailedTakeoffInput;
  overrides: OverrideMap;
  status: TakeoffStatus;
  engine_version: string | null;
  city_code: string | null;
  currency_code: string;
  fx_rate: number | null;
  lines_snapshot: TakeoffLine[] | null;
  sections_snapshot: Record<string, number> | null;
  total_local: number | null;
  note: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Returns [] when the table is absent, so a client ahead of migration 039 degrades. */
export async function fetchTakeoffs(projectId: string): Promise<ProjectTakeoffRow[]> {
  const { data, error } = await supabase
    .from('project_takeoffs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return data ?? [];
}

export async function fetchTakeoff(id: string): Promise<ProjectTakeoffRow | null> {
  const { data, error } = await supabase
    .from('project_takeoffs').select('*').eq('id', id).single<ProjectTakeoffRow>();
  if (error) {
    if (error.code === 'PGRST116' || error.code === '42P01') return null;
    throw error;
  }
  return data;
}

export async function createTakeoff(
  projectId: string,
  userId: string,
  inputs: DetailedTakeoffInput,
  cityCode: string | null,
): Promise<ProjectTakeoffRow> {
  const { data, error } = await supabase
    .from('project_takeoffs')
    .insert({
      project_id: projectId,
      created_by: userId,
      inputs,
      overrides: {},
      status: 'draft',
      engine_version: CM_TAKEOFF.version,
      city_code: cityCode,
    })
    .select()
    .single<ProjectTakeoffRow>();

  if (error) throw error;
  trackEvent('takeoff_created', { project_id: projectId });
  return data;
}

export async function saveDraft(
  id: string,
  patch: { inputs?: DetailedTakeoffInput; overrides?: OverrideMap; note?: string },
): Promise<void> {
  const { error } = await supabase
    .from('project_takeoffs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Freeze the take-off.
 *
 * The snapshot is the point: from here the document must render identically forever, even
 * after Vanessa's re-baseline lands and every rate in the book moves. A contractor who
 * saw their own quotation change after submitting it would never use the tool again.
 */
export async function submitTakeoff(
  id: string,
  priced: { lines: TakeoffLine[]; totalLocal: number; cityRate: CityRate },
  fxRate: number,
): Promise<void> {
  const { error } = await supabase
    .from('project_takeoffs')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lines_snapshot: priced.lines,
      sections_snapshot: sectionsFromLines(priced.lines, SECTION_KEYS),
      total_local: priced.totalLocal,
      city_code: priced.cityRate.city_code,
      currency_code: priced.cityRate.currency_code,
      fx_rate: fxRate,
      engine_version: CM_TAKEOFF.version,
    })
    .eq('id', id);
  if (error) throw error;
  trackEvent('takeoff_submitted', { takeoff_id: id });
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from('project_takeoffs').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Price a take-off row.
 *
 * A submitted row renders from its snapshot; a draft recomputes live. That split is the
 * whole provenance story in one function — call it everywhere rather than reaching for
 * `runTakeoff` directly, or a submitted document will silently re-price.
 */
export function priceTakeoff(
  row: ProjectTakeoffRow,
  rate: ConstructionRate,
): { lines: TakeoffLine[]; totalLocal: number; cityRate: CityRate; frozen: boolean } | null {
  if (row.status !== 'draft' && row.lines_snapshot?.length) {
    const city = (row.city_code && CITY_RATES[row.city_code]) || CITY_RATES.DOUALA;
    return {
      lines: row.lines_snapshot,
      totalLocal: Number(row.total_local ?? 0),
      cityRate: city,
      frozen: true,
    };
  }
  const city = row.city_code
    ? CITY_RATES[row.city_code] ?? resolveCityRate(row.inputs.city, rate.country_code, CITY_RATES)
    : resolveCityRate(row.inputs.city, rate.country_code, CITY_RATES);

  const t = runTakeoff(row.inputs, rate, city, row.overrides);
  if (!t) return null;
  return { lines: t.lines, totalLocal: t.totalLocal, cityRate: t.cityRate, frozen: false };
}
