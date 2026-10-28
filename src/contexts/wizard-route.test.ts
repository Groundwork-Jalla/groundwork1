import { createElement, type EffectCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_DEFAULT_DATA } from '@/types/project';

/**
 * Getting from the summary to the step that creates the project.
 *
 * A build with a plan and a bill of quantities skips steps 4 to 7 — the documents
 * answer those questions — so it visits five screens: 1, 2, 3, 8, 9. Five screens
 * whose LAST ONE IS STEP NINE, and that distinction is the whole of this file.
 *
 * `totalSteps` was the count, 5, and `next()` clamped `prev + 1` to it. Continue on
 * step 8 therefore moved to step 5; the provider's skip effect saw a step it was
 * meant to skip and put it back to 8; the screen reappeared from the top. A
 * contractor on a call on 28 October ticked the confirmation, pressed the button, and
 * went round that loop as many times as he was willing to try. Step 9 creates the
 * project, so nothing he did could ever have worked.
 */

type WizardValue = ReturnType<typeof useWizard>;
const h = vi.hoisted(() => ({ effects: [] as EffectCallback[], current: null as WizardValue | null }));

// The provider's effects are collected rather than run, as in wizard-draft.test.ts:
// this is a server render, and the skip effect must be fired deliberately so its part
// in the loop can be seen rather than guessed at.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { h.effects.push(effect); },
}));
vi.mock('@/lib/supabase/construction-rates', () => ({
  getCityRate: async () => null, getConstructionRate: async () => null,
}));

import { WizardProvider, useWizard, TOTAL_STEPS } from '@/contexts/WizardContext';

function Probe() {
  h.current = useWizard();
  return null;
}

/** Both documents present is what puts the wizard on the short route. */
const PLAN_DOCS = [
  { file: new File(['plan'], 'plan.pdf', { type: 'application/pdf' }), category: 'other' as const },
  { file: new File(['bq'], 'bq.xlsx'), category: 'boq' as const },
];

function render(step: number, { withDocs }: { withDocs: boolean }) {
  h.effects = [];
  h.current = null;
  renderToStaticMarkup(createElement(WizardProvider, {
    seed: { ...WIZARD_DEFAULT_DATA, hasArchitecturePlan: withDocs },
    pendingDocuments: withDocs ? PLAN_DOCS : undefined,
    children: createElement(Probe),
  }));
  // The provider starts at 1; walk it to where the contractor was.
  h.current?.goTo(step);
  return h.current!;
}

beforeEach(() => {
  h.effects = [];
  h.current = null;
});

describe('the document route reaches the step that creates the project', () => {
  it('counts five screens', () => {
    expect(render(1, { withDocs: true }).totalSteps).toBe(5);
  });

  it('but its last screen is step 9, not step 5', () => {
    // The bug in one line: the count and the final index are different numbers.
    const wizard = render(8, { withDocs: true });
    expect(wizard.step).toBe(8);
    wizard.next();
    expect(h.current?.step, 'Continue on the summary must reach the confirmation step').toBe(9);
  });

  it('does not bounce back to a step it is meant to skip', () => {
    // What the contractor saw: step 5, then the skip effect returning him to 8.
    const wizard = render(8, { withDocs: true });
    wizard.next();
    expect(h.current?.step).not.toBe(5);
    expect(h.current?.step).toBeGreaterThan(8);
  });

  it('goTo(8) lands on 8, which is how the plan question hands over', () => {
    // `PlanQuestionStep` calls goTo(8) the moment the documents are accepted. Clamped
    // to a count it became 5, which is a step this route does not have.
    expect(render(8, { withDocs: true }).step).toBe(8);
  });

  it('walks 1 → 2 → 3 → 8 → 9 and stops', () => {
    const wizard = render(1, { withDocs: true });
    const seen = [wizard.step];
    for (let i = 0; i < 6; i++) { h.current!.next(); seen.push(h.current!.step); }
    expect(seen).toEqual([1, 2, 3, 8, 9, 9, 9]);
  });

  it('and back again, without stranding anyone on a skipped step', () => {
    const wizard = render(9, { withDocs: true });
    const seen = [wizard.step];
    for (let i = 0; i < 5; i++) { h.current!.back(); seen.push(h.current!.step); }
    expect(seen).toEqual([9, 8, 3, 2, 1, 1]);
  });
});

describe('the ordinary route is untouched', () => {
  it('still has all nine steps', () => {
    expect(render(1, { withDocs: false }).totalSteps).toBe(TOTAL_STEPS);
  });

  it('still advances one at a time', () => {
    const wizard = render(4, { withDocs: false });
    wizard.next();
    expect(h.current?.step).toBe(5);
  });

  it('still stops at the last step', () => {
    const wizard = render(9, { withDocs: false });
    wizard.next();
    expect(h.current?.step).toBe(9);
  });

  it('still stops at the first going back', () => {
    const wizard = render(1, { withDocs: false });
    wizard.back();
    expect(h.current?.step).toBe(1);
  });
});
