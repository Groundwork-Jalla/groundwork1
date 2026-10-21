import { describe, expect, it } from 'vitest';
import { isDecisionReady, QUALIFYING_YEARS } from './partner-application';

/**
 * Who may book a call with Philip.
 *
 * His calendar is the constraint — eighteen calls produced four qualified professionals
 * — so the three conditions are checked before a slot is offered, not after. Somebody
 * who cannot meet them is never shown the calendar, rather than being given a time and
 * turned away on it.
 */

const ready = (o: Partial<Parameters<typeof isDecisionReady>[0]>) =>
  isDecisionReady({ hasCurrentProject: true, willIntroduce: true, yearsExperience: '10+', ...o });

describe('all three conditions, not two', () => {
  it('a live project, a willingness to introduce it, and five years', () => {
    expect(ready({})).toBe(true);
  });

  it('no live diaspora project means no call', () => {
    expect(ready({ hasCurrentProject: false })).toBe(false);
  });

  it('unwilling to introduce the client means no call', () => {
    expect(ready({ willIntroduce: false })).toBe(false);
  });

  it('under five years means no call', () => {
    expect(ready({ yearsExperience: '1-3' })).toBe(false);
  });
});

describe('where five years falls', () => {
  it('3–5 does NOT qualify', () => {
    // Somebody in that band may have three. "At least five years" is read strictly,
    // because the point of the gate is that the hour is worth spending.
    expect(ready({ yearsExperience: '3-5' })).toBe(false);
  });

  it('5–10 and 10+ do', () => {
    expect(ready({ yearsExperience: '5-10' })).toBe(true);
    expect(ready({ yearsExperience: '10+' })).toBe(true);
  });

  it('and the qualifying bands are named in one place', () => {
    expect([...QUALIFYING_YEARS].sort()).toEqual(['10+', '5-10']);
  });
});

describe('older callers that do not know about experience', () => {
  it('still get an answer from the two they do know', () => {
    // The parameter is optional so the rule could be extended without breaking every
    // existing call site; absent means the experience condition is not applied.
    expect(isDecisionReady({ hasCurrentProject: true, willIntroduce: true })).toBe(true);
    expect(isDecisionReady({ hasCurrentProject: false, willIntroduce: true })).toBe(false);
  });
});
