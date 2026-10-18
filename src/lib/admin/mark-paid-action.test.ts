import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * An administrator can actually mark a stage paid.
 *
 * 132 shipped `mark_stage_paid` and nothing called it, so the RPC was live, tested and
 * unreachable — 162 locked stages stayed locked. Groundwork has no payment gateway: the
 * client pays in cash, we never see the transfer, and an admin saying so is the only
 * thing that can open the stage.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const actions = read('src/lib/admin/stage-actions.ts');
const tab     = read('src/components/admin/workspace/StagesTab.tsx');
const lib     = read('src/lib/supabase/payments.ts');

describe('the act is registered like the other six', () => {
  it('it is in the kind union and the list', () => {
    // Not a button bolted on beside the registry: the registry is what decides whether
    // an act is offered and why it is held.
    expect(actions).toMatch(/\| 'mark_paid' \| 'confirm_funding'/);
    expect(actions).toMatch(/'mark_paid', 'confirm_funding'/);
    expect(actions).toMatch(/return \[request, record, approve, rework, markPaid, confirm, authorise\]/);
  });

  it('and it has a label, like every other act', () => {
    expect(tab).toMatch(/mark_paid:\s+'admin\.ledger\.markPaid'/);
  });
});

describe('it is offered only where it changes something', () => {
  it('only on a LOCKED stage', () => {
    expect(actions).toMatch(/stage\.status !== 'locked' \? off\('mark_paid'\)/);
  });

  it('and only when money is still expected on it', () => {
    // A locked stage with nothing owed opens by itself when the previous one completes;
    // a button there would be a no-op dressed as an action.
    expect(actions).toMatch(/tranche\?\.state === 'expected' \? on\('mark_paid'\)\s*\n\s*: off\('mark_paid'\)/);
  });

  it('held, not hidden, when the ledger cannot be read', () => {
    expect(actions).toMatch(/!ctx\.ledgerAvailable \? held\('mark_paid', 'admin\.ledger\.unavailable'\)/);
  });
});

describe('it is confirmed, and says what it will do', () => {
  it('a modal, not a bare click', () => {
    // It settles every outstanding tranche and opens the stage for work.
    expect(tab).toMatch(/open=\{showMarkPaid\}/);
    expect(tab).toMatch(/case 'mark_paid':\s+setShowMarkPaid\(true\); break;/);
  });

  it('and tells the admin whether a receipt was ever filed', () => {
    // Groundwork never sees the transfer, so a receipt is the only evidence there is —
    // and "none on file" is the answer that should give an admin pause.
    expect(tab).toMatch(/receiptCount = ws\.documents\.filter\(d => d\.category === 'receipt'\)\.length/);
    expect(tab).toMatch(/admin\.ledger\.markPaidReceipts/);
    expect(tab).toMatch(/admin\.ledger\.markPaidNoReceipt/);
  });

  it('the copy does not claim Groundwork moves money', () => {
    const body = (en as any).admin.ledger.markPaidBody as string;
    expect(body).toMatch(/does not move money/i);
  });
});

describe('the RPC wrapper reports what actually happened', () => {
  it('it returns whether the stage opened, rather than assuming', () => {
    expect(lib).toMatch(/export async function markStagePaid/);
    expect(lib).toMatch(/opened: r\.opened === true/);
    expect(lib).toMatch(/rpc\('mark_stage_paid'/);
  });
});

describe('every new string exists in both languages', () => {
  it.each(['markPaid', 'markPaidTitle', 'markPaidBody', 'markPaidReceipts', 'markPaidNoReceipt'])('%s', (k) => {
    for (const d of [en, fr]) {
      const v = (d as any).admin.ledger[k];
      expect(typeof v, k).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('and the French is translated, not copied', () => {
    expect((fr as any).admin.ledger.markPaid).toBe('Marquer payée');
  });
});
