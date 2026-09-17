import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPaymentEvents } from '@/lib/supabase/payments';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step 5b.1 — the Financials tab.
 *
 * Six sections in the order of 05 §10, every figure from `ws.financials`, every act one
 * of the three ledger RPCs through the extracted modal, the custody rule in the words,
 * `payment_status` shown only here and labelled — and never read by anything that
 * decides. The runner has no DOM; the shape is pinned as source, the words as keys.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const TAB = 'src/components/admin/workspace/FinancialsTab.tsx';
const WS_DIR = 'src/components/admin/workspace';

describe('the six sections, in order', () => {
  it('renders funding, releases, disbursements, compensation, reconciliation, then budget', () => {
    const c = code(TAB);
    const order = [
      "t('admin.ledger.funding')",
      "t('admin.ledger.releases')",
      "t('admin.workspace.financials.disbursements')",
      "t('admin.workspace.financials.compensation')",
      "t('admin.workspace.financials.reconciliation')",
      '<BudgetSection ws={ws} />',
    ];
    let last = -1;
    for (const marker of order) {
      const at = c.lastIndexOf(marker);
      expect(at, `missing ${marker}`).toBeGreaterThan(-1);
      expect(at, `${marker} out of order`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('compensation is a header and an honest empty state — nothing computed, no rate', () => {
    const c = code(TAB);
    expect(c).toContain("t('admin.workspace.financials.compensationEmpty')");
    expect(c).not.toMatch(/commission|0\.\d+\s*\*|\* 0\.\d+|percent/i);
    expect(lookup(en, 'admin.workspace.financials.compensationEmpty')).toMatch(/not modelled/i);
  });
});

describe('figures and acts come from the model and the ledger, nowhere else', () => {
  it('every figure is ws.financials', () => {
    const c = code(TAB);
    for (const f of ['fin.budgetUsd', 'fin.funded', 'fin.availableFunds', 'fin.authorised', 'fin.inFlight', 'fin.disbursed', 'fin.payments', 'ws.financials.fees']) {
      expect(c, f).toContain(f);
    }
    expect(c).not.toContain('availableFunds(');
    expect(c).not.toContain('reduce(');   // no sums of its own
  });

  it('acts go through LedgerModal only; the tab itself calls no RPC and reads no table', () => {
    const c = code(TAB);
    expect(c).toContain('<LedgerModal');
    expect(c).toContain("kind: 'confirm'");
    expect(c).toContain("kind: 'authorise'");
    expect(c).toContain("kind: 'reconcile'");
    expect(c).not.toMatch(/supabase\.from\(|\.rpc\(|confirmFunding\(|authoriseRelease\(|openReconciliation\(/);
  });

  it('offers a release exactly as LedgerPanel does, and the beneficiary list is accepted contractors with an account', () => {
    const c = code(TAB);
    expect(c).toContain("v.stage.status === 'complete' && !liveRelease");
    expect(c).toContain("c.status === 'accepted' && c.contractor_user_id");
    expect(c).toContain('disabled={contractors.length === 0}');
    expect(c).toContain("t('admin.ledger.noContractor')");
  });

  it('reloads the whole model after an act rather than patching state locally', () => {
    expect(code(TAB)).toContain('onDone={() => { setModal(null); onChanged(); }}');
    const route = code('src/app/routes/admin/projects.detail.tsx');
    expect(route).toContain('<FinancialsTab loaded={loaded} onChanged={reload} />');
    expect(route).toContain('setGeneration(g => g + 1)');
  });
});

describe('payment_status: only here, only labelled, never an input', () => {
  it('appears in no other workspace component', () => {
    for (const f of readdirSync(resolve(ROOT, WS_DIR))) {
      const c = code(join(WS_DIR, f));
      if (f === 'FinancialsTab.tsx') continue;
      expect(c, f).not.toContain('payment_status');
    }
  });

  it('is rendered through the "legacy projection" column and decides nothing', () => {
    const c = code(TAB);
    expect(c).toContain('admin.workspace.financials.projection.${v.stage.payment_status}');
    expect(c).toContain("t('admin.workspace.financials.legacy')");
    // Never on the left of a comparison that gates anything.
    expect(c).not.toMatch(/payment_status\s*(===|!==|==|!=)/);
    expect(lookup(en, 'admin.workspace.financials.legacyHint')).toMatch(/never an input/i);
  });
});

describe('one "released" per screen', () => {
  it('the costing view is rendered without its stage-status money buckets, and the client page keeps them', () => {
    expect(code(TAB)).toContain('showMilestoneBuckets={false}');
    const bv = code('src/components/project/BudgetView.tsx');
    expect(bv).toContain('showMilestoneBuckets = true');
    // The client's own page passes nothing, so it renders exactly as before.
    expect(code('src/app/routes/projects/detail.tsx')).toContain('<BudgetView project={project} stages={stages} />');
  });
});

describe('no provider is implemented here (14 Sep meeting: the payment architecture is still hypothetical)', () => {
  it('names no provider and invents no provider state — every state word is the 090 ledger vocabulary', () => {
    const c = src(TAB);
    expect(c).not.toMatch(/swychr|switcha|switcher|switchr/i);
    for (const dict of [en, fr]) {
      const ws = JSON.stringify((dict as { admin: { workspace: unknown } }).admin.workspace);
      expect(ws).not.toMatch(/swychr|switcha|switcher|switchr/i);
    }
    // Ledger states are rendered through one key family, whose members are the 090 enum.
    const stateKeys = [...code(TAB).matchAll(/admin\.ledger\.state\.\$\{([a-zA-Z.]+)\}/g)].map(m => m[1]);
    expect(stateKeys.length).toBeGreaterThan(0);
    expect(new Set(stateKeys)).toEqual(new Set(['state']));
    for (const st of ['expected', 'funded', 'reconciled', 'release_authorised', 'initiated', 'disbursed', 'failed', 'reconciling']) {
      expect(lookup(en, `admin.ledger.state.${st}`), st).toBeTypeOf('string');
    }
    // No sum is manufactured in the component: "available" is the loader's figure.
    expect(code(TAB)).toContain('value={fin.availableFunds}');
    expect(code(TAB)).not.toMatch(/availableFunds\s*=|expected\s*=\s*.*reduce/);
  });
});

describe('custody rule in the words', () => {
  it('no wallet, escrow or balance held — in code or in either dictionary', () => {
    // Code only — the header comment names the words precisely to forbid them.
    expect(code(TAB).toLowerCase()).not.toMatch(/\bescrow\b|\bwallet\b|balance held/);
    for (const key of ['fundingSub', 'releasesSub', 'disbursementsSub', 'reconciliationSub']) {
      expect(lookup(en, `admin.workspace.financials.${key}`)).not.toMatch(/escrow|wallet/i);
      expect(lookup(fr, `admin.workspace.financials.${key}`)).not.toMatch(/escrow|wallet|portefeuille/i);
    }
  });
});

describe('reconciliation reads provider events by the project’s own rows', () => {
  it('asks for nothing when there are no rows, and reports that as available + empty', async () => {
    expect(await listPaymentEvents([])).toEqual({ rows: [], available: true });
  });

  it('the reader filters by payment_id and the tab tells apart empty, unavailable and failed', () => {
    expect(code('src/lib/supabase/payments.ts')).toContain(".in('payment_id', paymentIds)");
    const c = code(TAB);
    expect(c).toContain('<DomainNote state="error"');
    expect(c).toContain('<DomainNote state="unavailable" />');
    expect(c).toContain("t('admin.workspace.financials.reconciliationEmpty')");
  });

  it('every outcome the database writes has a label', () => {
    const sql = src('supabase/migrations/090_payments_ledger.sql');
    const written = new Set([...sql.matchAll(/outcome = '([a-z_]+)'/g)].map(m => m[1]));
    for (const m of sql.matchAll(/v_outcome := CASE[^;]*?THEN '([a-z_]+)' ELSE '([a-z_]+)'/g)) { written.add(m[1]); written.add(m[2]); }
    expect([...written].sort()).toEqual(['illegal_transition', 'unknown_type', 'unmatched']);
    for (const o of [...written, 'applied']) {
      expect(lookup(en, `admin.workspace.financials.outcome.${o}`), o).toBeTypeOf('string');
      expect(lookup(fr, `admin.workspace.financials.outcome.${o}`), o).toBeTypeOf('string');
    }
  });
});

describe('both dictionaries', () => {
  it('every financials string exists in en and fr and is translated', () => {
    for (const key of [
      'fundingSub', 'fundingEmpty', 'notReceived', 'releasesSub', 'legacy', 'legacyHint', 'disbursements', 'disbursementsEmpty',
      'compensation', 'compensationEmpty', 'reconciliation', 'reconciliationEmpty', 'fees', 'feesEmpty', 'costing',
      'projection.unpaid', 'projection.paid', 'feeKind.permit', 'feeKind.professional',
    ]) {
      const e = lookup(en, `admin.workspace.financials.${key}`), f = lookup(fr, `admin.workspace.financials.${key}`);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} not translated`).not.toBe(f);
    }
  });
});
