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
    expect(STEP11).toMatch(/hasBillOfQuantities\s*\?\s*\{\s*\.\.\.confirmed,[\s\S]*?construction: confirmed\.total,/);
  });

  it('charges nothing on top of a bill', () => {
    // "Someone that has uploaded their bill of quantities already knows what their
    // project costs. We are not charging them for anything." The fee lines belong to
    // an estimate, where Groundwork priced the work.
    expect(STEP11).toMatch(/design: 0, permit: 0, professional: 0, verification: 0, contingency: 0/);
  });

  it('tells the join RPC the project is priced from a bill', () => {
    // So the stages already built keep their share and are marked complete, rather
    // than being zeroed as an estimate's would be.
    expect(STEP11).toMatch(/startStage \? stageLabel\(startStage\) : '', hasBillOfQuantities\)/);
    const tracking = code('src/lib/supabase/tracking.ts');
    expect(tracking).toMatch(/p_bill_of_quantities: billOfQuantities/);
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
    // The conversion is bill ÷ a rate held in the migration itself. `now()` does appear
    // in the file — the join RPC stamps `tracking_started_at` — so the check is on the
    // conversion, not on the word.
    expect(sql).toMatch(/round\(c\.bill_local \/ c\.fx_rate, 2\)/);
    expect(sql).not.toMatch(/approx_fx_rate|live|fetch/i);
  });

  it('fills the stages completed before the join, and leaves only paid-through-Groundwork money alone', () => {
    // Those stages were zeroed on creation; that is the fault being repaired. A stage the
    // client actually paid through Groundwork is the one thing not rewritten.
    expect(sql).toMatch(/COALESCE\(s\.payment_status, 'unpaid'\) = 'paid'\s*\n?\s*AND COALESCE\(s\.pre_existing, false\) = false/);
    expect(sql).not.toMatch(/AND NOT \(COALESCE\(s\.pre_existing, false\)\s*\n?\s*OR/);
  });

  it('zeroes the fee lines on a bill-priced project', () => {
    expect(sql).toMatch(/UPDATE public\.project_fees f\s*\n?\s*SET amount_usd = 0/);
  });

  it('widens the join RPC so new bill-priced projects keep their built stages', () => {
    expect(sql).toMatch(/p_bill_of_quantities boolean DEFAULT false/);
    expect(sql).toMatch(/CASE WHEN p_bill_of_quantities\s*\n?\s*THEN payment_milestone_usd ELSE 0 END/);
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

describe('the follow-up for Home 2, the project the rule was demonstrated on', () => {
  /*
   * The first backfill listed only bills that had been re-read before it was written.
   * Home 2 was created on the call to SHOW the fault, after that reading — so the project
   * in the screenshots was the one project the migration did not touch, and the
   * contractor's view of it stayed exactly as it was: 54,042,849 against a 59,675,280
   * bill, two built stages at zero. The first migration had already been applied, so
   * the fix is a second file, not an edit.
   */
  const SQL = read('supabase/migrations/20261111000100_home_2_from_its_bill.sql');
  const sql = SQL.replace(/--[^\n]*/g, '');

  it('names Home 2 and the line its bill was read from', () => {
    expect(sql).toMatch(/'d8be43a7-ffd4-4f57-851b-c709a9f11499',\s*59675280,\s*600,\s*'TOTAL 59675280'/);
  });

  it('applies the same four corrections as the first backfill, with the same guard', () => {
    expect(sql).toMatch(/round\(c\.bill_local \/ c\.fx_rate, 2\)/);
    expect(sql).toMatch(/UPDATE public\.project_fees f\s*\n?\s*SET amount_usd = 0/);
    expect(sql).toMatch(/payment_milestone_usd = round\(p\.budget_usd \* s\.budget_pct \/ 100\.0, 2\)/);
    expect(sql).toMatch(/COALESCE\(s\.payment_status, 'unpaid'\) = 'paid'\s*\n?\s*AND COALESCE\(s\.pre_existing, false\) = false/);
    expect(sql).toMatch(/DELETE FROM confirmed_bill/);
  });

  it('is ordered after the migration it extends', () => {
    expect('20261111000000_a_bill_is_the_whole_project.sql' < '20261111000100_home_2_from_its_bill.sql').toBe(true);
  });
});
