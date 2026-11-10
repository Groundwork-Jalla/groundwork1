import { supabase } from './client';
import { projectBudget } from '@/lib/budget';
import { stageSharesFromTakeoff } from '@/lib/budget/stage-shares';
import { planReprice, repriceBalances, type RepricePlan, type RepriceStage } from '@/lib/budget/reprice';
import { getConstructionRate } from './construction-rates';
import type { CityRate, ProjectRow, WizardFormData } from '@/types/project';

// =========================================================
// Re-pricing a live project from its own take-off.
//
// Reads, computes, shows. Nothing here writes until `applyReprice` is called with a plan
// an administrator has actually looked at — see 184 for why the preview and the write
// are deliberately two steps.
// =========================================================

export class RepriceUnavailable extends Error {
  constructor(public reason: 'no_takeoff' | 'no_budget' | 'nothing_to_change' | 'does_not_balance') {
    super(reason);
  }
}

export interface RepricePreview {
  plan: RepricePlan;
  /** The fee the whole split is a percentage of. */
  construction: number;
  projectName: string;
}

/**
 * The shape the budget engine prices from, read off a stored project.
 *
 * The same fields `projectBudget` maps, because the shares and the construction fee they
 * will be multiplied by have to come from one take-off of one building.
 */
function takeoffInput(project: ProjectRow): Partial<WizardFormData> {
  return {
    country:         project.country,
    city:            project.city ?? undefined,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  };
}

/**
 * What a re-price WOULD do to this project. Writes nothing.
 *
 * Throws `RepriceUnavailable` rather than returning an empty plan, because the four
 * reasons it cannot run are four different things to tell an administrator and only one
 * of them ("nothing to change") means the project is already correct.
 */
export async function previewReprice(
  projectId: string,
  cityRate?: CityRate | null,
): Promise<RepricePreview> {
  const [{ data: project, error: pErr }, { data: stages, error: sErr }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).single<ProjectRow>(),
    supabase.from('project_stages')
      .select('id, stage_number, stage_key, budget_pct, payment_milestone_usd, fixed_amount_usd, payment_status, status, pre_existing')
      .eq('project_id', projectId)
      .order('stage_number', { ascending: true }),
  ]);
  if (pErr) throw pErr;
  if (sErr) throw sErr;
  if (!project) throw new RepriceUnavailable('no_budget');

  const rate = await getConstructionRate(project.country).catch(() => null);
  const input = takeoffInput(project);

  const shares = stageSharesFromTakeoff(input, rate, cityRate);
  // No take-off model for this country, or not enough of the building is known to price
  // it. There is nothing to read a split out of, and a re-price to the national average
  // it already has would be a no-op dressed as a fix.
  if (!shares) throw new RepriceUnavailable('no_takeoff');

  // The confirmed total is authoritative, exactly as `projectBudget` treats it: an owner
  // who edited their budget is re-cut against THEIR number, not against a fresh estimate.
  const construction = projectBudget(project, rate, cityRate).construction;
  if (!(construction > 0)) throw new RepriceUnavailable('no_budget');

  const plan = planReprice((stages ?? []) as RepriceStage[], construction, shares);
  if (plan.changes.length === 0) throw new RepriceUnavailable('nothing_to_change');
  // Refused rather than shown. A preview whose column does not add up to the construction
  // fee is the defect this feature exists to remove, and an administrator should never be
  // asked to approve one.
  if (!repriceBalances(plan, construction)) throw new RepriceUnavailable('does_not_balance');

  return { plan, construction, projectName: project.name };
}

/**
 * Write the plan. 184 re-checks every row and refuses anything settled.
 *
 * Takes the PLAN rather than a project id, so what is written is what was previewed and
 * not a second computation that might have drifted.
 */
export async function applyReprice(
  projectId: string, plan: RepricePlan,
): Promise<{ written: number; refused: number }> {
  const { data, error } = await supabase.rpc('reprice_project_stages', {
    p_project: projectId,
    p_rows: plan.changes,
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    written: typeof r.stages_written === 'number' ? r.stages_written : 0,
    refused: typeof r.stages_refused === 'number' ? r.stages_refused : 0,
  };
}
