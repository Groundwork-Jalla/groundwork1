import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A policy that guards INSERT ... RETURNING must read the row, not look it up.
 *
 * `createProject` does `.insert().select().single()`. Postgres only returns rows the
 * SELECT policy can see, and 086's `project_member()` decides membership by querying
 * `projects` for the very row being inserted — which is not visible while the statement
 * is still running. So a client could not create a project at all: the insert went in
 * and the read back was refused, and the wizard reported it as "Groundwork would not
 * save this project to your account".
 *
 * 120 found and fixed this for contractors and wrote the rule down. 140 applies the
 * same rule to the owner, which is the case 120 missed.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '');

const m120 = strip(read('supabase/migrations/120_contractor_project_insert_returning.sql'));
const m140 = strip(read('supabase/migrations/140_owner_project_insert_returning.sql'));

/** The policy statement alone. The file's COMMENT explains the bug and names the very
 *  things the policy must not contain, so the whole file cannot be asserted on. */
const policy140 = m140.slice(m140.indexOf('CREATE POLICY "owner_select_own_projects"'),
                             m140.indexOf('COMMENT ON POLICY'));

describe('the owner can read back the project they just created', () => {
  it('140 decides ownership from the row, with no subquery', () => {
    // The whole point. Any EXISTS/SELECT against another table reintroduces the bug.
    expect(policy140).toMatch(/USING \(user_id = auth\.uid\(\)\)/);
    expect(policy140).not.toMatch(/EXISTS\s*\(/i);
    expect(policy140).not.toMatch(/project_member\s*\(/);
    // No subquery of any kind: a FROM inside USING is how the bug gets back in.
    expect(policy140.slice(policy140.indexOf('USING'))).not.toMatch(/\bFROM\b/i);
  });

  it('and is a SELECT policy, because RETURNING is a read', () => {
    expect(policy140).toMatch(/FOR SELECT TO authenticated/);
  });

  it('it does not touch the insert policy', () => {
    // Inserting was never the problem; a plain insert always worked.
    expect(policy140).not.toMatch(/FOR INSERT/);
    expect(policy140).not.toMatch(/FOR (UPDATE|DELETE|ALL)/);
  });

  it('it does not remove the membership policy that other roles rely on', () => {
    // Contractors and verifiers reach a project through project_member(). Dropping it
    // would fix the client and lock everybody else out.
    expect(m140).not.toMatch(/DROP POLICY IF EXISTS "member_select_projects"/);
  });

  it('and is idempotent', () => {
    expect(m140).toMatch(/DROP POLICY IF EXISTS "owner_select_own_projects"/);
  });
});

describe('it is the same rule 120 already established', () => {
  it('120 fixed the contractor case by reading the row’s own columns', () => {
    expect(m120).toMatch(/created_by = auth\.uid\(\)/);
    expect(m120).not.toMatch(/EXISTS\s*\(\s*SELECT[\s\S]{0,60}FROM public\.projects/i);
  });

  it('and 140 says which case it is repeating it for', () => {
    expect(m140).toMatch(/120/);
  });
});
