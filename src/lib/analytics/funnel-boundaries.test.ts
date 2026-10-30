import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where each sequence begins and ends, as agreed 30 Oct 2026.
 *
 * The meeting that produced these boundaries opened with the funnel numbers
 * disagreeing with each other, and the cause was inference: finishing onboarding with
 * "I have a project" was ALSO being read as the start of a partner application, so one
 * click ended one sequence and began another. Philip: "starting an application differs
 * fundamentally from selecting options like lacking a project."
 *
 * These tests exist so the next person cannot quietly reintroduce an inferred
 * boundary. Every one of them asserts that the event is recorded at the place the
 * action happens.
 */

const read = (p: string) => readFileSync(p, 'utf8');

describe('the three sequences are independent', () => {
  it('onboarding ends on the project question, and claims nothing else', () => {
    const onboarding = read('src/app/routes/work/onboarding.tsx');
    expect(onboarding).toMatch(/trackFunnel\('contractor_onboarding', 'completed'\)/);
    // The click that ends onboarding must NOT also start the partner application.
    expect(onboarding).not.toMatch(/trackFunnel\('partner_application'/);
  });

  it('the partner application starts on its own page, on Next', () => {
    const partner = read('src/app/routes/work/partner.tsx');
    const advance = partner.slice(partner.indexOf('function continueTo'));
    expect(advance.slice(0, 600)).toMatch(/trackFunnel\('partner_application', 'started'\)/);
  });

  it('and ends on Send application, not on booking a call', () => {
    const partner = read('src/app/routes/work/partner.tsx');
    expect(partner).toMatch(/trackFunnel\('partner_application', 'completed'\)/);
    // The booking is its own sequence. Collapsing the two would hide the people who
    // file an application and never book.
    expect(partner).toMatch(/trackFunnel\('call_booking', 'started'\)/);
    expect(partner).not.toMatch(/trackFunnel\('partner_application', 'completed'\)[\s\S]{0,200}bookingUrl/);
  });
});

describe('project creation is counted per attempt', () => {
  it('opens an attempt when the wizard opens and closes the same one on confirm', () => {
    const start = read('src/app/routes/projects/new.tsx');
    const done  = read('src/components/wizard/steps/Step11ConfirmBudget.tsx');
    expect(start).toMatch(/projectAttemptId\(\)/);
    expect(start).toMatch(/trackFunnel\('project_creation', 'started', attempt\)/);
    expect(done).toMatch(/currentProjectAttemptId\(\)/);
    expect(done).toMatch(/trackFunnel\('project_creation', 'completed', attempt\)/);
    expect(done).toMatch(/clearProjectAttempt\(\)/);
  });

  it('never records half a pair when storage is unavailable', () => {
    // A start with no id could never be closed, so it would read as abandoned for
    // ever. Both sides are guarded on having an id.
    const start = read('src/app/routes/projects/new.tsx');
    expect(start).toMatch(/if \(attempt\) trackFunnel\('project_creation', 'started'/);
  });
});

describe('an invitation is closed by its subject, not by its sender', () => {
  it('records the send and the acceptance against the same project', () => {
    const viewers = read('src/lib/supabase/project-viewers.ts');
    expect(viewers).toMatch(/trackFunnel\('client_invitation', 'started', projectId\)/);
    expect(viewers).toMatch(/trackFunnel\('client_invitation', 'completed', projectId\)/);
  });

  it('and the SQL closes a pair on the subject when there is one', () => {
    // The two ends are different people — the contractor sends, the client accepts.
    // Matching on user_id would leave every invitation permanently incomplete.
    const sql = read('supabase/migrations/170_funnel_events.sql');
    expect(sql).toMatch(/ELSE d\.subject_id = q\.subject_id/);
  });
});

describe('the counts cannot be inflated or go negative', () => {
  const sql = readFileSync('supabase/migrations/170_funnel_events.sql', 'utf8');

  it('keeps the first occurrence, so a retry is not a second person', () => {
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(sql).toMatch(/funnel_events_once/);
  });

  it('counts incomplete rather than subtracting to reach it', () => {
    // Philip asked for standing categories, not negative numbers. A subtraction goes
    // negative for anyone already mid-flow when tracking was switched on.
    expect(sql).not.toMatch(/'started'\)\s*\n?\s*-\s*count/);
    expect(sql).toMatch(/'incomplete', count\(\*\) FILTER \(/);
  });

  it('never lets the browser choose whose event it is', () => {
    expect(sql).toMatch(/v_actor uuid := auth\.uid\(\)/);
    // No INSERT policy: every write goes through the function.
    expect(sql).not.toMatch(/FOR INSERT TO authenticated/);
  });
});

describe('measuring never breaks the thing measured', () => {
  it('swallows its own failures', () => {
    const lib = readFileSync('src/lib/analytics/funnel.ts', 'utf8');
    expect(lib).toMatch(/} catch \{/);
    expect(lib).toMatch(/export function trackFunnel/);
  });
});
