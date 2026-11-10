import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One project, one currency, one share — on every surface that shows it.
 *
 * The 9 Nov currency change named five client screens and fixed those five. It did not
 * ask which OTHER screens render a stored USD figure, and several did: the stage
 * certificate (a hardcoded `$`), the receipt prompt that names what a client must
 * transfer, the Jalla Management estimate on the project gate, and the client budget
 * sitting directly above a take-off priced in francs.
 *
 * 183 then made `budget_pct` a real ratio — 48.456200 — and two of the three places that
 * print a share were updated. BudgetView printed six decimal places to a client.
 *
 * Both are the same mistake: a change applied to the files somebody happened to be
 * looking at. This file asks the question by ROLE instead, so the next figure added to a
 * client screen has to answer it too.
 *
 * ── WHY THE ADMIN IS DELIBERATELY DIFFERENT ──────────────────────────────────────────
 * The admin workspace lists projects from several countries at once; there is no single
 * project whose currency it could use, so it stays in dollars on purpose. That is a
 * decision, recorded here so nobody "fixes" it.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Client surfaces that render a stored USD figure, and are reachable.
 *
 * `ProjectPayments.tsx` and everything only it mounts — MilestonePaymentModal,
 * StageFundsPanel, PayoutStatusModal, PaymentHistory — are deliberately absent: nothing
 * renders them (asserted below), so their dollars reach no one.
 */
const CLIENT_MONEY = [
  'src/components/project/OverviewTab.tsx',
  'src/components/project/BudgetView.tsx',
  'src/components/project/StageTracker.tsx',
  'src/components/project/ProjectPaymentsLedger.tsx',
  'src/components/project/StartTrackingGate.tsx',
  // Added 10 Nov, each a figure a client reads or is asked to act on.
  'src/components/project/StageCertificateModal.tsx',
  'src/components/project/StagePaymentGate.tsx',
  'src/app/routes/projects/takeoff.tsx',
];

describe('a client is quoted in the project currency, everywhere', () => {
  for (const file of CLIENT_MONEY) {
    const name = file.split('/').pop();

    it(`${name} formats through the project context`, () => {
      const body = code(file);
      expect(body, 'must not reach for the dollar formatter').not.toMatch(/\bformatUSDFull\s*\(/);
      expect(body, 'must not reach for the dollar formatter').not.toMatch(/\bformatUSD\s*\(/);
      expect(body).toMatch(/useMoney\(\)/);
    });

    it(`${name} prints no hardcoded currency symbol`, () => {
      // The gap `formatUSD` checks miss. The certificate read `$${n.toLocaleString()}`,
      // which no search for a formatter would ever have found.
      const body = code(file);
      expect(body, 'a literal $ before an interpolated number').not.toMatch(/`\s*\$\$\{/);
      expect(body).not.toMatch(/\$\{[^}]*\}\s*(USD|usd)\b/);
    });
  }

  it('the two routes that render the provider read money through a child', () => {
    // `useMoney()` called in the body that RENDERS `ProjectMoneyProvider` is outside it,
    // and falls back to dollars silently — which is how both of these were wrong.
    expect(code('src/app/routes/projects/detail.tsx')).toMatch(/function ManagedEstimate\(/);
    expect(code('src/app/routes/projects/takeoff.tsx')).toMatch(/function ClientBudgetFigure\(/);
  });

  it('the take-off page wraps itself so both of its figures share one rate', () => {
    const takeoff = code('src/app/routes/projects/takeoff.tsx');
    expect(takeoff).toMatch(/<ProjectMoneyProvider country=\{project\.country\}>/);
    // The take-off's own total stays in the document's currency, as it always was.
    expect(takeoff).toMatch(/formatLocalCurrency\(/);
  });
});

describe('the contractor sees the same figures as the client', () => {
  // A contractor and a client looking at one build must not read two different numbers.
  for (const file of [
    'src/app/routes/work/index.tsx',
    'src/app/routes/work/projects.tsx',
    'src/app/routes/work/projects.detail.tsx',
    'src/app/routes/work/payouts.tsx',
  ]) {
    it(`${file.split('/').pop()} uses the project's currency`, () => {
      expect(code(file)).toMatch(/useProjectMoney|useMoney\(\)/);
    });
  }
});

describe('the admin stays in dollars, on purpose', () => {
  it('the workspace does not adopt one project\'s currency', () => {
    // It lists projects from several countries at once. Recorded so this is not "fixed".
    const fin = code('src/components/admin/workspace/FinancialsTab.tsx');
    expect(fin).toMatch(/formatUSDFull\(/);
    expect(fin).not.toMatch(/useMoney\(\)/);
  });
});

describe('a share is printed as a share, not as a stored ratio', () => {
  // 183 made budget_pct numeric(9,6). Printing it raw gives "48.4562%".
  for (const file of [
    'src/components/project/StageTracker.tsx',
    'src/components/project/BudgetView.tsx',
    'src/lib/pdf/export-budget.ts',
  ]) {
    it(`${file.split('/').pop()} goes through formatShare`, () => {
      const body = code(file);
      expect(body).toMatch(/formatShare\(/);
      expect(body, 'raw budget_pct interpolation').not.toMatch(/\{stage\.budget_pct\}%/);
    });
  }

  it('the stage tools page is seed data and may stay whole', () => {
    // `/tools/stages` renders getStageSeed(), which is integers by definition — it is
    // not any project's schedule.
    expect(code('src/app/routes/tools/stages.tsx')).toMatch(/getStageSeed|STAGE/);
  });
});

describe('the unreachable payment subtree is still unreachable', () => {
  it('nothing mounts ProjectPayments', () => {
    // It carries ~16 dollar-formatted figures. They are excluded from the client list
    // above ONLY because no screen renders them; if that changes, they need the context
    // first. `client-view.test.ts` pins the detail route specifically; this pins the
    // whole app.
    const mounted = ['src/app/routes/projects/detail.tsx', 'src/app/routes/dashboard.tsx']
      .map(code).join('\n');
    expect(mounted).not.toMatch(/from '@\/components\/project\/ProjectPayments'/);
  });
});

describe('the schedule adds up, in the database', () => {
  const sum = src('supabase/migrations/20261110000000_stages_sum_to_construction.sql');
  const body = sum.replace(/^\s*--.*$/gm, '');

  it('shares out the rounding remainder instead of rounding each stage alone', () => {
    // Eight independent ROUNDs drift from the construction fee by a few dollars, which
    // is how the costing tab came to sum to more than the budget (Edgar, ~100 XAF).
    expect(body).toMatch(/floor\(exact\)/);
    expect(body).toMatch(/floor\(sum\(exact\) OVER \(\)[^)]*\) - sum\(floor\(exact\)\) OVER \(\)/);
    expect(body).toMatch(/row_number\(\) OVER \(ORDER BY exact - floor\(exact\) DESC/);
  });

  it('leaves fixed-amount stages out of the redistribution', () => {
    // The design fee is an absolute amount; giving it a share of the rounding remainder
    // would change a fee nobody re-priced.
    expect(body).toMatch(/fixed_amount_usd IS NULL/);
    expect(body).toMatch(/payment_milestone_usd = ROUND\(fixed_amount_usd, 2\)/);
  });

  it('stores cents, since the page is read in XAF at ~590 to the dollar', () => {
    expect(body).toMatch(/\/ 100\.0/);
    expect(body).toMatch(/ROUND\(a\.amount, 2\)/);
  });

  it('corrects existing schedules without touching settled money', () => {
    // Only unsettled stages are rewritten; paid, complete and pre-existing ones are not,
    // and a mid-build join (its budget is the remaining work) is skipped.
    expect(body).toMatch(/joined_at_stage IS NULL/);
    expect(body).toMatch(/NOT \(COALESCE\(pre_existing, false\) OR payment_status = 'paid' OR status = 'complete'\)/);
    expect(body).toMatch(/> 10/);
  });

  it('runs after 184 so the reprice path is not overwritten', () => {
    // Migrations apply in lexical filename order: '184_' sorts before '2026…'.
    expect('184_recut_a_live_schedule.sql' < '20261110000000_stages_sum_to_construction.sql').toBe(true);
  });
});

describe('both halves of the receipt handshake quote one currency', () => {
  it('the contractor route provides the context StagePaymentGate reads', () => {
    /*
     * `StagePaymentGate` renders on BOTH sides: the client uploads the receipt from
     * StageTracker, the contractor confirms it from /work. It formats through
     * `useMoney()`, which falls back to dollars outside a provider — and the contractor
     * routes format with `useProjectMoney` directly rather than providing it.
     *
     * So the client was asked to transfer 25,102,200 XAF while the contractor was asked
     * to confirm $41,837: one payment, two currencies, on the one screen pair where the
     * two parties have to agree before a stage opens.
     */
    const work = code('src/app/routes/work/projects.detail.tsx');
    const provider = work.indexOf('<ProjectMoneyProvider');
    const gate     = work.indexOf('<StagePaymentGate');
    expect(provider, 'the contractor route must provide the money context').toBeGreaterThan(-1);
    expect(gate, 'the gate must be inside it').toBeGreaterThan(provider);
  });

  it('every shared project component the contractor mounts is covered', () => {
    // The check that found it: anything under components/project that reads `useMoney()`
    // needs a provider wherever it is rendered, and /work supplies one only here.
    const work = code('src/app/routes/work/projects.detail.tsx');
    const imported = [...work.matchAll(/from '@\/components\/project\/([A-Za-z]+)'/g)].map(m => m[1]);
    for (const name of imported) {
      let body: string;
      try { body = code(`src/components/project/${name}.tsx`); } catch { continue; }
      if (!/useMoney\(\)/.test(body)) continue;
      expect(name, `${name} reads useMoney() and the contractor route must provide it`)
        .toBe('StagePaymentGate');
    }
  });
});

/**
 * The client and the contractor derive a stage figure the SAME way — 11 Nov 2026.
 *
 * The costing page was corrected to split a bill-of-quantities project across the
 * project total. The contractor's screens were not, and went on printing the stored
 * amount: about 3.34% higher on every stage of the same build, for the two people who
 * have to agree on it before a stage opens.
 *
 * This is the third time the same shape has appeared — a currency change applied to the
 * screens somebody had open, a `verified` branch that forgot its own definition, and now
 * a stage split fixed on one surface. So the rule is not "remember the other file": the
 * derivation lives in `lib/budget/stage-amounts.ts` and this asks, by surface, that
 * nobody re-implements it.
 */
describe('one definition of what a stage is worth', () => {
  const SURFACES = [
    'src/components/project/BudgetView.tsx',
    'src/app/routes/work/projects.detail.tsx',
  ];

  it('both the client and the contractor import it', () => {
    for (const file of SURFACES) {
      expect(code(file), `${file} must derive stage money through stage-amounts`)
        .toMatch(/from '@\/lib\/budget\/stage-amounts'/);
    }
  });

  it('neither prints a raw stored milestone any more', () => {
    /*
     * `payment_milestone_usd` is written at creation and can predate a re-price or a
     * corrected budget. Reading it straight is what made the two screens disagree, and
     * the migration cannot fix it for them — it deliberately never touches a stage that
     * is paid, complete, pre-existing or fixed-fee.
     */
    for (const file of SURFACES) {
      expect(code(file), `${file} must not read payment_milestone_usd directly`)
        .not.toMatch(/payment_milestone_usd/);
    }
  });

  it('decides on the bill of quantities, never on whether the build joined mid-way', () => {
    // The bug this replaced: `wholeProject` keyed on `pre_existing`. Of the live
    // projects on 11 Nov 2026, five had both, four a bill alone and five a mid-build
    // join with no bill — so the two facts cannot stand in for one another.
    const basis = code('src/lib/budget/stage-amounts.ts');
    expect(basis).toMatch(/hasBoq/);
    expect(basis).toMatch(/if \(hasBoq\) return \{ wholeProject: true/);
  });

  it('keeps the contractor on PAYABLE, so pre-existing work is never shown as owed', () => {
    // 103: pre-existing stages were "never approved, verified or funded by us". A
    // figure beside "Released" is a claim that money moved.
    const work = code('src/app/routes/work/projects.detail.tsx');
    expect(work).toMatch(/stagePayableUsd|sumPayableUsd/);
    expect(work, 'the contractor must not use the client-side schedule figure')
      .not.toMatch(/stageScheduleUsd/);
  });
});
