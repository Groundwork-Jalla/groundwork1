import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The two screens of the receipt handshake (175, readable since 176).
 *
 * One conversation seen from two sides. The failure this guards against is the two
 * sides drifting: the client is told to upload a receipt the contractor's screen has
 * no box for, or the contractor is shown a Confirm button for a receipt that was never
 * asked for. Each screen looks correct on its own, and the build quietly stops.
 */

const gate       = readFileSync('src/components/project/StagePaymentGate.tsx', 'utf8');
const tracker    = readFileSync('src/components/project/StageTracker.tsx', 'utf8');
const clientPage = readFileSync('src/app/routes/projects/detail.tsx', 'utf8');
const workPage   = readFileSync('src/app/routes/work/projects.detail.tsx', 'utf8');
const lib        = readFileSync('src/lib/supabase/verifications.ts', 'utf8');
const rls        = readFileSync('supabase/migrations/176_both_sides_can_see_the_receipt.sql', 'utf8');

describe('both sides can actually read the row they act on', () => {
  it('the client and the contractor are given a read on incoming payments', () => {
    /**
     * `payments` admitted three readers since 090 — admin, project OWNER, outgoing
     * beneficiary — and on a contractor-run build the invited client is not the owner
     * and the contractor is not the beneficiary of an INCOMING tranche. Without 176
     * both functions work and both screens are blank, in the ordinary way an empty
     * list is blank, with nothing to say a policy was the reason.
     */
    expect(rls).toMatch(/CREATE POLICY "client_read_incoming_payments"/);
    expect(rls).toMatch(/CREATE POLICY "contractor_read_incoming_payments"/);
  });

  it('scoped to incoming only, so neither sees the payout ledger', () => {
    // A contractor must not see another contractor's release, and the invited client
    // must not see what Jalla pays whom on a build they do not own.
    const client = rls.slice(rls.indexOf('"client_read_incoming_payments"'));
    expect(client.slice(0, 300)).toMatch(/USING \(direction = 'in' AND public\.is_project_client\(project_id\)\)/);
    const contractor = rls.slice(rls.indexOf('"contractor_read_incoming_payments"'));
    expect(contractor.slice(0, 300)).toMatch(/USING \(direction = 'in' AND public\.is_contractor_on\(project_id, auth\.uid\(\)\)\)/);
  });

  it('and still nobody may write: every change goes through an RPC', () => {
    expect(rls).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });
});

describe('the gate is mounted on a locked stage, on both surfaces', () => {
  it('the client surface, through the shared tracker', () => {
    expect(tracker).toMatch(/<StagePaymentGate/);
    // On the locked branch: that is the stage the client has just been asked to pay for.
    expect(tracker).toContain('canUpload={paymentEnabled}');
    expect(tracker).toContain('readOnly={!isContractor && !canApprove}');
    expect(clientPage).toMatch(/payments=\{payments\}/);
    expect(clientPage).toMatch(/fetchStagePayments\(id\)/);
  });

  it('the contractor surface, on its own stage row', () => {
    expect(workPage).toMatch(/<StagePaymentGate/);
    expect(workPage).toMatch(/isContractor\s*\n?\s*onChanged=\{onSubmitted\}/);
    expect(workPage).toMatch(/fetchStagePayments\(projectId\)/);
  });

  it('and reloads the build afterwards, because confirming opens a stage', () => {
    // The confirmation changes the whole list, not one row.
    expect(gate).toMatch(/onChanged: \(\) => void \| Promise<void>/);
    expect(clientPage).toMatch(/onPaymentChanged=\{loadAll\}/);
  });
});

describe('the data layer keeps the two directions apart', () => {
  it('fetchStagePayments reads incoming only', () => {
    const fn = lib.slice(lib.indexOf('export async function fetchStagePayments'));
    expect(fn).toMatch(/\.eq\('direction', 'in'\)/);
  });

  it('and never throws a build off the screen over a ledger', () => {
    const fn = lib.slice(lib.indexOf('export async function fetchStagePayments'));
    expect(fn).toMatch(/if \(error \|\| !data\) return out;/);
  });

  it('the contractor page keeps its own outgoing ledger separate', () => {
    // `payments` on that page is the contractor's OWN payouts — opposite direction,
    // opposite person. Reusing the name would have been a silent mix-up.
    expect(workPage).toMatch(/const \[stagePayments, setStagePayments\]/);
  });
});

describe('every string the screens use is translated', () => {
  const keys = [
    'receiptTitle', 'receiptBody', 'receiptChoose', 'receiptUploading', 'receiptSent',
    'receiptFailed', 'confirmTitle', 'confirmBody', 'confirmView', 'confirmAction',
    'confirmWorking', 'confirmFailed', 'awaitingReceipt',
  ];
  it.each(keys)('project.stages.%s', key => {
    for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
      const hit = lookup(dict as never, `project.stages.${key}`);
      expect(typeof hit === 'string' && hit.length > 0, `${key} missing in ${lang}`).toBe(true);
    }
  });
});
