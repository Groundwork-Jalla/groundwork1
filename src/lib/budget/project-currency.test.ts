import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A client in Douala is quoted in the currency they pay in.
 *
 * Philip, 9 Nov 2026, looking at a live build with its owner: the project currency "is
 * mistakenly displayed in USD instead of CFA Franc". The word "mistakenly" understates
 * it — the stored number really is dollars. `projects.budget_usd` is written by a budget
 * engine that prices the take-off in XAF and then divides by an FX rate before storing
 * it, so a screen showing `$44,480` is telling the truth in a currency nobody on the
 * site uses, against a bill of quantities that says 26,687,728 XAF.
 *
 * The contractor's Work screens solved this on 29 October with `useProjectMoney`: local
 * currency first, at a rate fetched today, with the stored `approx_fx_rate` as fallback.
 * The CLIENT screens never got it. This file is the guard that they keep it — and that
 * one project cannot be quoted at two different rates by two of its own tabs.
 *
 * These are shape assertions, not render tests. What they are really pinning is a
 * decision: a money figure on a project screen goes through the context, full stop.
 * The failure being guarded against is a single branch quietly left on `formatUSD`,
 * which looks like nothing in a diff and reads as a 600× error on screen.
 */

const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every client-facing project screen that renders a stored USD figure. */
const MONEY_SCREENS = [
  'src/components/project/OverviewTab.tsx',
  'src/components/project/BudgetView.tsx',
  'src/components/project/StageTracker.tsx',
  'src/components/project/ProjectPaymentsLedger.tsx',
  'src/components/project/StartTrackingGate.tsx',
];

describe('the client is quoted in the project currency', () => {
  for (const file of MONEY_SCREENS) {
    it(`${file.split('/').pop()} formats through the project context`, () => {
      const body = code(file);
      // The dollar formatters are the thing being replaced. Importing one again is how
      // this regresses: it compiles, it renders, and it is wrong by two orders of
      // magnitude for every franc-zone client.
      expect(body).not.toMatch(/\bformatUSDFull\s*\(/);
      expect(body).not.toMatch(/\bformatUSD\s*\(/);
      expect(body).toMatch(/useMoney\(\)/);
    });
  }

  it('one provider covers the whole project page, the budget gate included', () => {
    const detail = code('src/app/routes/projects/detail.tsx');
    expect(detail).toMatch(/<ProjectMoneyProvider project=\{project\}>/);
    // Before the tabs AND before StartTrackingGate: the gate is where a client first
    // sees what the build will cost them, which is the worst place to say $.
    const provider = detail.indexOf('<ProjectMoneyProvider');
    const gate     = detail.indexOf('<StartTrackingGate');
    const tabs     = detail.indexOf('<TabBar');
    expect(provider).toBeGreaterThan(-1);
    expect(gate, 'the budget gate must be inside the provider').toBeGreaterThan(provider);
    expect(tabs, 'the tabs must be inside the provider').toBeGreaterThan(provider);
  });

  it('the exported PDF is handed the same rate the screen used', () => {
    // A report that disagrees with the page it was downloaded from is worse than one in
    // dollars, because only one of the two can be checked against the other.
    expect(code('src/components/project/BudgetView.tsx'))
      .toMatch(/exportBudgetPDF\(project, stages, lang, fx \?/);
    expect(code('src/lib/pdf/export-budget.ts'))
      .toMatch(/moneyPair\(Math\.round\(n \* fx!\.rate\), fx!\.code, fx!\.rate\)\.local/);
  });

  it('nothing in the conversion can move money', () => {
    // The ledger stays in USD and the engine still divides by the stored rate. If this
    // ever reaches a write path, a browser's view of today's FX starts deciding what a
    // contractor is owed.
    const ctx = code('src/lib/budget/project-money-context.tsx');
    expect(ctx).not.toMatch(/supabase|\.rpc\(|insert|update/i);
    expect(ctx).toMatch(/useProjectMoney\(project \?\? country\)/);
  });

  it('outside a provider it falls back to dollars rather than throwing', () => {
    // The same leaves render in the admin workspace, where there is no one project whose
    // currency it could be. A crash there would be a worse bug than the one being fixed.
    expect(code('src/lib/budget/project-money-context.tsx'))
      .toMatch(/money\?\.local\(value, sourceAmount\) \?\? formatUSDFull\(value\)/);
  });
});

describe('outstanding is what is left, not what it all costs', () => {
  const overview = code('src/components/project/OverviewTab.tsx');

  it('is summed from the obligations, never derived as total minus paid', () => {
    // `total - paid` left the four fee lines in "outstanding" permanently, because they
    // hang off no stage and so could never be subtracted by a stage being paid. On a
    // project where nothing had been paid the card printed the budget total twice.
    expect(overview).not.toMatch(/Math\.max\(0, totalBudget - paidTotal\)/);
    expect(overview).toMatch(/const outstanding = stagesUnpaid \+ feesUnpaid;/);
    expect(overview).toMatch(/const paidTotal\s+= stagesPaid \+ feesPaid;/);
  });

  it('counts the fee rows that carry no stage', () => {
    // permit, professional, verification, contingency — 036 and 072. Miss them and the
    // three cards stop adding up, which is the first thing a client checks.
    expect(overview).toMatch(/fees\.filter\(f => f\.payment_status === 'paid'\)/);
    expect(overview).toMatch(/fees\.filter\(f => f\.payment_status !== 'paid'\)/);
    expect(code('src/app/routes/projects/detail.tsx')).toMatch(/fetchProjectFees\(id\)/);
  });

  it('reads the ledger before the legacy projection', () => {
    expect(overview).toMatch(/const tranche = payments\.get\(s\.id\);/);
    expect(overview).toMatch(/tranche\.state === 'funded' \|\| tranche\.state === 'reconciled'/);
  });

  it('shows what was actually settled per line, not the pricing formula run backwards', () => {
    // `decomposeBudget(paidTotal, …)` answered "if this sum were a whole budget, how
    // would it have been composed?" — so the permit bar filled before any permit had
    // been paid for. Each line is now read off a stage or a fee row.
    expect(overview).not.toMatch(/decomposeBudget\(paidTotal/);
    expect(overview).toMatch(/const constructionPaid = stagesPaid - designPaid;/);
    expect(overview).toMatch(/const feePaid = \(kind: ProjectFeeRow\['kind'\]\)/);
  });
});

describe('a document opens in the page it was filed on', () => {
  it('the vault has a viewer, not only a download', () => {
    const vault = code('src/components/project/DocumentVault.tsx');
    expect(vault).toMatch(/<DocumentViewer/);
    expect(vault).toMatch(/const handleView = useCallback/);
    // Download survives: the viewer cannot draw a .docx or an .xlsx, and a contractor on
    // site often wants the file rather than a look at it.
    expect(vault).toMatch(/const handleDownload = useCallback/);
  });

  it('a slow signature cannot drop the wrong file into the frame', () => {
    expect(code('src/components/project/DocumentVault.tsx'))
      .toMatch(/current && current\.doc\.id === doc\.id \? \{ doc, url \} : current/);
  });
});
