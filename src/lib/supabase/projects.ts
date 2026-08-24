import { supabase } from './client';
import { getStageSeed } from './stage-seeds';
import { notifyAdmins } from './notifications';
import { trackEvent } from '@/lib/analytics';
import type { WizardFormData, BudgetBreakdown, ProjectFeeRow, ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectTier, PaymentStatus } from '@/types/project';

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
  // Only Jalla Management is gated at creation. Its budget is produced and confirmed by
  // a Jalla admin (admin_start_project_tracking), so the project opens still awaiting
  // tracking and shows a banner.
  //
  // Self Verify and Jalla Verify confirm their budget in the final wizard step, which
  // calls start_project_tracking immediately after this — they are created gated for the
  // instant in between, so a failure there leaves a coherent project rather than one with
  // an active stage and an unconfirmed budget.
  const tier  = formData.tier as ProjectTier;
  const gated = true;

  // 1. Insert project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      user_id:             userId,
      name:                formData.projectName,
      country:             formData.country,
      city:                formData.city || null,
      project_type:        formData.projectType,
      building_type:       formData.buildingType,
      num_floors:          formData.floors,
      sqm:                 formData.sqm,
      finish_level:        formData.finishLevel,
      has_boys_quarters:   formData.hasBoysQuarters,
      bq_rooms:            formData.bqRooms,
      roof_type:           formData.roofType,
      bedrooms:            formData.bedrooms,
      bathrooms:           formData.bathrooms,
      living_rooms:        formData.livingRooms,
      kitchens:            formData.kitchens,
      offices:             formData.offices,
      floor_rooms:         formData.floorRooms.length ? formData.floorRooms : null,
      budget_usd:          budget.total,
      tier,
      status:              'active' as const,
      current_stage:       1,
      target_start:        formData.targetStartDate || null,
      tracking_started_at: gated ? null : new Date().toISOString(),
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
    // Gated projects: every stage starts 'locked' until tracking begins (the RPC
    // activates stage 1 on budget confirmation). Ungated: stage 1 is active now.
    // Milestones come off the CONSTRUCTION fee, not the total. The total also carries the
    // permit, professional and design fees, and none of those are stage work — deriving
    // from it would inflate every milestone by the whole fee stack.
    //
    // Design is the exception: it is an absolute amount rather than a share, so it rides
    // on `fixed_amount_usd` and `budget_pct` stays 0. See migration 036.
    const stageRows = seeds.map(s => ({
      project_id:            project.id,
      stage_number:          s.stage_number,
      // Both are stored: `stage_key` drives translation, `name` stays the English
      // fallback and a human-readable audit trail. See migration 024.
      stage_key:             s.key,
      name:                  s.name,
      budget_pct:            s.budget_pct,
      fixed_amount_usd:      s.key === 'designCompleted' ? budget.design : null,
      payment_milestone_usd: s.key === 'designCompleted'
        ? Math.round(budget.design)
        : Math.round(budget.construction * s.budget_pct / 100),
      status:                (!gated && s.stage_number === 1) ? 'active' : 'locked',
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
      return (seed?.substages ?? []).map((sub, idx) => ({
        stage_id:         stage.id,
        project_id:       project.id,
        substage_number:  idx + 1,
        substage_key:     sub.key,
        name:             sub.name,
        status:           stage.status === 'active' ? 'pending' : 'locked',
      }));
    });

    const { error: substageError } = await supabase
      .from('project_substages')
      .insert(substageRows);

    if (substageError) throw substageError;

    // 5. The two fee milestones that map to no stage.
    // Design rides on the designCompleted stage above; permit and professional do not
    // correspond to site work at all, so they are their own payment lines. See 036.
    const { error: feeError } = await supabase
      .from('project_fees')
      .insert([
        { project_id: project.id, kind: 'permit',       amount_usd: budget.permit       },
        { project_id: project.id, kind: 'professional', amount_usd: budget.professional },
      ]);

    if (feeError) throw feeError;

    // Notify admins (fire-and-forget — never block the wizard redirect)
    notifyAdmins(
      'project_created',
      'New Project Created',
      `"${formData.projectName}" was created`,
      { project_id: project.id },
    ).catch(() => {});

    // Mirror into the CRM. Only the id is sent — the endpoint checks ownership and
    // reads the rest itself, so the browser cannot describe someone else's project.
    // Fire-and-forget for the same reason as the admin notice above: the project is
    // saved, and the wizard must not wait on a CRM.
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch('/api/events?action=crm-project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId: project.id }),
      });
    })().catch(() => { /* mirror only — never blocks the build */ });

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
// archiveProject / restoreProject
//
// Archiving is the reversible one, and it is what frees a plan slot:
// `check_starter_project_limit()` (008) counts projects `WHERE status != 'archived'`,
// so a Self Verify owner at the 3-project cap can archive an old build and start a new
// one without losing anything.
//
// This is deliberately offered ahead of deletion. Someone who has finished a house wants
// it off their dashboard, not erased — and the stage history, payment record and
// documents are the whole point of having used Groundwork.
// =========================================================
export async function archiveProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw error;
  trackEvent('project_archived', { project_id: projectId });
}

export async function restoreProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw error;
  trackEvent('project_restored', { project_id: projectId });
}

// =========================================================
// deleteProject — permanent
//
// RLS already allows this: `owner_all_projects` (003) is FOR ALL. The row's foreign keys
// cascade to stages, substages, documents, messages, audit log, certificates, fees (036)
// and take-offs (039), so the database cleans itself up.
//
// STORAGE DOES NOT CASCADE. A foreign key drops the `project_documents` ROWS and leaves
// the actual files sitting in the bucket forever — invisible, still billed, and still
// containing whatever the owner uploaded. `deleteDocument` removes them one at a time
// (documents.ts:88); nothing did it in bulk until now.
//
// Storage is purged FIRST, deliberately. If the purge fails we stop and the project is
// still there to try again — the reverse order would delete the row and lose the paths,
// leaving files no query can ever find.
// =========================================================
export async function deleteProject(projectId: string): Promise<void> {
  const { data: docs, error: listError } = await supabase
    .from('project_documents')
    .select('file_path')
    .eq('project_id', projectId);

  if (listError) throw listError;

  const paths = (docs ?? [])
    .map(d => (d as { file_path: string }).file_path)
    .filter(Boolean);

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('documents').remove(paths);
    if (storageError) throw storageError;
  }

  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw error;

  trackEvent('project_deleted', { project_id: projectId, documents: paths.length });
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
// fetchProjectFees — the milestones that map to no stage
//
// Permit and professional only. Design lives on the designCompleted stage. Returns []
// rather than throwing when the table is absent, so a client running ahead of migration
// 036 degrades to "no fee lines" instead of a blank payments screen.
// =========================================================
export async function fetchProjectFees(projectId: string): Promise<ProjectFeeRow[]> {
  const { data, error } = await supabase
    .from('project_fees')
    .select('*')
    .eq('project_id', projectId)
    .order('kind');

  if (error) {
    if (error.code === '42P01') return []; // relation does not exist
    throw error;
  }
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

// =========================================================
// updatePaymentStatus
// Updates payment_status on a single project_stage row
// =========================================================
export async function updatePaymentStatus(
  stageId: string,
  status: PaymentStatus,
): Promise<void> {
  const { error } = await supabase
    .from('project_stages')
    .update({ payment_status: status })
    .eq('id', stageId);

  if (error) throw error;
}
