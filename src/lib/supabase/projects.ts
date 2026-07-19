import { supabase } from './client';
import { getStageSeed } from './stage-seeds';
import { notifyAdmins } from './notifications';
import { trackEvent } from '@/lib/analytics';
import type { WizardFormData, BudgetBreakdown, ProjectRow, ProjectStageRow, ProjectSubstageRow } from '@/types/project';

// =========================================================
// createProject
// Inserts: project → stages (per project type) → substages
// Rolls back by deleting the project (CASCADE) on any failure.
// =========================================================
export async function createProject(
  userId: string,
  formData: WizardFormData,
  budget: BudgetBreakdown,
): Promise<ProjectRow> {
  // 1. Insert project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      user_id:           userId,
      name:              formData.projectName,
      country:           formData.country,
      city:              formData.city || null,
      project_type:      formData.projectType,
      building_type:     formData.buildingType,
      num_floors:        formData.floors,
      sqm:               formData.sqm,
      finish_level:      formData.finishLevel,
      has_boys_quarters: formData.hasBoysQuarters,
      bq_rooms:          formData.bqRooms,
      roof_type:         formData.roofType,
      bedrooms:          formData.bedrooms,
      bathrooms:         formData.bathrooms,
      living_rooms:      formData.livingRooms,
      kitchens:          formData.kitchens,
      floor_rooms:       formData.floorRooms.length ? formData.floorRooms : null,
      budget_usd:        budget.total,
      tier:              formData.tier,
      status:            'active' as const,
      current_stage:     1,
      target_start:      formData.targetStartDate || null,
    })
    .select()
    .single<ProjectRow>();

  if (projectError) throw projectError;

  try {
    // 2. Get the stage definitions for this project type
    const seeds = getStageSeed(
      formData.projectType!,
      formData.buildingType!,
      formData.floors,
    );

    // 3. Insert stages
    const stageRows = seeds.map(s => ({
      project_id:            project.id,
      stage_number:          s.stage_number,
      name:                  s.name,
      budget_pct:            s.budget_pct,
      payment_milestone_usd: Math.round(budget.total * s.budget_pct / 100),
      status:                s.stage_number === 1 ? 'active' : 'locked',
      payment_status:        'unpaid',
    }));

    const { data: insertedStages, error: stageError } = await supabase
      .from('project_stages')
      .insert(stageRows)
      .select();

    if (stageError) throw stageError;

    // 4. Insert substages for each stage
    const substageRows = insertedStages.flatMap(stage => {
      const seed = seeds.find(s => s.stage_number === stage.stage_number);
      return (seed?.substages ?? []).map((name, idx) => ({
        stage_id:         stage.id,
        project_id:       project.id,
        substage_number:  idx + 1,
        name,
        status:           stage.status === 'active' ? 'pending' : 'locked',
      }));
    });

    const { error: substageError } = await supabase
      .from('project_substages')
      .insert(substageRows);

    if (substageError) throw substageError;

    // Notify admins (fire-and-forget — never block the wizard redirect)
    notifyAdmins(
      'project_created',
      'New Project Created',
      `"${formData.projectName}" was created`,
      { project_id: project.id },
    ).catch(() => {});

    trackEvent('project_created', {
      project_type: formData.projectType,
      country: formData.country,
      tier: formData.tier,
    });

    return project;
  } catch (err) {
    // Cleanup — CASCADE deletes stages and substages automatically
    await supabase.from('projects').delete().eq('id', project.id);
    throw err;
  }
}

// =========================================================
// fetchProject — user-scoped via RLS
// =========================================================
export async function fetchProject(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single<ProjectRow>();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

// =========================================================
// fetchProjectStages — ordered by stage_number
// =========================================================
export async function fetchProjectStages(projectId: string): Promise<ProjectStageRow[]> {
  const { data, error } = await supabase
    .from('project_stages')
    .select('*')
    .eq('project_id', projectId)
    .order('stage_number');

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// fetchProjectSubstages — ordered by substage_number
// =========================================================
export async function fetchProjectSubstages(projectId: string): Promise<ProjectSubstageRow[]> {
  const { data, error } = await supabase
    .from('project_substages')
    .select('*')
    .eq('project_id', projectId)
    .order('substage_number');

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// fetchProjects — all projects for a user
// =========================================================
export async function fetchProjects(userId: string): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}


// =========================================================
// fetchContractorProjects — projects a contractor is invited to
// =========================================================
export async function fetchContractorProjects(userId: string): Promise<ProjectRow[]> {
  const { data: invites, error: inviteError } = await supabase
    .from('contractor_invites')
    .select('project_id')
    .eq('contractor_user_id', userId)
    .eq('status', 'accepted');

  if (inviteError) throw inviteError;
  if (!invites?.length) return [];

  const projectIds = invites.map((i) => i.project_id as string);

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
