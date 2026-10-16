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
  it('the verifier work list', () => {
    expect(m130).toMatch(/https:\/\/www\.tryjalla\.com\/verifiers"/);
  });

  it('NOT /verifiers/projects/<id>, which is not a route', () => {
    /**
     * 123 and 125 build `/verifiers/projects/<id>?tab=messages` for message
     * notifications, and the verifier surface only has `/verifiers` and `/verifiers/:id`
     * — where `:id` is a verification, not a project. That dead link is a separate bug;
     * this must not add a second one.
     */
    const body = m130.slice(m130.indexOf('body_html :='));
    expect(body).not.toMatch(/verifiers\/projects/);
  });

  it('and the routes really are what this assumes', () => {
    const routes = read('src/app/routes.ts');
    expect(routes).toMatch(/route\("verifiers",\s+"routes\/verifiers\/index\.tsx"\)/);
    expect(routes).not.toMatch(/verifiers\/projects/);
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
