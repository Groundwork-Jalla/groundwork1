import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STEPS } from './application-steps';

/**
 * The contractor form became a six-step wizard because applicants said it was too long.
 * Splitting a form introduces two failures that a type checker cannot see, and both are
 * silent — the applicant just gets stuck.
 *
 *   1. A section lands on no step. Its fields can never be filled, so a rule that requires
 *      one blocks submission forever, with an error naming a field that is not on screen.
 *   2. A rule is dropped while splitting the old single validate() into per-step checks,
 *      and a mandatory field quietly becomes optional.
 *
 * Both are guarded here.
 */

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('STEPS', () => {
  it('reaches every section exactly once', () => {
    const seen = STEPS.flatMap(s => s.sections);
    expect([...seen].sort((a, b) => a - b)).toEqual(SECTIONS);
  });

  it('has no empty step', () => {
    for (const s of STEPS) expect(s.sections.length).toBeGreaterThan(0);
  });

  it('asks for documents last and references immediately before', () => {
    // Deliberate, and the reason the sections are not in numeric order. Both steps send
    // someone away from the screen to find a scan or a phone number, which is where an
    // application is abandoned — so they come after the answers are already saved.
    const last = STEPS[STEPS.length - 1];
    const beforeLast = STEPS[STEPS.length - 2];
    expect(last.sections).toContain(4);        // credentials & uploads
    expect(beforeLast.sections).toContain(5);  // project references
  });

  it('ends on the step carrying the final agreement, so submit sits under it', () => {
    expect(STEPS[STEPS.length - 1].sections).toContain(9);
  });
});

/**
 * Source-level, in the manner of `api-import-graph.test.ts`: `stepError` closes over
 * twenty pieces of component state and cannot be imported on its own, but what it checks
 * is still readable. If a mandatory field stops being validated, this fails.
 */
describe('mandatory fields stay mandatory', () => {
  const src = readFileSync('src/components/contractor/ContractorApplicationForm.tsx', 'utf8');
  const body = src.slice(src.indexOf('function stepError('), src.indexOf('function goTo('));

  it.each([
    'fullName', 'businessName', 'phone', 'email', 'country', 'city', 'role',
    'years', 'operatesAs', 'projectTypes',
    'whyJoin', 'differentiator', 'readyEarly',
    'milestones', 'verification', 'noSidePay',
    'regions', 'concurrent', 'agreed',
    'files', 'pending', 'projects',
  ])('%s is still checked before an application can be submitted', field => {
    expect(body).toContain(field);
  });

  it('still rejects an unreachable email rather than only an empty one', () => {
    expect(body).toContain('isValidEmail');
  });

  it('is the single source of the rules — handleSubmit re-runs it, not its own copy', () => {
    const submit = src.slice(src.indexOf('async function handleSubmit'));
    expect(submit).toContain('stepError(i)');
    // The old flat block listed every field inline. If that ever comes back the two
    // copies will drift, and the applicant is told to fix a field on a page they cannot see.
    expect(submit).not.toContain('!fullName || !businessName');
  });
});
