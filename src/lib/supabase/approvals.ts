import { supabase } from './client';
import { approveStageRpc } from './verifications';
import { isMissingRpc, requestRework, submitStageForReview } from './activity';
import { notifyAdmins } from './notifications';
import { sendEmail } from '../email/send-email';
import { buildStageApprovedHtml, stageApprovedSubject } from '../email/stage-approved-html';
import { resolveRecipientLang, translate, type TKey } from '@/lib/i18n/translate';
import type { Lang } from '@/lib/i18n/types';
import { buildReworkHtml, reworkSubject } from '../email/rework-requested-html';
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

  // 0. Verify stage has been paid for
  const { data: stageRow, error: stageFetchErr } = await supabase
    .from('project_stages')
    .select('payment_status')
    .eq('id', stageId)
    .single();
  if (stageFetchErr) throw stageFetchErr;
  if (stageRow.payment_status !== 'paid') {
    throw new Error('This stage has not been paid for. Record payment in the Payments tab before approving.');
  }

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
    // jalla_verify: submit stage for admin review — in the database (089), which
    // re-checks the preconditions above and writes the audit row in the same
    // transaction. The direct update is the fallback for a deploy that lands before the
    // migration is pasted; once 089 is live the browser can no longer write an audit row.
    try {
      await submitStageForReview(stageId);
    } catch (err) {
      if (!isMissingRpc(err)) throw err;
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
    }

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

  // self_verify: approve — in the database (087). `approve_stage()` re-checks that the
  // caller owns a Self Verify project, that the stage is paid and every substage complete
  // (the same two checks this function made above, now enforced where they cannot be
  // skipped), completes the stage, activates the next one, advances the project and
  // writes the audit row, all in one transaction. A trigger refuses `status = 'complete'`
  // from anywhere else, so this is no longer a client decision.
  await approveStageRpc(stageId);
  trackEvent('stage_approved', { stage_number: stageNumber, tier });
  void userId;
}

/**
 * Stage name in the recipient's language.
 *
 * Mirrors `useStageLabels()` on the render side: prefer the dictionary entry for the
 * stored `stage_key`, fall back to the English `name` column when the key is NULL (a
 * row migration 024's backfill could not match). Never renders a bare key like
 * `stages.roofing` — an email is not a place to leak an identifier.
 */
function localizeStage(lang: Lang, key: string | null, storedName: string): string {
  if (!key) return storedName;
  const dictKey = `stages.${key}` as TKey;
  const hit = translate(lang, dictKey);
  return hit === dictKey ? storedName : hit;
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
  // Fetch current stage name upfront. `stage_key` (migration 024) is what lets the
  // email render the stage in the owner's language — `name` is the stored English.
  const { data: stageData } = await supabase
    .from('project_stages').select('name, stage_key').eq('id', stageId).single();
  const stageName = stageData?.name ?? `Stage ${stageNumber}`;
  const stageKey  = stageData?.stage_key ?? null;

  // The transition, in the database (087). Refuses `not_verified:` when independent
  // verification is required and the latest decision is not `verified` — an admin cannot
  // approve past an open request or a rejection, whatever this screen shows. Completes
  // the substages, the stage, activates the next, advances the project and writes the
  // audit row with the verification it rested on. Everything below is notification.
  const result = await approveStageRpc(stageId);
  void adminId;

  const isFinalStage = result.isFinal;
  let nextStageName = 'Project Complete';
  let nextStageKey: string | null = null;
  if (result.nextStageId) {
    const { data: nextStage } = await supabase
      .from('project_stages').select('name, stage_key').eq('id', result.nextStageId).single();
    nextStageName = nextStage?.name ?? nextStageName;
    nextStageKey  = nextStage?.stage_key ?? null;
  }

  // Notify homeowner (bell + email)
  const { data: proj } = await supabase
    .from('projects').select('user_id, name, country').eq('id', projectId).single();

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
      supabase.from('profiles')
        .select('full_name, email, preferred_lang')
        .eq('id', proj.user_id).single()
    ).then(async ({ data: profile }) => {
      const ownerName = profile?.full_name ?? 'there';
      // The admin approving this may be reading English; the owner may not be.
      const lang = resolveRecipientLang(profile?.preferred_lang, proj.country);
      const stageLabel = localizeStage(lang, stageKey, stageName);
      const nextLabel  = isFinalStage
        ? translate(lang, 'project.stages.projectComplete')
        : localizeStage(lang, nextStageKey, nextStageName);

      // Issue certificate first so we can include the verify link in the email
      let certId: string | undefined;
      try {
        const certUrl = await issueCertificate({
          projectId,
          stageId,
          stageNumber,
          ownerName,
          projectName: proj.name,
          stageName: stageLabel,
          lang,
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
          stageApprovedSubject(lang, stageLabel),
          buildStageApprovedHtml(lang, {
            ownerName,
            projectName: proj.name,
            stageName: stageLabel,
            nextStageName: nextLabel,
            projectId,
            certificateId: certId,
          }),
          // Heads the note on the owner's GHL contact. Without it every one of these
          // reads as a bare "Email" on the timeline.
          'stage_update',
        ).catch(() => {});
      }
    }).catch(() => {});
  }

  trackEvent('stage_approved', { stage_number: stageNumber, tier: 'jalla_verify', approved_by: 'admin' });
  // The audit row (`stage.approved`, with the verification it rested on) is written by
  // approve_stage() in the same transaction as the change.
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
    .from('project_stages').select('name, stage_key').eq('id', stageId).single();
  const stageName = stageData?.name ?? `Stage ${stageNumber}`;
  const stageKey  = stageData?.stage_key ?? null;

  // Count flagged substages before resetting (for email)
  const { count: flaggedCount } = await supabase
    .from('project_substages')
    .select('*', { count: 'exact', head: true })
    .eq('stage_id', stageId)
    .eq('status', 'pending_review');

  // Reset the stage and its reviewed substages, and write the audit row — one RPC (089).
  // The direct writes remain only as the fallback for a deploy ahead of the migration.
  try {
    await requestRework(stageId, reason);
  } catch (err) {
    if (!isMissingRpc(err)) throw err;
    await supabase.from('project_stages').update({ status: 'active' }).eq('id', stageId);
    await supabase.from('project_substages')
      .update({ status: 'in_progress', approved_by: null, approved_at: null })
      .eq('stage_id', stageId)
      .eq('status', 'pending_review');
    await supabase.from('project_audit_log').insert({
      project_id: projectId, stage_id: stageId,
      action: 'rework_requested', actor_id: adminId,
      details: { stage_number: stageNumber, reason },
    });
  }

  // Notify homeowner (bell + email)
  const { data: proj } = await supabase
    .from('projects').select('user_id, name, country').eq('id', projectId).single();

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
      supabase.from('profiles')
        .select('full_name, email, preferred_lang')
        .eq('id', proj.user_id).single()
    ).then(({ data: profile }) => {
      if (!profile?.email) return;
      const lang = resolveRecipientLang(profile.preferred_lang, proj.country);
      const stageLabel = localizeStage(lang, stageKey, stageName);
      sendEmail(
        profile.email,
        reworkSubject(lang, stageLabel),
        buildReworkHtml(lang, {
          ownerName: profile.full_name ?? 'there',
          projectName: proj.name,
          stageName: stageLabel,
          reworkNote: reason,
          flaggedCount: flaggedCount ?? 0,
          projectId,
        }),
        'stage_update',
      ).catch(() => {});
    }).catch(() => {});
  }

}

// updateSubstageEvidenceUrls is gone (088). It wrote `evidence_urls` straight from the
// browser and had no callers; the evidence index is now written only by
// `submit_site_update()`, in the same transaction as the record of who uploaded what.

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
