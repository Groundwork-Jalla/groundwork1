import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerLine, totalsFor, purposeOf, needsAttention, byWhen, matchesLine } from './finance-ledger';
import type { Payment } from '@/lib/supabase/payments';
import { ADMIN_NAV } from '@/components/shell/nav-config';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * FINANCE — what actually happened to the money.
 *
 * Budgets answer what a build should cost; this answers what moved. The two failures this
 * guards against are the ones that matter with money: a figure that has not arrived being
 * counted as one that has, and a purpose or a name that nobody wrote appearing in an
 * audit trail.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const overview = code('src/app/routes/admin/finance.tsx');
const ledger   = code('src/components/admin/FinanceLedger.tsx');
const loader   = code('src/lib/supabase/finance-ledger.ts');

const P = (over: Partial<Payment>): Payment => ({
  id: 'p1', projectId: 'j1', stageId: null, direction: 'in', state: 'funded', amount: 100,
  currency: 'USD', beneficiaryId: null, fundingSource: 'staff_confirmed',
  confirmedBy: null, confirmedAt: null, authorisedBy: null, authorisedAt: null, initiatedAt: null, note: null,
  provider: null, providerRef: null, failureReason: null, settledAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const opts = {
  projectName: (id: string) => (id === 'j1' ? 'Villa Kribi' : null),
  ownerOf: (id: string) => (id === 'j1' ? 'mary' : null),
  nameOf: (id: string | null) => (id === 'mary' ? 'Mary N.' : id === 'abc' ? 'ABC Build Ltd' : null),
  stageOf: (id: string | null) => (id === 's4' ? { id: 's4', number: 4, name: 'Roofing' } : null),
};
const line = (p: Partial<Payment>) => ledgerLine(P(p), opts);

describe('expected money is never counted as received', () => {
  const lines = [
    line({ id: 'a', direction: 'in', state: 'funded',     amount: 120_000 }),
    line({ id: 'b', direction: 'in', state: 'reconciled', amount:  64_500 }),
    line({ id: 'c', direction: 'in', state: 'expected',   amount:  71_000 }),
  ];

  it('confirmed inflows are funded and reconciled only', () => {
    const t = totalsFor(lines, 'in');
    expect(t.settled).toBe(184_500);
    expect(t.pending).toBe(71_000);
    // The two are never added together anywhere.
    expect(t.settled).not.toBe(255_500);
  });

  it('the screen splits them into separate tabs, not one list', () => {
    expect(ledger).toContain("useState<'received' | 'expected'>('received')");
    expect(ledger).toContain("l.state === 'funded' || l.state === 'reconciled'");
    expect(ledger).toContain("tab === 'received'");
  });

  it('090 gives an incoming row no failed state, so none is invented', () => {
    expect(totalsFor(lines, 'in').failed).toBe(0);
    expect(src('supabase/migrations/090_payments_ledger.sql'))
      .toContain("(direction = 'in'  AND state IN ('expected', 'funded', 'reconciled'))");
  });
});

describe('approved is never counted as paid', () => {
  const lines = [
    line({ id: 'a', direction: 'out', state: 'release_authorised', amount: 36_000 }),
    line({ id: 'b', direction: 'out', state: 'initiated',          amount:  8_500 }),
    line({ id: 'c', direction: 'out', state: 'disbursed',          amount: 92_000 }),
    line({ id: 'd', direction: 'out', state: 'failed',             amount:  5_000 }),
    line({ id: 'e', direction: 'out', state: 'reconciling',        amount:  2_000 }),
  ];

  it('the three outgoing figures are separate quantities', () => {
    const t = totalsFor(lines, 'out');
    expect(t.approved).toBe(36_000);
    // Under review is money with the provider, not money approved and sitting.
    expect(t.processing).toBe(10_500);
    expect(t.settled).toBe(92_000);
    expect(t.failed).toBe(5_000);
  });

  it('a failed release is in neither committed nor paid', () => {
    const t = totalsFor(lines, 'out');
    expect(t.pending).toBe(t.approved + t.processing);
    expect(t.pending).not.toContain?.(5_000);
    expect(t.settled).toBe(92_000);
  });

  it('the disbursements screen shows Approved, Processing and Paid apart', () => {
    expect(ledger).toContain('totals.approved');
    expect(ledger).toContain('totals.processing');
    expect(ledger).toContain("t('admin.finance.paidOut')");
    expect(lookup(en, 'admin.finance.state.authorised')).toBe('Release approved');
    expect(lookup(en, 'admin.finance.state.disbursed')).toBe('Paid');
  });

  it('needs-attention is failed and reconciling, and outgoing only', () => {
    expect(needsAttention(lines).map(l => l.id).sort()).toEqual(['d', 'e']);
    expect(needsAttention([line({ direction: 'in', state: 'expected' })])).toEqual([]);
  });
});

describe('purpose is real or it is absent', () => {
  it('the stage first', () => {
    expect(purposeOf(line({ stageId: 's4' }))).toBe('Roofing');
  });

  it('then a note somebody wrote', () => {
    expect(purposeOf(line({ stageId: null, note: 'Permit reimbursement' }))).toBe('Permit reimbursement');
  });

  it('and otherwise nothing, which the screen renders as "Purpose not recorded"', () => {
    expect(purposeOf(line({ stageId: null, note: null }))).toBeNull();
    expect(purposeOf(line({ stageId: null, note: '   ' }))).toBeNull();
    expect(ledger).toContain('admin.finance.noPurpose');
    expect(overview).toContain('admin.finance.noPurpose');
    expect(lookup(en, 'admin.finance.noPurpose')).toBe('Purpose not recorded');
  });

  it('a stage wins over a note, so the strongest fact is the one shown', () => {
    expect(purposeOf(line({ stageId: 's4', note: 'something else' }))).toBe('Roofing');
  });
});

describe('who the money came from or went to', () => {
  it('outgoing names the beneficiary', () => {
    const l = line({ direction: 'out', state: 'disbursed', beneficiaryId: 'abc' });
    expect(l.partyId).toBe('abc');
    expect(l.partyName).toBe('ABC Build Ltd');
  });

  it('incoming names the project owner — 090 forbids a beneficiary on an in row', () => {
    const l = line({ direction: 'in' });
    expect(l.partyId).toBe('mary');
    expect(l.partyName).toBe('Mary N.');
    expect(src('supabase/migrations/090_payments_ledger.sql')).toContain('CONSTRAINT payments_in_shape');
  });

  it('an account that cannot be read is null, never a raw id on screen', () => {
    const l = line({ direction: 'out', state: 'disbursed', beneficiaryId: 'nobody' });
    expect(l.partyName).toBeNull();
    expect(ledger).toContain('admin.finance.unknownParty');
    expect(overview).toContain('admin.finance.unknownParty');
    // The id itself is never rendered.
    expect(ledger).not.toMatch(/\{l\.partyId\}/);
    expect(overview).not.toMatch(/\{l\.partyId\}/);
  });

  it('a name lookup that fails costs a name, not a row', () => {
    expect(loader).toContain("degraded.push('people')");
    expect(ledger).toContain('data.degraded.length > 0');
  });
});

describe('when, and what the date means', () => {
  it('the strongest available fact wins, and carries its own label', () => {
    expect(line({ settledAt: '2026-09-25T00:00:00Z' }).atMeans).toBe('settled');
    expect(line({ confirmedAt: '2026-09-24T00:00:00Z' }).atMeans).toBe('confirmed');
    expect(line({ direction: 'out', state: 'release_authorised', authorisedAt: '2026-09-23T00:00:00Z' }).atMeans).toBe('authorised');
    // Nothing has happened: the row's own birthday, labelled as such.
    expect(line({}).atMeans).toBe('created');
  });

  it('an approved release is not dated as though it had been paid', () => {
    expect(String(lookup(en, 'admin.finance.at.authorised'))).toMatch(/Approved/);
    expect(String(lookup(en, 'admin.finance.at.settled'))).toMatch(/Paid/);
  });

  it('newest first, sorted on the date actually shown', () => {
    const rows = [
      line({ id: 'old', confirmedAt: '2026-01-01T00:00:00Z' }),
      line({ id: 'new', confirmedAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(byWhen(rows).map(l => l.id)).toEqual(['new', 'old']);
  });
});

describe('nothing is derived from a plan or a projection', () => {
  it('no budget arithmetic anywhere in finance', () => {
    for (const f of [overview, ledger, loader, code('src/lib/admin/finance-ledger.ts')]) {
      expect(f).not.toContain('budget_usd');
      expect(f).not.toContain('payment_status');
    }
  });

  it('available funding reuses the one helper, so surfaces cannot disagree', () => {
    expect(overview).toContain('availableFunds(raw.rows)');
    expect(overview).toContain("from '@/lib/lifecycle/stage'");
  });

  it('project fees stay out of the ledger', () => {
    for (const f of [overview, ledger, loader]) expect(f).not.toContain('project_fees');
  });

  it('an unreadable ledger is its own state, never a screen of zeroes', () => {
    expect(overview).toContain('!data.available');
    expect(ledger).toContain('!data.available');
    expect(overview).toContain('admin.finance.unavailable');
    // And a helper that could not run reports null rather than 0.
    expect(overview).toContain('admin.finance.notAvailable');
  });

  it('it reads and writes nothing', () => {
    for (const f of [overview, ledger, loader]) {
      for (const banned of ['.insert(', '.update(', '.upsert(', '.delete(']) {
        expect(f, banned).not.toContain(banned);
      }
    }
  });
});

describe('the sidebar', () => {
  const finance = ADMIN_NAV.filter(i => i.to.startsWith('/admin/finance') || i.to === '/admin/budgets');

  it('FINANCE appears once, and opens the group', () => {
    const headers = ADMIN_NAV.filter(i => i.section === 'nav.sectionFinance');
    expect(headers).toHaveLength(1);
    expect(headers[0].to).toBe('/admin/finance');
  });

  it('holds exactly the four items, in order', () => {
    expect(finance.map(i => i.to)).toEqual([
      '/admin/finance', '/admin/finance/inflows', '/admin/finance/disbursements', '/admin/budgets',
    ]);
  });

  it('Budgets moved rather than being duplicated', () => {
    expect(ADMIN_NAV.filter(i => i.to === '/admin/budgets')).toHaveLength(1);
    const budgets = ADMIN_NAV.find(i => i.to === '/admin/budgets')!;
    expect(budgets.labelKey).toBe('nav.budgetsFees');
    // Its old home was the Work group; the route itself is unchanged.
    const work = ADMIN_NAV.slice(
      ADMIN_NAV.findIndex(i => i.section === 'nav.sectionWork'),
      ADMIN_NAV.findIndex(i => i.section === 'nav.sectionFinance'),
    );
    expect(work.some(i => i.to === '/admin/budgets')).toBe(false);
  });

  it('FINANCE sits between Work and People', () => {
    const at = (s: string) => ADMIN_NAV.findIndex(i => i.section === s);
    expect(at('nav.sectionWork')).toBeLessThan(at('nav.sectionFinance'));
    expect(at('nav.sectionFinance')).toBeLessThan(at('nav.sectionPeople'));
  });

  it('every destination is a registered route', () => {
    const routes = src('src/app/routes.ts');
    for (const path of ['admin/finance', 'admin/finance/inflows', 'admin/finance/disbursements', 'admin/budgets']) {
      expect(routes, path).toContain(`"${path}"`);
    }
  });
});

describe('no money row is a dead end', () => {
  it('every row links back to the project it belongs to', () => {
    expect(overview).toContain("workspaceHref(l.projectId, { tab: 'financials' })");
    expect(ledger).toContain("workspaceHref(l.projectId, { tab: 'financials' })");
  });

  it('search matches what an operator would actually type', () => {
    const l = line({ stageId: 's4', providerRef: 'tx_991', amount: 18_500 });
    for (const q of ['villa', 'mary', 'roofing', 'tx_991', '18500', '']) {
      expect(matchesLine(l, q), q).toBe(true);
    }
    expect(matchesLine(l, 'plumbing')).toBe(false);
  });
});

describe('EN and FR parity', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'nav.sectionFinance', 'nav.financeOverview', 'nav.inflows', 'nav.disbursements', 'nav.budgetsFees',
      'admin.finance.title', 'admin.finance.subtitle', 'admin.finance.unavailable',
      'admin.finance.confirmedInflows', 'admin.finance.approvedForRelease', 'admin.finance.disbursed',
      'admin.finance.availableFunding', 'admin.finance.availableNote', 'admin.finance.recentTitle',
      'admin.finance.inflowTitle', 'admin.finance.outflowTitle', 'admin.finance.noPurpose',
      'admin.finance.unknownParty', 'admin.finance.state.authorised', 'admin.finance.state.disbursed',
      'admin.finance.state.failed', 'admin.finance.tab.received', 'admin.finance.tab.expected',
      'admin.finance.at.settled', 'admin.finance.at.authorised',
    ];
    const sameInBoth = ['nav.disbursements'];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      if (!sameInBoth.includes(key)) expect(e, `${key} is not translated`).not.toBe(f);
    }
  });

  it('no escrow, wallet or platform-fee language', () => {
    for (const f of [overview, ledger, String(lookup(en, 'admin.finance.subtitle'))]) {
      for (const banned of ['escrow', 'Escrow', 'wallet', 'Wallet', 'platform fee']) {
        expect(f, banned).not.toContain(banned);
      }
    }
  });
});
