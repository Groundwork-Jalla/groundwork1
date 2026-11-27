import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/20261128000000_undo_contractor_stage_verification.sql'),
  'utf8',
);
const bar = readFileSync(
  join(ROOT, 'src/components/project/ContractorPaymentVerificationBar.tsx'),
  'utf8',
);
const gate = readFileSync(
  join(ROOT, 'src/components/project/StagePaymentGate.tsx'),
  'utf8',
);
const detail = readFileSync(
  join(ROOT, 'src/app/routes/work/projects.detail.tsx'),
  'utf8',
);
const projectsList = readFileSync(
  join(ROOT, 'src/app/routes/work/projects.tsx'),
  'utf8',
);
const helper = readFileSync(
  join(ROOT, 'src/lib/supabase/contractor-payments.ts'),
  'utf8',
);

describe('contractor-recorded stage payment edit, partial payments, undo & project deletion', () => {
  it('supports full vs partial payments without overload ambiguity and defines undo RPC', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_partial boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stage_total_amount numeric\(24,6\)/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.record_contractor_stage_verification\(uuid,\s*numeric,\s*text,\s*numeric,\s*text\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_contractor_stage_verification/);
    expect(sql).toMatch(/p_is_partial\s+boolean\s+DEFAULT false/);
    expect(sql).toMatch(/p_stage_total\s+numeric\s+DEFAULT NULL/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_contractor_stage_verification\(uuid,\s*numeric,\s*text,\s*numeric,\s*text,\s*boolean,\s*numeric\)\s+TO authenticated/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.clear_contractor_stage_verification/);
    expect(sql).toMatch(/is_primary_project_contractor/);
    expect(sql).toMatch(/stage_completed/);
    expect(sql).toMatch(/DELETE FROM public\.contractor_stage_verifications/);
    expect(sql).toMatch(/array_remove\(covered_stages,\s*v_stage\.stage_number\)/);
    expect(sql).toMatch(/stage\.contractor_payment_cleared/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.clear_contractor_stage_verification\(uuid\)\s+TO authenticated/);
    const breakdownEditableBody = sql.match(/CREATE OR REPLACE FUNCTION public\.stage_breakdown_editable[\s\S]*?\$\$/)?.[0] ?? '';
    expect(breakdownEditableBody).toMatch(/CREATE OR REPLACE FUNCTION public\.stage_breakdown_editable/);
    expect(breakdownEditableBody).not.toMatch(/jsonb_array_length\(sub\.evidence_urls\)/);
  });

  it('defines safe delete_own_contractor_project RPC scoped to contractor-created projects without activity', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_own_contractor_project/);
    expect(sql).toMatch(/workflow_origin.*<>.*'contractor'/);
    expect(sql).toMatch(/project_has_activity/);
    expect(sql).toMatch(/INSERT INTO public\.admin_deleted_projects/);
    expect(sql).toMatch(/DELETE FROM public\.projects WHERE id = p_project_id/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_own_contractor_project\(uuid\)\s+TO authenticated/);
  });

  it('exposes partial payment fields, undo, and deleteOwnContractorProject in contractor-payments helper', () => {
    expect(helper).toContain('is_partial?: boolean');
    expect(helper).toContain('stage_total_amount?: number | null');
    expect(helper).toContain('p_is_partial: isPartial');
    expect(helper).toContain('p_stage_total: hasStageTotal ? input.stageTotal : null');
    expect(helper).toContain('export async function clearContractorStageVerification');
    expect(helper).toContain("supabase.rpc('clear_contractor_stage_verification'");
    expect(helper).toContain('export async function deleteOwnContractorProject');
    expect(helper).toContain("supabase.rpc('delete_own_contractor_project'");
    expect(helper).toContain('verifiedByStage');
  });

  it('lets contractors choose full vs partial payment, compute remaining balance, edit, or undo', () => {
    expect(bar).toContain('data-action="payment-mode-full"');
    expect(bar).toContain('data-action="payment-mode-partial"');
    expect(bar).toContain('data-input="partial-paid-amount"');
    expect(bar).toContain('data-input="partial-stage-total"');
    expect(bar).toContain('data-partial-remaining-preview');
    expect(bar).toContain('data-contractor-partial-breakdown');
    expect(bar).toContain('data-action="edit-contractor-payment"');
    expect(bar).toContain('data-action="undo-contractor-payment"');
    expect(bar).toContain('data-action="confirm-undo-contractor-payment"');
    expect(bar).toContain('clearContractorStageVerification(stageId)');
  });

  it('shows real remaining balance on partial offline payments in StagePaymentGate and Work tab', () => {
    expect(gate).toContain('contractorPartialVerification');
    expect(gate).toContain('data-contractor-partial-summary');
    expect(detail).toContain('showGate && (!stagePaidUpfront || isRowPaidUpfront(stage)) && stage.status !== \'complete\'');
    expect(detail).toContain('verifiedEntry?.isPartial === true');
    expect(detail).toContain('data-stage-partial-remaining');
    expect(detail).toContain('data-action="set-stage-price"');
    expect(detail).toContain("canConfirmPayments && !stage.pre_existing && stage.status !== 'complete' && !stagePaidUpfront");
  });

  it('locks recorded payment edits & undo once uploaded evidence is approved by the Homeowner', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).toMatch(/payment_locked_after_approval/);
    expect(sql).toMatch(/v_evidence_approved/);
    expect(sql).toMatch(/coalesce\(jsonb_array_length\(sub\.evidence_urls\),\s*0\)\s*>\s*0/);
    expect(bar).toContain('lockedAfterApproval?: boolean');
    expect(bar).toContain('data-payment-locked-after-approval');
    expect(detail).toContain('stageEvidenceApproved');
    expect(detail).toContain('lockedAfterApproval={stageEvidenceApproved}');
  });

  it('enables substage cost breakdown on Stage 1 and Stage 2 even when starting at 0', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).toMatch(/s\.stage_number IN \(1, 2\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.propose_stage_breakdown/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.decide_stage_breakdown/);
    expect(detail).toContain('stagePayableUsd(stage, basis) > 0 || stage.stage_number <= 2');
  });

  it('offers safe contractor project delete (with archive fallback) on both /work/projects and /work/projects/:id', () => {
    expect(detail).toContain('data-contractor-project-manage');
    expect(detail).toContain('data-action="delete-contractor-project"');
    expect(detail).toContain('data-action="archive-contractor-project"');
    expect(detail).toContain('deleteOwnContractorProject(project.id)');
    expect(projectsList).toContain('data-action="delete-contractor-project"');
    expect(projectsList).toContain('deleteOwnContractorProject(deleteTarget.project.id)');
  });
});
