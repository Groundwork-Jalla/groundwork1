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


/**
 * Verified is a QUALIFIED project that has gone further — 182.
 *
 * Confirmed definition, 9 Nov 2026:
 *
 *   "Verified project: A qualified project with a contractor delivering the work and
 *    the client financing it, both active on the project in Groundwork."
 *
 * 169 ordered the cases so that `client_joined AND has_ground_updates` was tested
 * FIRST, on its own. A project with a client and a site update but no bill of
 * quantities therefore read as verified, which the definition says cannot happen.
 *
 * Production had 0 verified projects when this was found, so no reported figure had
 * been wrong. It was fixed then anyway: the week's target is two verified projects and
 * the pipeline is being worked by hand, so the first one to land without a BQ on file
 * would have been counted and would not have been one. A metric that is only correct
 * while it reads zero is not yet a metric.
 */
const SQL_182_RAW = readFileSync(
  'supabase/migrations/182_verified_is_a_qualified_project.sql', 'utf8');

/**
 * The statements only, with `--` comments removed.
 *
 * Needed because 182's header QUOTES the clause it is replacing, to record what the bug
 * was. Asserting against the raw file therefore matched the documentation of the bug and
 * reported the fix as absent — the test was reading prose, not SQL.
 */
const SQL_182 = SQL_182_RAW.replace(/--[^\n]*/g, '');

describe('verified is a subset of qualified', () => {
  it('does not let the client and a site update alone make a project verified', () => {
    // The exact shape of the bug: the verified branch reached without the BQ test.
    expect(SQL_182).not.toMatch(/WHEN\s+client_joined AND has_ground_updates\s+THEN 'verified'/);
  });

  it('carries the qualified conditions into the verified branch', () => {
    expect(SQL_182).toMatch(
      /has_boq AND starts_soon AND client_joined AND has_ground_updates\s*\n?\s*THEN 'verified'/);
  });

  it('corrects the bulk view as well as the function', () => {
    // The admin cards read the view, not the function. Two copies of one definition is
    // how the funnel numbers disagreed with each other in the first place.
    expect(SQL_182).toMatch(/CREATE OR REPLACE FUNCTION public\.project_business_status/);
    expect(SQL_182).toMatch(/CREATE OR REPLACE VIEW public\.project_business_statuses/);
    // Both branches of the view must test the client and the ground, not just one.
    const view = SQL_182.slice(SQL_182.indexOf('CREATE OR REPLACE VIEW'));
    expect(view).toMatch(/v\.client_joined AND s\.has_ground_updates\s+THEN 'verified'/);
  });

  it('restates security_invoker, which CREATE OR REPLACE VIEW drops', () => {
    // Without it the view would run as its owner and hand every project to everybody.
    expect(SQL_182).toMatch(/SET \(security_invoker = true\)/);
    expect(SQL_182).toMatch(/REVOKE ALL ON public\.project_business_statuses FROM PUBLIC, anon/);
  });

  it('still measures the 60 days from creation, not from today', () => {
    expect(SQL_182).toMatch(/created_at::date \+ 60/);
    expect(SQL_182).not.toMatch(/now\(\)::date \+ 60/);
  });

  it('closes the start-date route into verified, not only the missing-BQ one', () => {
    // Running 169 and 182 side by side on PG16 turned up TWO ways through the old first
    // branch, not the one expected: a project with no bill of quantities, AND a project
    // with a bill but a start date 90 days out. The second looks complete from every
    // angle except the date, so it is the easier one to hit and the harder to spot.
    // Both are closed by the same clause, which is why it carries starts_soon and not
    // just has_boq.
    expect(SQL_182).toMatch(/has_boq AND starts_soon AND client_joined/);
    const view = SQL_182.slice(SQL_182.indexOf('CREATE OR REPLACE VIEW'));
    const verified = view.slice(0, view.indexOf("THEN 'verified'"));
    expect(verified).toMatch(/d\.has_boq/);
    expect(verified).toMatch(/created_at::date \+ 60/);
  });
});
