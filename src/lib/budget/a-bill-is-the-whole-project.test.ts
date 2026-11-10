import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A bill of quantities is the whole project, and the stages are its percentages.
 *
 * Reported 11 Nov 2026 on Brian Home: "after it reads the boq on project creation and
 * displays the right figure, it distributes it wrongly in the stages... even the total
 * budget on the project after its creation is wrong from what the contractor confirmed."
 *
 * Two faults, both on the creation path:
 *
 *   THE TOTAL  `decomposeBudget` inverts the estimator's fee formulas out of whatever
 *              total it is given. A bill has no Groundwork fee inside it to recover, so
 *              inverting took ~12% of the contractor's own figure and relabelled it; on
 *              a mid-build join `joinedBudget` then reduced it again to the remaining
 *              work. 59,675,280 XAF confirmed, $80,587 stored — about 47.2M XAF.
 *
 *   THE SPLIT  `apply_budget_milestones` shares the CONSTRUCTION fee across the stages.
 *              Right for an estimate, where permit and contingency sit on top of
 *              construction; wrong for a bill, where they do not. 46.371529% of the bill
 *              was written as 24,313,931 instead of 27,672,383.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STEP11 = code('src/components/wizard/steps/Step11ConfirmBudget.tsx');

describe('what the contractor confirmed is what the project holds', () => {
  it('only treats a total as a bill when a bill was actually attached', () => {
    // Narrower than the architecture-plan path on purpose: somebody can arrive with
    // drawings and no bill, and then the figure is an estimate like any other.
    expect(STEP11).toMatch(
      /hasBillOfQuantities\s*=\s*\(pendingDocuments \?\? \[\]\)\.some\(doc => doc\.category === 'boq'\)/);
  });

  it('distributes the confirmed TOTAL across the stages, not the carved-down construction', () => {
    // `apply_budget_milestones` splits whatever is handed to it as the construction fee.
    // For a bill, that has to be the whole figure or the percentages lie.
    expect(STEP11).toMatch(/hasBillOfQuantities\s*\?\s*\{ \.\.\.confirmed, construction: confirmed\.total \}/);
  });

  it('does not shrink a bill-priced total when the build joined mid-way', () => {
    /*
     * `joinedBudget` reduces `total` to the work still to come, and that reduced figure
     * reached `projects.budget_usd`. Correct for an estimate — it is a quote for the
     * work Groundwork will govern — and wrong for a bill the contractor just approved.
     * The stages already built are still recorded and still never billed; what changes
     * is only the number the project is said to be worth.
     */
    expect(STEP11).toMatch(/pricedJoin\s*=\s*hasBillOfQuantities/);
    expect(STEP11).toMatch(/total: priced\.total/);
    expect(STEP11).toMatch(/adminStartProjectAtStage\(project\.id, pricedJoin,/);
  });

  it('sends the same priced breakdown down every creation branch', () => {
    // Three ways a project starts tracking — admin, partner, and a client doing it
    // themselves. A fix applied to one of them is the bug this file exists for.
    expect(STEP11).toMatch(/adminStartProjectTracking\(project\.id, priced,/);
    expect(STEP11).toMatch(/startProjectTracking\(project\.id, priced\)/);
  });

  it('leaves an estimated build exactly as it was', () => {
    // The estimator prices construction and the fees sit on top. Nothing here may
    // change that — only a project carrying a bill takes the other path.
    expect(STEP11).toMatch(/:\s*confirmed;/);
  });
});

describe('the backfill for projects already created', () => {
  const SQL = read('supabase/migrations/20261111000000_a_bill_is_the_whole_project.sql');
  const sql = SQL.replace(/--[^\n]*/g, '');

  it('converts at the stored rate, so a re-run produces the same numbers', () => {
    // A live rate would make the migration non-deterministic: the same statement would
    // write a different budget depending on the day it was applied.
    expect(sql).toMatch(/fx_rate/);
    expect(sql).not.toMatch(/now\(\)/);
  });

  it('never touches settled money', () => {
    expect(sql).toMatch(/COALESCE\(s\.pre_existing, false\)/);
    expect(sql).toMatch(/COALESCE\(s\.payment_status, 'unpaid'\) = 'paid'/);
    expect(sql).toMatch(/s\.status = 'complete'/);
    expect(sql).toMatch(/COALESCE\(s\.fixed_amount_usd, 0\) = 0/);
  });

  it('refuses a project whose bill is no longer filed as one', () => {
    // The ids were read on 11 Nov 2026. If a document has since been refiled or removed,
    // this is no longer the project that was read and must not be rewritten.
    expect(sql).toMatch(/DELETE FROM confirmed_bill/);
    expect(sql).toMatch(/d\.category = 'boq'/);
  });

  it('writes only bills that read as a project total', () => {
    /*
     * Five of the nine did not. NGODI read 250,000,750,000 off a line called
     * "Gravier 5/15" — $416 million onto a project holding $7,499. A machine reading is
     * evidence, not a budget, so those are named in the file for a person to settle.
     */
    const inserted = (sql.match(/\('[0-9a-f-]{36}',\s*[\d.]+,\s*\d+,/g) ?? []).length;
    expect(inserted).toBe(4);
    for (const unreadable of ['NGODI', 'Youpwe', 'TOKO', 'TAMSO', 'Duplex']) {
      expect(SQL, `${unreadable} must be named as needing a human figure`).toContain(unreadable);
    }
  });

  it('applies the percentage to the corrected budget, and leaves the percentage alone', () => {
    // `budget_pct` is the take-off's share of the building (183). It is the thing being
    // applied here, not the thing being corrected.
    expect(sql).toMatch(/payment_milestone_usd = round\(p\.budget_usd \* s\.budget_pct \/ 100\.0, 2\)/);
    expect(sql).not.toMatch(/SET budget_pct/);
  });
});
