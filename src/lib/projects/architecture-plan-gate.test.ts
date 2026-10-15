import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { planSeed, planDocuments } from './plan-answer';
import type { PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';

/**
 * "Does your project have an architecture plan?"
 *
 * Asked before the wizard, in the same words whether a client is setting up their own
 * project or a partner contractor is doing it for them. The answer decides whether
 * there is anything to estimate, and whether a bill of quantities is ever asked for.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gate       = strip(read('src/components/wizard/ArchitecturePlanGate.tsx'));
const contractor = strip(read('src/app/routes/work/clients.new.tsx'));
const client     = strip(read('src/app/routes/projects/new.tsx'));
const confirm    = strip(read('src/components/wizard/steps/Step11ConfirmBudget.tsx'));

const YES = (over: Partial<Extract<PlanAnswer, { hasPlan: true }>> = {}): PlanAnswer =>
  ({ hasPlan: true, floorPlan: null, bq: null, reading: null, ...over });

describe('the answer carried into the wizard', () => {
  it('NO records a definite false, which is what stops the BQ being asked for again', () => {
    // `null` would leave the final step's attachment box showing. Only a definite NO
    // suppresses it, so the difference matters.
    expect(planSeed({ hasPlan: false })).toEqual({ hasArchitecturePlan: false, bqTotalUsd: null });
  });

  it('an unanswered question changes nothing', () => {
    expect(planSeed(null)).toEqual({});
  });

  it('YES carries a confident reading forward as the budget', () => {
    const answer = YES({ reading: { total: 13_500_000, label: 'Grand Total', confidence: 'grand' } });
    expect(planSeed(answer)).toEqual({ hasArchitecturePlan: true, bqTotalUsd: 13_500_000 });
  });

  it('but a GUESS is not carried forward', () => {
    /**
     * THE ONE THAT MATTERS. A `sum` reading is the largest number on the page, which
     * on a BQ whose sections were never totalled is merely the largest section. That
     * figure would become the construction budget and be split across ten stage
     * payments, so it is left for the person to type instead.
     */
    const answer = YES({ reading: { total: 9_000_000, label: 'Superstructure', confidence: 'sum' } });
    expect(planSeed(answer).bqTotalUsd).toBeNull();
    expect(planSeed(answer).hasArchitecturePlan).toBe(true);
  });

  it('the seed only ever sets fields the question is about', () => {
    for (const answer of [{ hasPlan: false } as PlanAnswer, YES()]) {
      for (const key of Object.keys(planSeed(answer))) {
        expect(['hasArchitecturePlan', 'bqTotalUsd']).toContain(key);
      }
    }
  });

  it('both fields exist on the default form data, so nothing is undefined', () => {
    expect(WIZARD_DEFAULT_DATA.hasArchitecturePlan).toBeNull();
    expect(WIZARD_DEFAULT_DATA.bqTotalUsd).toBeNull();
  });
});

describe('the documents', () => {
  it('file the floor plan as a drawing and the BQ as a costing', () => {
    // Filing both as 'boq' would show two bills of quantities and no plan in the
    // Documents tab.
    const plan = new File(['x'], 'plan.pdf');
    const bq   = new File(['y'], 'boq.csv');
    expect(planDocuments(YES({ floorPlan: plan, bq }))).toEqual([
      { file: plan, category: 'other' },
      { file: bq,   category: 'boq' },
    ]);
  });

  it('a NO answer has nothing to upload', () => {
    expect(planDocuments({ hasPlan: false })).toEqual([]);
    expect(planDocuments(null)).toEqual([]);
  });
});

describe('the question itself', () => {
  it('is the same question in both places', () => {
    // "It's the same design that you see now that will also appear on the client's
    // floor." One component, two mount points — so the wording cannot drift.
    expect(contractor).toMatch(/<ArchitecturePlanGate/);
    expect(client).toMatch(/<ArchitecturePlanGate/);
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      expect(read(f)).toMatch(/planGate: \{/);
    }
  });

  it('asks it before the wizard, never after', () => {
    for (const [name, src] of [['contractor', contractor], ['client', client]] as const) {
      const gateAt   = src.indexOf('<ArchitecturePlanGate');
      const wizardAt = src.indexOf('<WizardProvider');
      expect(gateAt, `${name}: no gate`).toBeGreaterThan(-1);
      expect(wizardAt, `${name}: the gate must come first`).toBeGreaterThan(gateAt);
    }
  });

  it('uses the plain term, not the technical one', () => {
    // "The technical term is design, but everybody won't understand."
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  planGate: {'));
    const copy = block.slice(0, block.indexOf('\n  },'));
    expect(copy).toMatch(/architecture plan/i);
    expect(copy).not.toMatch(/architectural design\b/i);
  });

  it('requires both documents on the YES path', () => {
    // Both are the point of that route. Somebody who cannot produce them belongs on
    // the other branch, and Back is how they get there.
    expect(gate).toMatch(/disabled=\{!floorPlan \|\| !bq \|\| scanning\}/);
    expect(gate).toMatch(/setSlide\('ask'\)/);
  });

  it('shows what it read, with the row it came from', () => {
    // A figure that becomes ten stage payments is not accepted unseen.
    expect(gate).toMatch(/reading\.label/);
    expect(gate).toMatch(/confirmLater/);
    expect(gate).toMatch(/guessedTotal/);
  });
});

describe('the NO path stops asking for a bill of quantities', () => {
  it('the final step hides the attachment box on a definite NO', () => {
    expect(confirm).toMatch(/\{data\.hasArchitecturePlan !== false && \(/);
  });

  it('and keeps it when the question was never put', () => {
    // `!== false` rather than `=== true`, scoped to the attachment box itself: a
    // draft from before this question existed carries null, and that person was never
    // asked — hiding it from them would be hiding it on a guess.
    const box = confirm.slice(confirm.indexOf('data.hasArchitecturePlan !== false'));
    expect(box.slice(0, 80)).not.toMatch(/=== true/);
    expect(confirm).toMatch(/\{data\.hasArchitecturePlan !== false && \(/);
  });

  it('the BQ figure replaces the estimate only when there genuinely is one', () => {
    // `pricedFromBq` needs BOTH: the YES answer and a figure we were confident
    // enough to carry. YES with an unreadable BQ still shows the estimate, because
    // the alternative is an empty box labelled as their bill of quantities.
    expect(confirm).toMatch(
      /pricedFromBq = data\.hasArchitecturePlan === true && data\.bqTotalUsd != null/);
    expect(confirm).toMatch(/opening   = data\.bqTotalUsd \?\? estimate/);
  });

  it('and the comparison against the estimate is suppressed on that path', () => {
    // There is no estimate to compare against — the estimating questions were never
    // asked — so "4000% above our estimate" would be alarming nonsense.
    expect(confirm).toMatch(/!pricedFromBq && Math\.abs\(diffPct\) >= 1/);
  });
});

describe('resuming', () => {
  it('a wizard already in progress is not interrupted', () => {
    expect(contractor).toMatch(/wizardAlreadyStarted\(/);
  });

  it('switching client asks again, because the answer belongs to a client', () => {
    const reset = contractor.slice(contractor.indexOf('function startAnotherClient'));
    expect(reset.slice(0, reset.indexOf('\n  }'))).toMatch(/setPlanAnswer\(null\)/);
  });
});
