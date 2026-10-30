import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * One definition of a qualified or verified project, agreed 30 Oct 2026.
 *
 * The meeting that produced it opened with the partner-funnel numbers disagreeing
 * with each other, and Philip's instruction was that "every reported number should
 * be traceable" and the team must "use one shared definition of an activated
 * project". The definition therefore lives in SQL (169) and nowhere else.
 *
 * These tests exist to stop it being re-implemented in TypeScript the next time a
 * page needs a count. A second copy is how the numbers diverged the first time.
 */

const SQL = readFileSync('supabase/migrations/169_project_business_status.sql', 'utf8');

describe('the business status is defined once, in SQL', () => {
  it('names exactly the three agreed statuses', () => {
    expect(SQL).toMatch(/'verified'/);
    expect(SQL).toMatch(/'qualified'/);
    expect(SQL).toMatch(/'general'/);
  });

  it('qualifies on a bill of quantities AND a start date, never either alone', () => {
    // "A qualified project must have a bill of quantities and a timeline start date
    // within 60 days of creation."
    expect(SQL).toMatch(/has_boq AND starts_soon/);
    expect(SQL).toMatch(/category = 'boq'/);
  });

  it('measures the 60 days from creation, not from today', () => {
    // Otherwise a project silently falls out of "qualified" as the calendar moves,
    // and last week's report can never be reproduced.
    expect(SQL).toMatch(/created_at::date \+ 60/);
    expect(SQL).not.toMatch(/now\(\)::date \+ 60/);
  });

  it('requires the client to have ACCEPTED before a project is verified', () => {
    // Invited is not involved. Verified means the client is actually watching.
    expect(SQL).toMatch(/accepted_at IS NOT NULL/);
    expect(SQL).toMatch(/revoked_at IS NULL/);
    expect(SQL).toMatch(/client_joined AND has_ground_updates/);
  });

  it('keeps the business status apart from the product lifecycle', () => {
    // projects.status is active/on_hold/completed/archived. Philip was explicit that
    // the two must not be conflated, so the rule must not read that column at all.
    const rule = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(rule).not.toMatch(/p\.status/);
    expect(rule).not.toMatch(/'on_hold'|'archived'/);
  });

  it('does not let anon read it, and does not widen access through the view', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.project_business_status\(uuid\) FROM PUBLIC, anon/);
    expect(SQL).toMatch(/security_invoker = true/);
  });
});

describe('the start date it depends on is actually collected', () => {
  const step = readFileSync('src/components/wizard/steps/Step9Summary.tsx', 'utf8');

  it('blocks the wizard until a start date is given', () => {
    // Half of "qualified" is a start date. A field nobody fills in is a metric
    // nobody can report, so this one is required rather than offered.
    expect(step).toMatch(/const hasStartDate = !!data\.targetStartDate/);
    expect(step).toMatch(/canContinue=\{hasStartDate &&/);
  });

  it('leaves the end date optional', () => {
    // Only the start date feeds qualification; demanding an end date would be
    // friction with nothing behind it.
    expect(step).toMatch(/!data\.targetStartDate \|\| !data\.targetEndDate/);
  });
});
