import { describe, expect, it } from 'vitest';
import { DOCUMENT_ROUTE, stepRoute, nextStep, prevStep, clampToRoute } from './wizard-route';

/**
 * Getting from the summary to the step that creates the project.
 *
 * 28 October, on a call: a contractor with a plan and a bill of quantities reached
 * "your project at a glance", ticked the budget confirmation, pressed Continue — and
 * the same screen came back from the top. Every time. Ruth watched him do it
 * repeatedly before giving up.
 *
 * The route he was on visits five screens, 1 2 3 8 9, and the provider kept only the
 * COUNT of them. `next()` clamped `prev + 1` to 5, so Continue on step 8 moved him to
 * step 5; the skip effect saw a step this route does not have and returned him to 8.
 * Step 9 is the one that creates the project. Nothing he did could have reached it.
 */

const DOCS = stepRoute(true, 9);
const PLAIN = stepRoute(false, 9);

describe('the document route', () => {
  it('visits five screens', () => {
    expect(DOCS).toEqual([1, 2, 3, 8, 9]);
    expect(DOCS).toHaveLength(5);
  });

  it('whose last one is step 9, not step 5', () => {
    // The whole bug in one assertion: the count and the final index differ.
    expect(DOCS.length).toBe(5);
    expect(DOCS[DOCS.length - 1]).toBe(9);
  });

  it('reaches the confirmation step from the summary', () => {
    expect(nextStep(DOCS, 8)).toBe(9);
  });

  it('never lands on a step it is meant to skip', () => {
    for (const skipped of [4, 5, 6, 7]) {
      expect(DOCUMENT_ROUTE as readonly number[]).not.toContain(skipped);
    }
    expect(nextStep(DOCS, 3)).toBe(8);
    expect(prevStep(DOCS, 8)).toBe(3);
  });

  it('walks forward 1 → 2 → 3 → 8 → 9 and stops', () => {
    const seen = [1];
    for (let i = 0; i < 6; i++) seen.push(nextStep(DOCS, seen[seen.length - 1]!));
    expect(seen).toEqual([1, 2, 3, 8, 9, 9, 9]);
  });

  it('and backward 9 → 8 → 3 → 2 → 1 and stops', () => {
    const seen = [9];
    for (let i = 0; i < 5; i++) seen.push(prevStep(DOCS, seen[seen.length - 1]!));
    expect(seen).toEqual([9, 8, 3, 2, 1, 1]);
  });
});

describe('goTo lands on the route, never on a count', () => {
  it('goTo(8) is 8 — this is how the plan question hands over', () => {
    // `PlanQuestionStep` calls goTo(8) the moment both documents are accepted.
    // Clamped to the count it became 5, a step this route does not contain.
    expect(clampToRoute(DOCS, 8)).toBe(8);
  });

  it('goTo(9) is 9', () => {
    expect(clampToRoute(DOCS, 9)).toBe(9);
  });

  it('a skipped step goes forward to the next real one, not back to a count', () => {
    for (const skipped of [4, 5, 6, 7]) expect(clampToRoute(DOCS, skipped)).toBe(8);
  });

  it('beyond the end is the end; before the start is the start', () => {
    expect(clampToRoute(DOCS, 99)).toBe(9);
    expect(clampToRoute(DOCS, 0)).toBe(1);
    expect(clampToRoute(DOCS, -3)).toBe(1);
  });
});

describe('a step that is not on the route at all', () => {
  it('moves forward onto it rather than stranding anyone', () => {
    // A draft saved before the plan question existed can hold step 6.
    expect(nextStep(DOCS, 6)).toBe(8);
  });

  it('and backward onto it', () => {
    expect(prevStep(DOCS, 6)).toBe(3);
  });

  it('with nothing ahead, it settles on the last step', () => {
    expect(nextStep([1, 2], 7)).toBe(2);
  });
});

describe('the ordinary nine-step route is untouched', () => {
  it('has every step', () => {
    expect(PLAIN).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('advances and retreats one at a time', () => {
    expect(nextStep(PLAIN, 4)).toBe(5);
    expect(prevStep(PLAIN, 4)).toBe(3);
  });

  it('stops at both ends', () => {
    expect(nextStep(PLAIN, 9)).toBe(9);
    expect(prevStep(PLAIN, 1)).toBe(1);
  });

  it('and still reaches the step that creates the project', () => {
    expect(nextStep(PLAIN, 8)).toBe(9);
  });
});
