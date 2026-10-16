import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * A reported payment can carry its receipt.
 *
 * There is no payment gateway. The client pays in cash, Groundwork never sees the
 * transfer, and an administrator marking the stage paid (132) is working purely from
 * having been told — a decision that opens a stage of work. The receipt is the only
 * evidence that exists, and until now there was nowhere to put it.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ledger = read('src/components/project/ProjectPaymentsLedger.tsx');
const row    = read('src/components/project/SubstageRow.tsx');

describe('the receipt reaches somewhere an admin can see it', () => {
  it('filed as a project document with category receipt', () => {
    // Not a private column on the payments table: the client, the contractor and the
    // admin can all already read project documents.
    expect(ledger).toMatch(/uploadDocument\(project\.id, userId, receipt, undefined, 'receipt'\)/);
  });

  it('on the component that is actually mounted', () => {
    /**
     * `ProjectPayments.tsx` also has a report flow and nothing renders it — the client's
     * Payments tab uses the ledger. A receipt added to the dead one would have tested
     * green and done nothing.
     */
    const detail = read('src/app/routes/projects/detail.tsx');
    expect(detail).toMatch(/<ProjectPaymentsLedger/);
  });

  it('uploaded BEFORE the notification, so it never claims one that failed', () => {
    const fn = ledger.slice(ledger.indexOf('async function report()'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body.indexOf('uploadDocument')).toBeLessThan(body.indexOf('notifyAdmins'));
  });

  it('and the admin is told either way', () => {
    expect(ledger).toMatch(/receipt attached\./);
    expect(ledger).toMatch(/no receipt attached\./);
    expect(ledger).toMatch(/receipt_document_id: documentId/);
  });
});

describe('it is optional, and a bad file is named', () => {
  it('reporting still works with no receipt', () => {
    // Somebody who paid at a bank counter may have nothing to photograph yet; refusing
    // would leave the stage shut with no way to say they paid.
    expect(ledger).toMatch(/if \(receipt && userId\)/);
    expect(ledger).not.toMatch(/disabled=\{reporting \|\| !receipt\}/);
  });

  it('an oversized or wrong-type file says which rule it broke', () => {
    expect(ledger).toMatch(/project\.documents\.tooLarge/);
    expect(ledger).toMatch(/project\.documents\.badType/);
  });

  it('a failed upload surfaces instead of silently reporting', () => {
    expect(ledger).toMatch(/catch \(err\) \{[\s\S]{0,120}setReceiptError/);
  });
});

describe('the sign-off button says what it actually does', () => {
  it('self-verified clients approve their own evidence', () => {
    // "Mark ready for review" implies a reviewer. On self_verify there is none — the
    // client is signing off their own evidence.
    expect(row).toMatch(/tier === 'self_verify' \? t\('project\.stages\.approveEvidence'\)/);
  });

  it('and a project with a real verifier still says ready for review', () => {
    expect(row).toMatch(/t\('project\.stages\.markReady'\)/);
  });

  it('both wordings exist in both languages', () => {
    for (const d of [en, fr]) {
      const st = (d as any).project.stages;
      for (const k of ['markReady', 'approveEvidence', 'markComplete']) {
        expect(typeof st[k], k).toBe('string');
        expect(st[k].length).toBeGreaterThan(0);
      }
    }
    expect((fr as any).project.stages.approveEvidence)
      .not.toBe((en as any).project.stages.approveEvidence);
  });
});
