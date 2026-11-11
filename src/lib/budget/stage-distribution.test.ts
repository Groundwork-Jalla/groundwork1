import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateBudget } from './index';
import { runTakeoff, SECTION_KEYS } from './engine';
import { buildLegacyRate } from './legacy';
import { SECTION_TO_STAGE, formatShare, stageShares, stageSharesFromTakeoff } from './stage-shares';
import { joinedBudget, STAGE_BUDGET_PCT } from './joined-project';
import { CAMEROON_BQS } from './__fixtures__/cameroon-bqs';
import { getStageSeed } from '@/lib/supabase/stage-seeds';
import { STAGE_KEYS, type StageKey } from '@/lib/projects/stage-from-description';

/**
 * The payment schedule is this building's, not a national average.
 *
 * Philip, 9 Nov 2026, reading a live project's costing down the screen with its owner:
 * the platform "incorrectly distributes funds starting from stage five onwards" and
 * should "stick to the exact amounts allocated to specific stages". The correction asked
 * for was that the distribution "flow to previous stages rather than only building from
 * current stages upward".
 *
 * Two separate defects were behind that screen, and this file guards both:
 *
 *   1. Every project's schedule came from ONE list of percentages — 2 / 8 / 30 / 8 / 17 /
 *      30 / 5 — applied to its construction fee, while the engine had already priced the
 *      building section by section and nothing read that back.
 *
 *   2. The Overview's PLANNED column was `decomposeBudget(budget_usd)`, the pricing
 *      formula run backwards. The PAID column was taken off that formula on 9 Nov and
 *      this one was left on it, so the two answered different questions and the card
 *      disagreed with the stage schedule underneath it.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a stage carries what its own work was priced at', () => {
  for (const fixture of CAMEROON_BQS) {
    describe(fixture.name, () => {
      const shares = stageSharesFromTakeoff(fixture.input)!;

      it('produces a split at all', () => {
        expect(shares, 'every calibration fixture has a take-off').toBeTruthy();
      });

      it('sums to exactly 100', () => {
        // Multiplied by the construction fee in TWO places — TypeScript at creation and
        // SQL on every re-price. A schedule that does not add up to the budget printed
        // above it is the first thing a client checks.
        const sum = STAGE_KEYS.reduce((a, k) => a + shares[k], 0);
        expect(sum).toBeCloseTo(100, 9);
      });

      it('never allocates a negative share', () => {
        for (const k of STAGE_KEYS) expect(shares[k], k).toBeGreaterThanOrEqual(0);
      });

      it('charges nothing for land, design, or exterior work', () => {
        // Land is bought outside Groundwork; design rides on `fixed_amount_usd` as an
        // absolute fee; exterior work is never charged. Giving any of them a share here
        // would bill for something the budget does not contain.
        expect(shares.landSecured).toBe(0);
        expect(shares.designCompleted).toBe(0);
        expect(shares.exteriorWork).toBe(0);
      });

      it('holds back exactly the seed retention for handover', () => {
        // No BQ section prices snagging and handover, and paying the build out in full
        // before anybody inspects it is not an improvement. The seed's own number.
        expect(shares.finalHandover).toBe(STAGE_BUDGET_PCT.finalHandover);
      });

      it('gives each stage the sum of the sections that do its work', () => {
        const takeoff = runTakeoff(fixture.input as never, buildLegacyRate(fixture.input))!;
        const total   = SECTION_KEYS.reduce((a, k) => a + Math.max(0, takeoff.sectionsLocal[k]), 0);
        const priced  = 100 - STAGE_BUDGET_PCT.finalHandover;

        const expected = Object.fromEntries(STAGE_KEYS.map(k => [k, 0])) as Record<StageKey, number>;
        for (const section of SECTION_KEYS) {
          expected[SECTION_TO_STAGE[section]] += (takeoff.sectionsLocal[section] / total) * priced;
        }
        // Every stage but the one that absorbs the rounding drift lands exactly.
        for (const k of STAGE_KEYS) {
          if (k === 'finalHandover') continue;
          expect(shares[k], k).toBeCloseTo(expected[k], 6);
        }
      });
    });
  }

  it('the frame and every floor above it are one stage', () => {
    // A BQ prices the ground floor and the upper floors as separate sections; one stage
    // builds all of it, and splitting them across two milestones would invent a stage.
    expect(SECTION_TO_STAGE.ground_floor).toBe('structureWalls');
    expect(SECTION_TO_STAGE.upper_floor).toBe('structureWalls');
    // Both services run while the walls are open and are approved together.
    expect(SECTION_TO_STAGE.electrical).toBe('electricalPlumbing');
    expect(SECTION_TO_STAGE.plumbing).toBe('electricalPlumbing');
    // Doors and windows are hung as part of finishing.
    expect(SECTION_TO_STAGE.joinery).toBe('finishing');
  });

  it('every section reaches a stage', () => {
    // A section with no stage would be priced into the budget and then billed to nobody,
    // and the schedule would quietly stop summing to the construction fee.
    for (const section of SECTION_KEYS) {
      expect(STAGE_KEYS, section).toContain(SECTION_TO_STAGE[section]);
    }
  });
});

describe('the defect this replaces, measured', () => {
  /**
   * Not a style preference. These are the four Cameroonian bills of quantities the engine
   * is calibrated against, and on every one of them the flat split moves real money off
   * the stages that spend it.
   */
  it('Buea Residence: the foundation and the frame were underpaid by thousands', () => {
    const fixture = CAMEROON_BQS.find(f => f.name.includes('Buea'))!;
    const budget  = calculateBudget(fixture.input);
    const shares  = stageSharesFromTakeoff(fixture.input)!;
    const now = (k: StageKey) => Math.round(budget.construction * shares[k] / 100);
    const was = (k: StageKey) => Math.round(budget.construction * STAGE_BUDGET_PCT[k] / 100);

    // Underpaid where the spending actually happens — the half of a build where running
    // out of money stops it.
    expect(was('foundation')).toBeLessThan(now('foundation') * 0.6);
    expect(was('structureWalls')).toBeLessThan(now('structureWalls') * 0.65);
    // Overpaid afterwards, against work that costs less than the schedule claimed.
    expect(was('electricalPlumbing')).toBeGreaterThan(now('electricalPlumbing') * 1.9);
    expect(was('finishing')).toBeGreaterThan(now('finishing') * 1.8);
  });

  it('the flat split is wrong on every fixture, not just one', () => {
    for (const fixture of CAMEROON_BQS) {
      const shares = stageSharesFromTakeoff(fixture.input)!;
      const drift = STAGE_KEYS.reduce((a, k) => a + Math.abs(shares[k] - STAGE_BUDGET_PCT[k]), 0);
      // Total absolute misallocation, in percentage points of the construction fee.
      expect(drift, fixture.name).toBeGreaterThan(20);
    }
  });
});

describe('a project with nothing to read a split out of keeps the seed', () => {
  const seeds = getStageSeed('residential', 'single_family', 2);

  it('falls back rather than inventing a split from an average', () => {
    // A country with no take-off model. Guessing a per-stage split from a flat rate per
    // m² would dress an average up as a measurement.
    const { shares, fromTakeoff } = stageShares(seeds, { country: 'KE', sqm: 150, floors: 2 });
    expect(fromTakeoff).toBe(false);
    for (const seed of seeds) {
      expect(shares[seed.key as StageKey], seed.key).toBe(seed.budget_pct);
    }
  });

  it('reports when it did read one', () => {
    const { fromTakeoff } = stageShares(seeds, CAMEROON_BQS[0].input);
    expect(fromTakeoff).toBe(true);
  });

  it('returns null, not zeros, when there is no take-off', () => {
    // Zeros would be written to the schedule and bill the client nothing.
    expect(stageSharesFromTakeoff({ country: 'KE', sqm: 150, floors: 2 })).toBeNull();
  });
});

describe('the schedule is written from the split, in both writers', () => {
  const projects = code('src/lib/supabase/projects.ts');

  it('createProject derives every milestone from this project\'s own share', () => {
    expect(projects).toMatch(/const \{ shares \} = stageShares\(seeds, formData, opts\.rate, opts\.cityRate\);/);
    expect(projects).toMatch(/budget_pct:\s+shares\[s\.key as keyof typeof shares\] \?\? s\.budget_pct/);
    // And the milestone it writes must agree with the percentage it stored, or the row
    // disagrees with itself the moment anything re-derives from `budget_pct`.
    expect(projects).toMatch(/Math\.round\(budget\.construction \* \(shares\[s\.key as keyof typeof shares\] \?\? s\.budget_pct\) \/ 100\)/);
  });

  it('the seed percentage is no longer written blind', () => {
    expect(projects).not.toMatch(/budget_pct:\s+s\.budget_pct,/);
  });

  it('both wizard call sites hand over the rates they priced with', () => {
    // Re-resolving the rate inside createProject would run a SECOND take-off, and a
    // schedule from one take-off against a construction fee from another is how the
    // card and the stage list start disagreeing again.
    expect(code('src/components/wizard/steps/Step10PlanSelection.tsx'))
      .toMatch(/createProject\(user\.id, data, budget, \{ rate: constructionRate, cityRate \}\)/);
    expect(code('src/components/wizard/steps/Step11ConfirmBudget.tsx'))
      .toMatch(/rate: constructionRate, cityRate,/);
  });

  it('SQL still derives the milestone from budget_pct, and the column can hold a real share', () => {
    // 036/072 is the only writer on the re-price path (an admin confirming a Management
    // budget, a project joining mid-build through 103). It multiplies the stored
    // percentage, so the percentage has to be the real one AND has to fit.
    expect(src('supabase/migrations/072_professional_fee_breakdown.sql'))
      .toMatch(/COALESCE\(fixed_amount_usd, p_construction_fee \* budget_pct \/ 100\.0\)/);
    expect(src('supabase/migrations/183_the_schedule_follows_the_takeoff.sql'))
      .toMatch(/ALTER COLUMN budget_pct TYPE numeric\(9,6\)/);
  });

  it('183 re-cuts no live project', () => {
    // A schedule already agreed with a contractor and a client is not a migration's to
    // change underneath them.
    const body = src('supabase/migrations/183_the_schedule_follows_the_takeoff.sql')
      .replace(/^\s*--.*$/gm, '');
    expect(body).not.toMatch(/UPDATE\s+public\.project_stages/i);
    expect(body).not.toMatch(/INSERT\s+INTO/i);
  });
});

describe('a share is printed as a reader can use it', () => {
  it('trims the six stored decimals to one', () => {
    // 183 stores 48.455900. Printing it raw puts six meaningless digits beside a figure
    // in francs.
    expect(formatShare(48.4559)).toBe('48.5%');
    expect(formatShare(8)).toBe('8%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(null)).toBe('0%');
  });

  it('every surface that prints one goes through it', () => {
    for (const f of ['src/components/project/StageTracker.tsx', 'src/lib/pdf/export-budget.ts']) {
      expect(code(f), f).toMatch(/formatShare\(stage\.budget_pct\)/);
      expect(code(f), f).not.toMatch(/\$\{stage\.budget_pct\}%/);
    }
  });
});

describe('a build joined halfway is billed against its own split', () => {
  const full = calculateBudget(CAMEROON_BQS[1].input);

  it('what the client owes follows the project\'s shares, not the averages', () => {
    const shares = stageSharesFromTakeoff(CAMEROON_BQS[1].input)!;
    // Joining at the roof. Under Buea's own take-off the frame below is a far bigger
    // part of the build than the averages say, so far LESS is left to bill.
    const byAverage = joinedBudget(full, 6);
    const byTakeoff = joinedBudget(full, 6, shares);
    expect(byTakeoff.remainingShare).toBeLessThan(byAverage.remainingShare);
    // And the gap is money, not rounding.
    expect(Math.abs(byTakeoff.total - byAverage.total)).toBeGreaterThan(1000);
  });

  it('omitting the split still behaves exactly as it did', () => {
    // Every caller that has no take-off keeps the old numbers to the dollar.
    expect(joinedBudget(full, 6, STAGE_BUDGET_PCT)).toEqual(joinedBudget(full, 6));
  });

  it('Step 11 hands it the split it priced with', () => {
    expect(code('src/components/wizard/steps/Step11ConfirmBudget.tsx'))
      .toMatch(/joinedBudget\(fullBreakdown, startStage, joinShares\)/);
  });
});

describe('the Overview card adds up to the schedule underneath it', () => {
  const overview = code('src/components/project/OverviewTab.tsx');

  it('the planned column is summed from the obligations, not decomposed', () => {
    // `decomposeBudget(budget_usd)` assumes the standard fee mix. A project that joined
    // mid-build has design and permit dropped and the rest pro-rated, so running the
    // formula backwards produced a Construction line that no stage added up to — on
    // TAMSO, $2,242,660 against a stage column of about $2.35m.
    expect(overview).toMatch(/const plannedBySlice: BudgetBreakdown = project\.budget_source === 'boq' \? budget : hasObligations \? \{/);
    expect(overview).toMatch(/const plannedConstruction = stagesPaid \+ stagesUnpaid/);
    expect(overview).toMatch(/<CostBreakdownCard\s+budget=\{plannedBySlice\}/);
  });

  it('planned equals paid plus outstanding by construction', () => {
    // The property a client checks first, and the one that was missing.
    expect(overview).toMatch(/total:\s+paidTotal \+ outstanding,/);
  });

  it('the fee lines are the fee rows, not a formula', () => {
    expect(overview).toMatch(/const feePlanned = \(kind: ProjectFeeRow\['kind'\]\)/);
    for (const kind of ['permit', 'professional', 'verification', 'contingency']) {
      expect(overview, kind).toMatch(new RegExp(`feePlanned\\('${kind}'\\)`));
    }
  });

  it('pre-existing stages stay out of the planned side too', () => {
    // 103 zeroes them, but they must not be counted as obligations at all — they are not
    // money anybody will be asked for.
    expect(overview).toMatch(/const billableStages = sortedStages\.filter\(s => !s\.pre_existing\)/);
    expect(overview).toMatch(/const plannedConstruction = stagesPaid \+ stagesUnpaid/);
  });

  it('a project with no schedule yet still shows its estimate', () => {
    // Before tracking starts there are no milestones and no fee rows. Zeros on the screen
    // where a client decides whether to go ahead would be worse than the estimate.
    expect(overview).toMatch(/const hasObligations = billableStages\.length > 0 \|\| fees\.length > 0;/);
    expect(overview).toMatch(/\} : budget;/);
  });
});
