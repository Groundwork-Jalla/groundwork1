import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 104 — the production reconciliation.
 *
 * 101, 102 and 103 were applied to production BEFORE review and then amended in place. 104 is
 * the forward-only correction that brings either starting state to the reviewed one, so the
 * ledger never says "101 applied" while the SQL under 101 means something else.
 *
 * What these tests protect is the property that makes it safe to run: every statement must
 * reach the same end state from a database that has the OLD shape and from one that has the
 * AMENDED shape, and must be harmless on a third run. That is a property of how the statements
 * are written, which is why it is checked here rather than only in a database.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SQL = read('supabase/migrations/104_reconcile_payment_project_amendments.sql');
/** Comments explain these rules at length; scanning raw text reads the warning as the breach. */
const body = SQL.replace(/--[^\n]*/g, ' ');

describe('104 carries every reviewed amendment', () => {
  it('fixes the live breakage first: the bank column and its RPC parameter', () => {
    // The deployed app calls add_payout_destination with p_bank_key; production has
    // p_bank_code, so saving payout details fails outright until this runs.
    expect(body).toMatch(/RENAME COLUMN bank_code TO bank_key/);
    expect(body).toMatch(/DROP FUNCTION IF EXISTS public\.add_payout_destination\(/);
    expect(body).toMatch(/p_bank_key text DEFAULT NULL/);
  });

  it('installs the payout snapshot path', () => {
    expect(body).toMatch(/FUNCTION public\.payout_initiation_target\(p_payment uuid\)/);
    expect(body).toMatch(/GRANT  EXECUTE ON FUNCTION public\.payout_initiation_target\(uuid\) TO service_role;/);
  });

  it('corrects the constraint that made a verified destination un-retirable', () => {
    expect(body).toMatch(/DROP CONSTRAINT IF EXISTS payout_destination_verified_dated/);
    expect(body).toMatch(/CHECK \(status <> 'verified' OR verified_at IS NOT NULL\)/);
  });

  it('re-runs the phone backfill deterministically', () => {
    expect(body).toMatch(/HAVING count\(DISTINCT public\.normalised_phone\(a\.phone\)\) = 1/);
    expect(body).toMatch(/a\.user_id = p\.id/);
    // Never by email: the same address appears on unclaimed and second applications.
    expect(body).not.toMatch(/profiles[\s\S]{0,80}\.email\s*=\s*[\s\S]{0,40}applications[\s\S]{0,20}\.email/);
  });

  it('reports — never rewrites — what the old arbitrary backfill may have chosen', () => {
    // A profile phone matching one of several disagreeing application numbers might have been
    // picked by the old UPDATE..FROM, or typed by the contractor. Nothing distinguishes them.
    expect(body).toMatch(/HAVING count\(DISTINCT public\.normalised_phone\(a\.phone\)\) > 1/);
    expect(body).toMatch(/RAISE NOTICE/);
    // No UPDATE of profiles.phone in that reporting block.
    const report = body.match(/v_suspect[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(report).not.toMatch(/UPDATE public\.profiles/);
  });

  it('repairs the pre-existing timestamps, scoped to pre_existing only', () => {
    // The date policy itself is pinned under "104 never invents a recording date" below; this
    // test is only about scoping. An earlier version of this assertion required the `now()`
    // fallback that the review removed, which is why it is not here any more.
    //
    // The two CORRECTIVE updates must each be filtered on pre_existing. An unscoped one would
    // clear completed_at on stages Groundwork really did watch.
    //
    // Deliberately not a blanket rule over every UPDATE in the file: `admin_start_project_at_stage`
    // also writes stages and substages, scoped by `stage_number < v_start` because those rows are
    // BECOMING pre-existing in the same statement. Requiring a pre_existing filter there would be
    // requiring the function to test a flag it is in the middle of setting.
    const fix = body.match(/UPDATE public\.project_stages\s+SET pre_existing_recorded_at[\s\S]*?;/)?.[0] ?? '';
    expect(fix, 'the timestamp repair is not scoped').toMatch(/WHERE pre_existing/);
    const subs = body.match(/UPDATE public\.project_substages sub\s+SET approved_by = NULL[\s\S]*?;/)?.[0] ?? '';
    expect(subs, 'the approver clearing is not scoped').toMatch(/ps\.pre_existing/);
  });

  it('installs the named release refusal and the honest join RPC', () => {
    expect(body).toMatch(/IF v_stage\.pre_existing THEN RETURN 'pre_existing'; END IF;/);
    expect(body).toMatch(/RETURN 'nothing_due'/);
    expect(body).toMatch(/completed_at\s+= NULL/);
    expect(body).not.toMatch(/completed_at\s+= now\(\)/);
  });
});

describe('104 reaches one end state from either start', () => {
  it('renames only when the old name is there and the new one is not', () => {
    // On a database that already applied the amended 101 this must do nothing, not error.
    expect(body).toMatch(/column_name = 'bank_code'[\s\S]{0,400}column_name = 'bank_key'/);
    expect(body).toMatch(/AND NOT EXISTS/);
  });

  it('adds every column and constraint conditionally', () => {
    for (const m of body.matchAll(/ALTER TABLE public\.\w+\s+ADD COLUMN[\s\S]*?;/g)) {
      expect(m[0], 'a column add is not conditional').toMatch(/ADD COLUMN IF NOT EXISTS/);
    }
    // Constraints are guarded by a pg_constraint lookup, or dropped first.
    for (const name of ['project_stages_pre_existing_dated', 'payout_destination_verified_dated']) {
      expect(body, `${name} is not applied conditionally`)
        .toMatch(new RegExp(`(IF NOT EXISTS[\\s\\S]{0,200}${name}|DROP CONSTRAINT IF EXISTS ${name})`));
    }
  });

  it('replaces functions rather than creating them, except the one it must re-signature', () => {
    // add_payout_destination is DROP+CREATE because a parameter name cannot be changed in
    // place. Everything else is CREATE OR REPLACE, which is safe on both starting states.
    const creates = [...body.matchAll(/^CREATE (OR REPLACE )?FUNCTION public\.(\w+)/gm)];
    expect(creates.length).toBeGreaterThan(2);
    for (const c of creates) {
      if (c[2] === 'add_payout_destination') {
        expect(body).toMatch(/DROP FUNCTION IF EXISTS public\.add_payout_destination\(/);
      } else {
        expect(c[1], `${c[2]} is CREATE without OR REPLACE`).toBeTruthy();
      }
    }
  });

  it('destroys nothing', () => {
    // A reconciliation has no business dropping a table, a column or data.
    expect(body).not.toMatch(/DROP TABLE/i);
    expect(body).not.toMatch(/DROP COLUMN/i);
    expect(body).not.toMatch(/\bDELETE FROM\b/i);
    expect(body).not.toMatch(/TRUNCATE/i);
  });

  it('proves itself with a verify block covering each object it installs', () => {
    for (const probe of ['bank_key present', 'bank_code gone', 'p_bank_key',
                         'payout_initiation_target present', 'pre_existing_recorded_at present',
                         'claiming a build date', 'missing a recording date',
                         'naming an approver', 'unmessageable phone']) {
      expect(SQL, `the verify block does not check ${probe}`).toContain(probe);
    }
  });
});

describe('101–103 keep their amendments, so a fresh database needs no 104', () => {
  it('101 still holds the rename and the snapshot path', () => {
    const m101 = read('supabase/migrations/101_primary_contractor_payout.sql');
    expect(m101).toMatch(/RENAME COLUMN bank_code TO bank_key/);
    expect(m101).toMatch(/FUNCTION public\.payout_initiation_target/);
  });

  it('103 still holds the timestamp repair and the named refusal', () => {
    const m103 = read('supabase/migrations/103_join_project_in_progress.sql');
    expect(m103).toMatch(/pre_existing_recorded_at/);
    expect(m103).toMatch(/IF v_stage\.pre_existing THEN RETURN 'pre_existing'; END IF;/);
  });
});

describe('104 commits all of itself or none of it', () => {
  it('wraps the whole reconciliation in one transaction', () => {
    // Without this, a failure in §3 leaves production with the bank column renamed and its RPC
    // recreated but the pre-existing repair missing — a state no migration file describes.
    expect(body).toMatch(/^BEGIN;$/m);
    expect(body).toMatch(/^COMMIT;$/m);
    const begin = body.indexOf('\nBEGIN;');
    const commit = body.lastIndexOf('\nCOMMIT;');
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    // Every statement that changes anything sits inside the pair.
    for (const m of body.matchAll(/^(ALTER TABLE|CREATE (OR REPLACE )?FUNCTION|DROP FUNCTION|UPDATE) /gm)) {
      expect(m.index!, `a write at index ${m.index} is outside the transaction`).toBeGreaterThan(begin);
      expect(m.index!).toBeLessThan(commit);
    }
  });

  it('uses no operation that cannot run in a transaction', () => {
    expect(body).not.toMatch(/CONCURRENTLY/i);
    expect(body).not.toMatch(/\bVACUUM\b/i);
  });

  it('asserts its invariants rather than printing them', () => {
    // The SELECT block is for a human. A line reading "bank_code gone (expect 0) = 1" would
    // print and commit anyway, so a DO block raises before COMMIT is reached.
    const assertion = body.match(/DO \$\$\s*DECLARE\s+v_fail text\[\][\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(assertion, 'no fail-closed assertion block').not.toBe('');
    expect(assertion).toMatch(/RAISE EXCEPTION/);
    // And it is the last thing before COMMIT.
    expect(body.indexOf(assertion)).toBeLessThan(body.lastIndexOf('\nCOMMIT;'));
    // Each invariant the reviewer named is checked.
    for (const inv of ['bank_key is absent', 'old bank_code column still exists',
                       'does not expose p_bank_key', 'payout_initiation_target is absent',
                       'not one-directional', 'still claim a build date',
                       'carry no recording date', 'are not complete',
                       'still require verification', 'still name an approver',
                       'refuse a pre-existing stage by name', 'unmessageable phone']) {
      expect(assertion, `the assertion block does not check: ${inv}`).toContain(inv);
    }
  });
});

describe('104 repairs pre-existing rows before policing them', () => {
  it('canonicalises status and verification_required before the CHECKs are added', () => {
    // Adding `pre_existing ⇒ complete` to data that does not satisfy it aborts the migration on
    // rows an earlier run left behind.
    const repair = body.indexOf("SET status                = 'complete',");
    expect(repair, 'no canonical repair of status/verification_required').toBeGreaterThan(-1);
    for (const check of ['project_stages_pre_existing_is_complete',
                         'project_stages_pre_existing_unverified',
                         'project_stages_pre_existing_dated']) {
      expect(body.indexOf(check), `${check} is added before the repair`).toBeGreaterThan(repair);
    }
  });

  it('repairs through the sanctioned guard, never by disabling triggers', () => {
    // The completion guard refuses status='complete' outside approve_stage(). The repair uses
    // the same flag the joining RPC sets, and installs the widened guard first so it does not
    // depend on which form happens to be live.
    expect(body).toMatch(/set_config\('app\.join_in_progress', 'on', true\)/);
    expect(body).not.toMatch(/DISABLE TRIGGER/i);
    expect(body).not.toMatch(/session_replication_role/i);
    const guard = body.indexOf('FUNCTION public.stages_guard_completion');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("SET status                = 'complete',"));
  });

  it('pins the three counts before installing the constraints', () => {
    expect(body).toMatch(/canonical_repair_incomplete/);
  });
});

describe('104 never invents a recording date', () => {
  it('has no now() fallback', () => {
    // Running on 2 October does not prove an administrator recorded anything on 2 October, and
    // the column means "when we wrote this down".
    expect(body).toMatch(/COALESCE\(pre_existing_recorded_at, completed_at\)/);
    expect(body).not.toMatch(/COALESCE\(pre_existing_recorded_at, completed_at, now\(\)\)/);
  });

  it('recovers a missing date only from a provably 1:1 event', () => {
    // project.joined_in_progress is written in the same transaction that marks the stages, so
    // its created_at IS the recording moment — but only where the project has exactly one.
    expect(body).toMatch(/action = 'project\.joined_in_progress'/);
    expect(body).toMatch(/HAVING count\(\*\) = 1/);
  });

  it('aborts rather than dating a row it cannot date', () => {
    expect(body).toMatch(/unresolved_recording_date/);
    // Named projects, so the failure is actionable.
    expect(body).toMatch(/string_agg\(DISTINCT project_id::text/);
    // And it runs before the constraint that would require the date.
    expect(body.indexOf('unresolved_recording_date'))
      .toBeLessThan(body.indexOf('project_stages_pre_existing_dated'));
  });
});
