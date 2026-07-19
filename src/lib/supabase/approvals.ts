import { supabase } from './client';
import { notifyAdmins } from './notifications';
import { sendEmail } from '../email/send-email';
import { buildStageApprovedHtml } from '../email/stage-approved-html';
import { buildReworkHtml } from '../email/rework-requested-html';
import { issueCertificate } from './certificates';
import { trackEvent } from '@/lib/analytics';

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
  const isStarterTier = tier === 'self_verify' || tier === 'starter';
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
// approveStage (homeowner action)
// self_verify  → immediately marks stage complete, unlocks next
// jalla_verify → submits stage for Jalla admin review + notifies admins
// =========================================================
export async function approveStage(
  projectId: string,
  stageId: string,
  stageNumber: number,
  userId: string,
  tier: string,
): Promise<void> {
  const isSelfVerify = tier === 'self_verify' || tier === 'starter';

  // 1. Verify all substages ready
  const { data: substages, error: subFetchErr } = await supabase
    .from('project_substages')
    .select('status')
    .eq('stage_id', stageId);

  if (subFetchErr) throw subFetchErr;

  const allReady = (substages ?? []).every(s =>
    isSelfVerify
      ? s.status === 'complete'
      : s.status === 'pending_review' || s.status === 'complete',
  );

  if (!allReady) throw new Error('Not all substages are ready for approval.');

  if (!isSelfVerify) {
    // jalla_verify: submit stage for admin review
    const { error } = await supabase
      .from('project_stages')
      .update({ status: 'pending_review' })
      .eq('id', stageId);
    if (error) throw error;

    await supabase.from('project_audit_log').insert({
      project_id: projectId, stage_id: stageId,
      action: 'stage_submitted_for_review', actor_id: userId,
      details: { tier, stage_number: stageNumber },
    });

    // Notify admins (fire-and-forget)
    Promise.all([
      supabase.from('projects').select('name').eq('id', projectId).single(),
      supabase.from('project_stages').select('name').eq('id', stageId).single(),
    ]).then(([{ data: proj }, { data: stageData }]) => {
      notifyAdmins(
        'verification_requested',
        'Stage Verification Requested',
        `${proj?.name ?? 'A project'}: Stage ${stageNumber} (${stageData?.name ?? ''}) submitted for verification`,
        { project_id: projectId, stage_id: stageId, stage_number: stageNumber },
      ).catch(() => {});
    }).catch(() => {});

    return;
  }

  // self_verify: approve immediately
  const { error: stageErr } = await supabase
    .from('project_stages')
    .update({ status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', stageId);

  if (stageErr) throw stageErr;

  // Unlock + activate next stage
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
        .from('project_stages').update({ status: 'active' }).eq('id', nextStage.id);
      if (activateErr) throw activateErr;

      const { error: subUnlockErr } = await supabase
        .from('project_substages').update({ status: 'pending' }).eq('stage_id', nextStage.id);
      if (subUnlockErr) throw subUnlockErr;
    }
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .update({
      current_stage: isFinalStage ? stageNumber : nextStageNumber,
      status:        isFinalStage ? 'completed' : 'active',
    })
    .eq('id', projectId);

  if (projectErr) throw projectErr;

  trackEvent('stage_approved', { stage_number: stageNumber, tier });

  await supabase.from('project_audit_log').insert({
    project_id: projectId, stage_id: stageId,
    action: 'stage_approved', actor_id: userId,
    details: { tier, stage_number: stageNumber },
  });
}

// =========================================================
// adminApproveStage — called by Jalla admin
// Marks stage complete, approves all substages, unlocks next,
// notifies homeowner via bell + email
// =========================================================
export async function adminApproveStage(
  projectId: string,
  stageId: string,
  stageNumber: number,
  adminId: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Fetch current stage name upfront
  const { data: stageData } = await supabase
    .from('project_stages').select('name').eq('id', stageId).single();
  const stageName = stageData?.name ?? `Stage ${stageNumber}`;

  // Mark all pending substages approved
  await supabase
    .from('project_substages')
    .update({ status: 'complete', approved_by: adminId, approved_at: now })
    .eq('stage_id', stageId)
    .neq('status', 'complete');

  // Mark stage complete
  const { error: stageErr } = await supabase
    .from('project_stages')
    .update({ status: 'complete', completed_at: now })
    .eq('id', stageId);
  if (stageErr) throw stageErr;

  // Unlock next stage
  const nextStageNumber = stageNumber + 1;
  const isFinalStage = nextStageNumber > 10;
  let nextStageName = 'Project Complete';

  if (!isFinalStage) {
    const { data: nextStage } = await supabase
      .from('project_stages').select('id, name')
      .eq('project_id', projectId).eq('stage_number', nextStageNumber).single();

    if (nextStage) {
      nextStageName = nextStage.name ?? nextStageName;
      await supabase.from('project_stages').update({ status: 'active' }).eq('id', nextStage.id);
      await supabase.from('project_substages').update({ status: 'pending' }).eq('stage_id', nextStage.id);
    }
  }

  // Update project
  await supabase.from('projects').update({
    current_stage: isFinalStage ? stageNumber : nextStageNumber,
    status:        isFinalStage ? 'completed' : 'active',
  }).eq('id', projectId);

  // Notify homeowner (bell + email)
  const { data: proj } = await supabase
    .from('projects').select('user_id, name').eq('id', projectId).single();

  if (proj) {
    await supabase.from('notifications').insert({
      user_id: proj.user_id,
      type: 'stage_approved',
      title: 'Stage approved',
      body: `Stage ${stageNumber} of "${proj.name}" has been approved by Jalla.`,
      data: { project_id: projectId, stage_number: stageNumber },
    });

    // Send email + issue certificate (fire-and-forget — never block the approval)
    Promise.resolve(
      supabase.from('profiles').select('full_name, email').eq('id', proj.user_id).single()
    ).then(async ({ data: profile }) => {
      const ownerName = profile?.full_name ?? 'there';

      // Issue certificate first so we can include the verify link in the email
      let certId: string | undefined;
      try {
        const certUrl = await issueCertificate({
          projectId,
          stageId,
          stageNumber,
          ownerName,
          projectName: proj.name,
          stageName,
        });
        // Extract the UUID from the end of the storage path via the cert record
        const certRecord = await supabase
          .from('certificates')
          .select('id')
          .eq('stage_id', stageId)
          .maybeSingle();
        certId = certRecord.data?.id;
        void certUrl;
      } catch { /* non-fatal */ }

      // Email
      if (profile?.email) {
        sendEmail(
          profile.email,
          `Stage Approved: ${stageName}`,
          buildStageApprovedHtml(ownerName, proj.name, stageName, nextStageName, projectId, certId),
        ).catch(() => {});
      }
    }).catch(() => {});
  }

  trackEvent('stage_approved', { stage_number: stageNumber, tier: 'jalla_verify', approved_by: 'admin' });

  await supabase.from('project_audit_log').insert({
    project_id: projectId, stage_id: stageId,
    action: 'stage_approved_by_admin', actor_id: adminId,
    details: { stage_number: stageNumber },
  });
}

// =========================================================
// adminRequestRework — called by Jalla admin
// Sends stage back to homeowner with a reason,
// notifies via bell + email
// =========================================================
export async function adminRequestRework(
  projectId: string,
  stageId: string,
  stageNumber: number,
  adminId: string,
  reason: string,
): Promise<void> {
  // Fetch stage name
  const { data: stageData } = await supabase
    .from('project_stages').select('name').eq('id', stageId).single();
  const stageName = stageData?.name ?? `Stage ${stageNumber}`;

  // Count flagged substages before resetting (for email)
  const { count: flaggedCount } = await supabase
    .from('project_substages')
    .select('*', { count: 'exact', head: true })
    .eq('stage_id', stageId)
    .eq('status', 'pending_review');

  // Reset stage to active
  await supabase.from('project_stages').update({ status: 'active' }).eq('id', stageId);

  // Reset pending_review substages to in_progress
  await supabase.from('project_substages')
    .update({ status: 'in_progress', approved_by: null, approved_at: null })
    .eq('stage_id', stageId)
    .eq('status', 'pending_review');

  // Notify homeowner (bell + email)
  const { data: proj } = await supabase
    .from('projects').select('user_id, name').eq('id', projectId).single();

  if (proj) {
    await supabase.from('notifications').insert({
      user_id: proj.user_id,
      type: 'stage_rework_requested',
      title: 'Changes requested',
      body: `Jalla has requested changes for Stage ${stageNumber} of "${proj.name}": ${reason}`,
      data: { project_id: projectId, stage_number: stageNumber, reason },
    });

    // Send email (fire-and-forget)
    Promise.resolve(
      supabase.from('profiles').select('full_name, email').eq('id', proj.user_id).single()
    ).then(({ data: profile }) => {
      if (!profile?.email) return;
      sendEmail(
        profile.email,
        `Rework Requested: ${stageName}`,
        buildReworkHtml(
          profile.full_name ?? 'there',
          proj.name,
          stageName,
          reason,
          flaggedCount ?? 0,
          projectId,
        ),
      ).catch(() => {});
    }).catch(() => {});
  }

  await supabase.from('project_audit_log').insert({
    project_id: projectId, stage_id: stageId,
    action: 'rework_requested', actor_id: adminId,
    details: { stage_number: stageNumber, reason },
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
