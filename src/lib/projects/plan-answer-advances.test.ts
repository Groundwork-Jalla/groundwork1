import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planDocuments, planQuestionDue } from '@/lib/projects/plan-answer';
import type { PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';
import { NO_FLOOR_PLAN_FACTS } from '@/lib/budget/extract-bq';

/**
 * Answering the plan question must actually leave the plan question.
 *
 * Favour, 11 Nov 2026, blocked on a call with Philip: "same thing / i can't proceed",
 * with both files attached and the bill already read — 59,675,280 XAF on screen.
 *
 * The button was not dead. The click fired, `planSeed` ran, the answer was written. Then
 * `planQuestionDue` was recomputed and said the question was STILL due, so the gate
 * re-rendered and put the person back exactly where they started. A loop, not a freeze,
 * which is why nothing in the console said anything.
 *
 * ── THE ONE WORD ─────────────────────────────────────────────────────────────────────
 * 179 gave a drawing its own category. `planDocuments` began filing plans as
 * 'floor_plan' on 9 Nov and Step 11 was updated with it; `PlanQuestionStep` and
 * `WizardContext` kept asking whether a document of category 'other' had been uploaded.
 * Nothing threw, nothing logged, and the two halves simply stopped agreeing.
 *
 * These assertions run the real `planDocuments` output through the real `planQuestionDue`
 * so the pair cannot drift again without this failing.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const file = (name: string) => new File(['x'], name, { type: 'application/pdf' });

const answered: PlanAnswer = {
  hasPlan: true,
  floorPlans: [file('Architecture file Sample.pdf')],
  bq: file('BOQ Sample.xlsx'),
  reading: null,
  lineItems: [],
  floorPlanFacts: [{ ...NO_FLOOR_PLAN_FACTS }],
  bqStatedFloors: null,
};

describe('the documents the answer produces satisfy the question that asked for them', () => {
  const docs = planDocuments(answered);

  it('a plan is filed as a plan', () => {
    expect(docs.map(d => d.category).sort()).toEqual(['boq', 'floor_plan']);
  });

  it('and the question is then no longer due', () => {
    // The exact pairing PlanQuestionStep computes, against the exact rows it is handed.
    const hasPlanDoc = docs.some(d => d.category === 'floor_plan' || d.category === 'other');
    const hasBqDoc   = docs.some(d => d.category === 'boq');

    expect(hasPlanDoc, 'the uploaded plan must count as a plan').toBe(true);
    expect(planQuestionDue({
      step: 8, hasPlan: true, hasPlanDoc, hasBqDoc, seen: false,
    })).toBe(false);
  });

  it('asking only for the pre-179 category is what caused the loop', () => {
    // The bug, pinned as arithmetic rather than as prose: with the old test the
    // question stayed due and the wizard bounced straight back to the upload screen.
    const asItWas = docs.some(d => d.category === 'other');
    expect(asItWas).toBe(false);
    expect(planQuestionDue({
      step: 8, hasPlan: true, hasPlanDoc: asItWas, hasBqDoc: true, seen: false,
    })).toBe(true);
  });
});

describe('every reader of that pairing was updated', () => {
  it('PlanQuestionStep accepts a floor plan', () => {
    const step = code('src/components/wizard/PlanQuestionStep.tsx');
    expect(step).toMatch(/doc\.category === 'floor_plan' \|\| doc\.category === 'other'/);
    expect(step, 'the pre-179 category alone').not.toMatch(/some\(doc => doc\.category === 'other'\)/);
  });

  it('WizardContext accepts a floor plan', () => {
    const ctx = code('src/contexts/WizardContext.tsx');
    expect(ctx).toMatch(/doc\.category === 'floor_plan' \|\| doc\.category === 'other'/);
    expect(ctx).not.toMatch(/docs\.some\(doc => doc\.category === 'other'\);/);
  });

  it('no wizard file still tests the old category alone', () => {
    // The sweep that would have caught it on 9 Nov.
    for (const f of [
      'src/components/wizard/PlanQuestionStep.tsx',
      'src/components/wizard/steps/Step11ConfirmBudget.tsx',
      'src/contexts/WizardContext.tsx',
      'src/lib/projects/plan-answer.ts',
    ]) {
      const body = code(f);
      const bare = body.match(/category === 'other'/g) ?? [];
      const paired = body.match(/'floor_plan' \|\| doc\.category === 'other'/g) ?? [];
      expect(bare.length, `${f} tests 'other' without 'floor_plan'`).toBe(paired.length);
    }
  });
});
