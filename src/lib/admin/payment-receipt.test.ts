import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

// Uploads, amounts and acknowledgment are exercised by receipt-amount-screen and
// receipt-payout-screen. These assertions protect the live screens' integration.
describe('the mounted receipt and approval flow', () => {
  it('uses the stage receipt handshake and actual payout summary', () => {
    expect(read('src/components/project/StageTracker.tsx')).toContain('<StagePaymentGate');
    expect(read('src/components/project/OverviewTab.tsx')).toContain('<ProjectPayoutSummary');
    expect(read('src/app/routes/projects/detail.tsx')).not.toContain('<ProjectPaymentsLedger');
  });
  it('records an actual amount and file, and gives the contractor an acknowledgment action', () => {
    const gate = read('src/components/project/StagePaymentGate.tsx');
    expect(gate).toContain('uploadStagePaymentReceipt(projectId, stageId, file, { amount, currency: code, fxRate })');
    expect(gate).toContain('confirmStagePayment(stageId, undefined, { path: payment!.receiptPath!');
    expect(gate).toContain('receiptAmountInvalid');
    expect(gate).toContain('receiptFileRequired');
  });
  it('client sign-off says approval in every tier', () => {
    const row = read('src/components/project/SubstageRow.tsx');
    expect(row).toContain("t('project.stages.approveEvidence')");
    expect(row).not.toContain("t('project.stages.markReady')");
    for (const dict of [en, fr]) {
      expect(dict.project.stages.approveEvidence.length).toBeGreaterThan(0);
      expect(dict.project.review.approved.length).toBeGreaterThan(0);
    }
    expect(en.project.stages.approveEvidence).toBe('Approve updates');
    expect(fr.project.stages.approveEvidence).not.toBe(en.project.stages.approveEvidence);
  });
});
