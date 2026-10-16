import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A verifier is told when they are put on a project.
 *
 * Reported from testing: "when I add a verifier to a project, he doesn't get an email."
 * Correct — `assign_verifier` (086) inserted the row, wrote an activity entry and
 * returned. The only verifier email that existed was 105's invite, sent once before they
 * even had an account, so an engineer assigned a month later learned about it by chance.
 * A verification blocks a stage from closing, so silence here stalls the build.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const m130 = read('supabase/migrations/130_verifier_told_of_assignment.sql');
const sql  = m130.replace(/--.*$/gm, '');

describe('it fires on becoming active, not on every write', () => {
  it('an assignment that is not active says nothing', () => {
    expect(sql).toMatch(/IF NEW\.status <> 'active' THEN RETURN NEW; END IF;/);
  });

  it('and an UPDATE of a row that was ALREADY active says nothing', () => {
    // `assign_verifier` reactivates an existing row rather than inserting a second, so
    // without this a discipline correction would re-announce work they already have.
    expect(sql).toMatch(/IF TG_OP = 'UPDATE' AND OLD\.status = 'active' THEN RETURN NEW; END IF;/);
  });

  it('on insert and on update, because reactivation is an update', () => {
    expect(sql).toMatch(/AFTER INSERT OR UPDATE ON public\.project_verifiers/);
  });
});

describe('nothing here may cost the assignment', () => {
  it('the bell is wrapped', () => {
    // An AFTER trigger that raises still aborts the statement.
    expect(sql).toMatch(/INSERT INTO public\.notifications[\s\S]{0,700}?EXCEPTION WHEN OTHERS THEN/);
  });

  it('the email is wrapped separately, so one cannot cost the other', () => {
    expect((sql.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length).toBe(2);
  });

  it('and an unconfigured mailer is a normal state', () => {
    expect(sql).toMatch(/IF v_email IS NULL OR v_email = '' OR resend_key IS NULL OR resend_key = ''/);
  });
});

describe('the link goes somewhere that exists', () => {

  it('into the project, carrying its id', () => {
    // An earlier draft pointed at `/verifiers` because the project route did not
    // exist. It does now, and somebody just told they are verifying a build needs the
    // build — its stages and the evidence against each — not a list to search.
    const body = m130.slice(m130.indexOf('body_html :='));
    expect(body).toMatch(/tryjalla\.com\/verifiers\/projects\/'\s*\n?\s*\|\| NEW\.project_id::text/);
  });

  it('and NOT /verifiers/<id>, which is a verification', () => {
    // At the moment of assignment there may be no verification yet; that link would
    // resolve to nothing for the very person being invited to start.
    const body = m130.slice(m130.indexOf('body_html :='));
    expect(body).not.toMatch(/verifiers\/'\s*\|\| NEW\.id/);
  });

  it('and every verifier link in the product now resolves to a real route', () => {
    /**
     * This used to assert `/verifiers/projects` did NOT exist, which is how the dead
     * link was discovered: 123 and 125 built `/verifiers/projects/<id>?tab=messages`
     * for message notifications against a surface that had only `/verifiers` and
     * `/verifiers/:id`. The route exists now, so the invariant is the one that
     * mattered all along — no link points at nothing.
     */
    const routes = read('src/app/routes.ts');
    expect(routes).toMatch(/route\("verifiers",\s+"routes\/verifiers\/index\.tsx"\)/);
    expect(routes).toMatch(/route\("verifiers\/projects\/:projectId"/);
    expect(read('supabase/migrations/125_message_link_opens_messages.sql'))
      .toMatch(/verifiers\/projects\/' \|\| p_project::text \|\| '\?tab=messages/);
  });
});

describe('what the verifier is actually told', () => {
  it('which project, and which discipline', () => {
    // "You have been assigned" without saying to what is a notification that makes
    // somebody go and look.
    expect(sql).toMatch(/'You have been assigned to ' \|\| v_project/);
    expect(sql).toMatch(/NEW\.discipline/);
  });

  it('the project name is escaped, because it is user-supplied', () => {
    expect(sql).toMatch(/public\.html_escape\(v_project\)/);
    expect(sql).toMatch(/public\.html_escape\(NEW\.discipline\)/);
  });

  it('and the notification carries the role, so the bell routes it as a verifier', () => {
    expect(sql).toMatch(/'role', 'verifier'/);
  });
});
