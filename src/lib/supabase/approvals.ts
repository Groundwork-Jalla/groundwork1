import { supabase } from './client';

// =========================================================
// markSubstageComplete
// Tier fork: starter → complete immediately
//            pro / enterprise → pending_review (admin reviews)
// =========================================================
export async function markSubstageComplete(
  substageId: string,
  tier: string,
  userId: string,
): Promise<void> {
  const isStarterTier = tier === 'starter';
  const newStatus = isStarterTier ? 'complete' : 'pending_review';

  const { error } = await supabase
    .from('project_substages')
    .update({
      status:      newStatus,
      approved_by: isStarterTier ? userId : null,
      approved_at: isStarterTier ? new Date().toISOString() : null,
    })
    .eq('id', substageId);

  if (error) throw error;
}

// =========================================================
// approveStage
// 1. Verify all substages are ready
// 2. Mark current stage complete
// 3. Unlock + activate next stage and its substages
// 4. Update project.current_stage (and status if final stage)
// 5. Log to audit trail
// =========================================================
export async function approveStage(
  projectId: string,
  stageId: string,
  stageNumber: number,
  userId: string,
  tier: string,
): Promise<void> {
  // 1. Verify all substages ready
  const { data: substages, error: subFetchErr } = await supabase
    .from('project_substages')
    .select('status')
    .eq('stage_id', stageId);

  if (subFetchErr) throw subFetchErr;

  const allReady = (substages ?? []).every(s =>
    tier === 'starter'
      ? s.status === 'complete'
      : s.status === 'pending_review' || s.status === 'complete',
  );

  if (!allReady) throw new Error('Not all substages are ready for approval.');

  // 2. Mark current stage complete
  const { error: stageErr } = await supabase
    .from('project_stages')
    .update({ status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', stageId);

  if (stageErr) throw stageErr;

  // 3. Unlock + activate next stage
  const nextStageNumber = stageNumber + 1;
  const isFinalStage = nextStageNumber > 10;

  if (!isFinalStage) {
    const { data: nextStage, error: nextFetchErr } = await supabase
      .from('project_stages')
      .select('id')
      .eq('project_id', projectId)
      .eq('stage_number', nextStageNumber)
      .single();

    if (nextFetchErr) throw nextFetchErr;

    if (nextStage) {
      const { error: activateErr } = await supabase
        .from('project_stages')
        .update({ status: 'active' })
        .eq('id', nextStage.id);

      if (activateErr) throw activateErr;

      // Unlock substages of next stage
      const { error: subUnlockErr } = await supabase
        .from('project_substages')
        .update({ status: 'pending' })
        .eq('stage_id', nextStage.id);

      if (subUnlockErr) throw subUnlockErr;
    }
  }

  // 4. Update project lifecycle
  const { error: projectErr } = await supabase
    .from('projects')
    .update({
      current_stage: isFinalStage ? stageNumber : nextStageNumber,
      status:        isFinalStage ? 'completed' : 'active',
    })
    .eq('id', projectId);

  if (projectErr) throw projectErr;

  // 5. Audit log
  await supabase
    .from('project_audit_log')
    .insert({
      project_id: projectId,
      stage_id:   stageId,
      action:     'stage_approved',
      actor_id:   userId,
      details:    { tier, stage_number: stageNumber },
    });
}

// =========================================================
// updateSubstageEvidenceUrls
// Appends or replaces the evidence_urls array on a substage
// =========================================================
export async function updateSubstageEvidenceUrls(
  substageId: string,
  urls: string[],
): Promise<void> {
  const { error } = await supabase
    .from('project_substages')
    .update({ evidence_urls: urls })
    .eq('id', substageId);

  if (error) throw error;
}

// =========================================================
// getSignedEvidenceUrl — 1-hour signed URL for display
// =========================================================
export async function getSignedEvidenceUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
