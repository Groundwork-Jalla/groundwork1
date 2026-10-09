import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOINING_CONDITIONS } from '@/lib/supabase/joining-assessment';

/**
 * A joining assessment (107) is an opinion about work Groundwork never watched being
 * built. A verification is a decision about work it supervised, and it releases money.
 *
 * Everything below exists to keep those two apart. The failure this guards against is
 * not a crash — it is an assessment that reads as a verification, which would mean a
 * client paying for a stage nobody here checked, or a certificate issued over work we
 * cannot vouch for.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql  = read('supabase/migrations/107_joining_assessments.sql');
/**
 * 107's prose argues about verification constantly — in `--` comments AND in its
 * `COMMENT ON` bodies, which are documentation that happens to be a SQL string. Both
 * come out, so "this file never mentions certificates" is a claim about what it DOES.
 */
const code = sql
  .replace(/^\s*--.*$/gm, '')
  .replace(/COMMENT ON [\s\S]*?;\s*$/gm, '');
const libSrc = read('src/lib/supabase/joining-assessment.ts');
/** Its header explains the separation at length; the scan reads the code. */
const lib = libSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('it cannot be mistaken for a verification', () => {
  it('writes to its own table and never to stage_verifications', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.stage_joining_assessments/);
    expect(code).not.toMatch(/stage_verifications/);
    expect(lib).not.toMatch(/stage_verifications/);
  });

  it('offers no condition that reads as a verdict', () => {
    // 'verified' / 'approved' / 'rejected' are the verification vocabulary. An assessment
    // that could carry one would be read as a decision it is not.
    expect(JOINING_CONDITIONS).toEqual(['sound', 'needs_attention', 'defective', 'not_inspected']);
    for (const word of ['verified', 'approved', 'rejected', 'passed']) {
      expect(JOINING_CONDITIONS as readonly string[]).not.toContain(word);
    }
    expect(code).toMatch(/CHECK \(condition IN \('sound', 'needs_attention', 'defective', 'not_inspected'\)\)/);
  });

  it('issues no certificate', () => {
    expect(code).not.toMatch(/certificate/i);
  });

  it('leaves the release blocker alone, so a pre-existing stage stays unpayable', () => {
    // 103 returns 'pre_existing' before it looks at anything else. If 107 redefined that
    // function, a good assessment could become a reason to pay.
    expect(code).not.toMatch(/stage_release_blocker/);
    expect(code).not.toMatch(/payment_milestone_usd|authorise_release|record_payment_event/);
  });
});

describe('what it will accept', () => {
  it('only attaches to a stage nobody here watched', () => {
    expect(code).toMatch(/NOT COALESCE\(v_stage\.pre_existing, false\)/);
    expect(code).toMatch(/not_pre_existing/);
  });

  it('refuses the contractor, who is judging their own earlier work', () => {
    const fn = code.slice(code.indexOf('FUNCTION public.record_joining_assessment'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/public\.is_admin\(\)/);
    expect(body).toMatch(/project_verifiers[\s\S]*?status = 'active'/);
    expect(body).toMatch(/not_permitted/);
    // Membership alone is not enough — a contractor is a project member.
    expect(body).not.toMatch(/project_member\(/);
  });

  it('requires reasoning, not just a grade', () => {
    expect(code).toMatch(/notes\s+text NOT NULL CHECK \(btrim\(notes\) <> ''\)/);
  });

  it('refuses "not inspected" with photos attached', () => {
    expect(code).toMatch(/joining_assessment_uninspected_has_no_evidence/);
  });

  it('keeps one current finding per stage', () => {
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS stage_joining_assessments_one_per_stage/);
    expect(code).toMatch(/ON CONFLICT \(stage_id\) DO UPDATE/);
  });
});

describe('the record of it', () => {
  it('distinguishes a first review from an amendment, and keeps what it was', () => {
    expect(code).toMatch(/stage\.joining_assessed/);
    expect(code).toMatch(/stage\.joining_assessment_amended/);
    expect(code).toMatch(/'was',\s+v_existing\.condition/);
  });

  it('derives the project from the stage rather than trusting the caller', () => {
    // A mismatched project_id would file the assessment against one project's ledger
    // while describing another project's stage.
    expect(code).toMatch(/NEW\.project_id := v_stage\.project_id/);
  });

  it('is written only through the RPC — no direct insert policy exists', () => {
    expect(code).toMatch(/CREATE POLICY "members_read_joining_assessments"[\s\S]*?FOR SELECT/);
    expect(code).not.toMatch(/FOR INSERT|FOR UPDATE|FOR ALL/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_joining_assessment\(uuid, text, text, jsonb\) TO authenticated;/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.record_joining_assessment\(uuid, text, text, jsonb\) FROM PUBLIC, anon;/);
  });

  it('is readable by the client, who is the person it is about', () => {
    // Hiding a 'defective' finding from the person paying for the build would make the
    // record worse than not having one.
    expect(code).toMatch(/USING \(public\.project_member\(project_id\) OR public\.is_admin\(\)\)/);
  });
});

describe('the browser side survives 107 not being applied', () => {
  it('treats a missing table as "nothing recorded", not as a broken page', () => {
    expect(lib).toMatch(/42P01|PGRST205/);
    expect(lib).toMatch(/return new Map\(\)/);
  });

  it('narrows the evidence array rather than trusting the column', () => {
    expect(lib).toMatch(/Array\.isArray\(r\.evidence_paths\)/);
    expect(lib).toMatch(/typeof p === 'string'/);
  });
});

describe('the wording never claims Groundwork checked the work', () => {
  for (const dict of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
    it(`${dict} carries the joining strings`, () => {
      const d = read(dict);
      for (const key of ['title:', 'condition:', 'notes:', 'notPayable:', 'not_inspected:']) {
        expect(d.slice(d.indexOf('    joining: {'))).toContain(key);
      }
    });
  }

  it('says plainly that a review does not make the stage payable', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('    joining: {'), en.indexOf('    lifecycle: {'));
    expect(block).toMatch(/does not make it payable/);
    expect(block).toMatch(/did not fund or check this work/);
    // The badge beside it must keep saying where the work came from.
    expect(en).toMatch(/pre_existing:\s+'Completed outside Groundwork'/);
  });
});
