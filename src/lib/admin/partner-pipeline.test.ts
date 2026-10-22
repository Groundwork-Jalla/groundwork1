import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attention, sortForWork, byStage, partnersOnly,
  PIPELINE_STAGES, MANUAL_STAGES, TERMINAL_STAGES,
  type PipelineRow, type PipelineStage,
} from './partner-pipeline';

/**
 * The pipeline is a worklist, not a report.
 *
 * 136 counts the funnel, which says where people are lost but not who to ring. Philip's
 * rule is that nobody sits in the pipeline without a stage, a last action, a next action,
 * an owner, a date and a fourteen-day deadline — so the absence of any of those is
 * itself the finding, and has to surface rather than render as a blank column.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const sql = readFileSync(join(ROOT, 'supabase/migrations/145_partner_pipeline.sql'), 'utf8')
  .replace(/--.*$/gm, '');

const NOW = new Date('2026-10-22T12:00:00Z');
const row = (o: Partial<PipelineRow> = {}): PipelineRow => ({
  userId: 'u1', fullName: 'A Contractor', email: null, phone: null, specialty: 'mason',
  stage: 'applied', stageRank: 4, ownerId: 'staff-1', ownerName: 'Ruth',
  lastAction: 'Called', lastActionAt: null, nextAction: 'Send the agreement',
  nextActionOn: '2026-10-30', activationDeadline: null, notes: null,
  appliedAt: null, stageSince: null, daysInStage: 3,
  applicationStatus: null, inDirectory: false, applicationId: 'app-1', ...o,
});

describe('what needs attention, and in what order', () => {
  it('nobody chasing them is the finding, not a blank column', () => {
    expect(attention(row({ ownerId: null, ownerName: null }), NOW)).toBe('unowned');
  });

  it('a next action in the past is overdue', () => {
    expect(attention(row({ nextActionOn: '2026-10-20' }), NOW)).toBe('overdue');
  });

  it('no next action at all is its own problem', () => {
    expect(attention(row({ nextAction: null, nextActionOn: null }), NOW)).toBe('no_next_action');
  });

  it('a passed activation deadline outranks everything else', () => {
    // Fourteen days is the commitment; missing it matters more than a late call-back.
    const r = row({ activationDeadline: '2026-10-01', nextActionOn: '2026-10-20' });
    expect(attention(r, NOW)).toBe('deadline_passed');
  });

  it('a healthy row needs nothing', () => {
    expect(attention(row(), NOW)).toBeNull();
  });

  it('and somebody already activated is off the worklist', () => {
    // They are in the product. Chasing them is noise.
    expect(attention(row({ stage: 'activated', stageRank: 11, ownerId: null }), NOW)).toBeNull();
  });
});

describe('the order staff work in', () => {
  it('puts the most urgent first, then the furthest along', () => {
    const rows = [
      row({ userId: 'healthy' }),
      row({ userId: 'unowned', ownerId: null }),
      row({ userId: 'deadline', activationDeadline: '2026-10-01' }),
      row({ userId: 'overdue', nextActionOn: '2026-10-01' }),
      row({ userId: 'noNext', nextAction: null, nextActionOn: null }),
    ];
    expect(sortForWork(rows, NOW).map(r => r.userId))
      .toEqual(['deadline', 'overdue', 'unowned', 'noNext', 'healthy']);
  });

  it('and breaks ties by how far they have got', () => {
    const rows = [
      row({ userId: 'early', ownerId: null, stageRank: 2 }),
      row({ userId: 'late',  ownerId: null, stageRank: 9 }),
    ];
    expect(sortForWork(rows, NOW).map(r => r.userId)).toEqual(['late', 'early']);
  });
});

describe('the review, the decision and the directory', () => {
  const sqlNew = readFileSync(
    join(ROOT, 'supabase/migrations/146_application_review_in_the_funnel.sql'), 'utf8')
    .replace(/--.*$/gm, '');

  it('the meeting happening is what starts the review', () => {
    // Asking somebody to also remember a dropdown is how a queue fills with
    // applications nobody is looking at.
    expect(sqlNew).toMatch(/IF p_call_completed THEN[\s\S]{0,260}SET status = 'reviewing'/);
  });

  it('but only from pending, so a late tick cannot undo a decision', () => {
    expect(sqlNew).toMatch(/SET status = 'reviewing'[\s\S]{0,160}AND status = 'pending'/);
  });

  it('a rejection is terminal and outranks the progress before it', () => {
    expect(sqlNew).toMatch(/ORDER BY \(v\.name = 'rejected'\) DESC/);
    expect([...TERMINAL_STAGES].sort()).toEqual(['activated', 'rejected']);
    expect(attention(row({ stage: 'rejected', ownerId: null }), NOW)).toBeNull();
  });

  it('accepted but invisible to clients is the loudest finding', () => {
    // The decision was made and the applicant was told. If the publish failed, no client
    // can find them and nothing else on the screen would say so.
    const r = row({ stage: 'accepted', applicationStatus: 'accepted', inDirectory: false });
    expect(attention(r, NOW)).toBe('not_in_directory');
    expect(sortForWork([row(), r], NOW)[0].stage).toBe('accepted');
  });

  it('and published is quiet', () => {
    expect(attention(row({ stage: 'accepted', applicationStatus: 'accepted', inDirectory: true }), NOW))
      .toBeNull();
  });

  it('a decision carries a date, however it was set', () => {
    // The table had no timestamp for a status change, so a trigger stamps it rather than
    // relying on every caller to remember.
    expect(sqlNew).toMatch(/CREATE TRIGGER stamp_application_status/);
    expect(sqlNew).toMatch(/BEFORE UPDATE ON public\.contractor_applications/);
  });

  it('and the board reports the application status alongside the stage', () => {
    // So the funnel and the application screen can never disagree about somebody.
    expect(sqlNew).toMatch(/application_status\s+text/);
    expect(sqlNew).toMatch(/in_directory\s+boolean/);
  });
});

describe('the stage strip', () => {
  it('counts every stage, including the empty ones', () => {
    const counts = byStage([row({ stage: 'applied' }), row({ stage: 'applied' }),
                            row({ stage: 'activated' })]);
    expect(counts.applied).toBe(2);
    expect(counts.activated).toBe(1);
    expect(counts.onboarded).toBe(0);
    expect(Object.keys(counts)).toHaveLength(PIPELINE_STAGES.length);
  });
});

describe('what the database derives and what a person supplies', () => {
  it('only three stages are stored', () => {
    // Everything else is observable. A stored copy of an observable fact goes stale.
    expect([...MANUAL_STAGES]).toEqual(['call_completed', 'committed', 'agreement_signed']);
  });

  it('and the table holds only those three, plus the chasing', () => {
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.partner_pipeline'),
                            sql.indexOf('COMMENT ON TABLE'));
    for (const col of ['call_completed_at', 'committed_at', 'agreement_signed_at',
                       'owner_id', 'last_action', 'next_action', 'next_action_on',
                       'activation_deadline']) {
      expect(table, `${col} missing`).toContain(col);
    }
    // The derived ones must NOT be stored.
    for (const col of ['onboarded_at', 'applied_at', 'prequalified_at', 'activated_at']) {
      expect(table, `${col} is derivable and must not be stored`).not.toContain(col);
    }
  });

  it('the board reads the furthest stage reached', () => {
    expect(sql).toMatch(/ORDER BY v\.rank DESC\s*\n\s*LIMIT 1/);
  });

  it('the fourteen days are defaulted from the call, and overridable', () => {
    expect(sql).toMatch(/coalesce\(pl\.activation_deadline, \(pl\.call_completed_at \+ interval '14 days'\)::date\)/);
  });

  it('and the whole board is staff-only', () => {
    expect(sql).toMatch(/IF NOT public\.is_admin\(\) THEN[\s\S]{0,80}not_allowed/);
    expect(sql).toMatch(/CREATE POLICY "admins_read_pipeline"/);
  });
});

/**
 * A partner is not just any contractor.
 *
 * The board is built over everyone holding the contractor role, because "account
 * created" and "onboarded" are real funnel steps. But somebody reviewing applications
 * is not looking for people who never made one — Ruth, on the first day of real
 * applications: "I clicked the applied box and it did nothing. I was hoping it showed
 * me the 5 applicants and allowed me review." The application's id is what separates
 * the two, and it is null for an account that never applied.
 */
describe('partners are distinct from contractors', () => {
  it('keeps only the people who actually applied', () => {
    const rows = [
      row({ userId: 'applied-1', applicationId: 'app-1' }),
      row({ userId: 'never-applied', applicationId: null, stage: 'account_created' }),
      row({ userId: 'applied-2', applicationId: 'app-2', stage: 'booking_shown' }),
    ];
    expect(partnersOnly(rows).map(r => r.userId)).toEqual(['applied-1', 'applied-2']);
  });

  it('does not invent partners when nobody has applied', () => {
    expect(partnersOnly([row({ applicationId: null })])).toEqual([]);
  });

  it('counts stages over the scoped set, so a filtered count matches its list', () => {
    const rows = [
      row({ userId: 'a', applicationId: 'app-1', stage: 'applied' }),
      row({ userId: 'b', applicationId: null,    stage: 'applied' }),
    ];
    expect(byStage(partnersOnly(rows)).applied).toBe(1);
    expect(byStage(rows).applied).toBe(2);
  });
});

/**
 * 148 is what makes the row openable. The column has to survive the migration, and the
 * function has to be DROPPED before it is recreated — CREATE OR REPLACE cannot change
 * the row type defined by a function's OUT parameters (42P13), which is exactly how
 * 146 failed in the SQL editor.
 */
describe('148 exposes the application', () => {
  const m148 = readFileSync(
    join(ROOT, 'supabase/migrations/148_the_board_hands_you_the_application.sql'), 'utf8');

  it('drops the function before recreating it with a wider row', () => {
    const drop = m148.indexOf('DROP FUNCTION IF EXISTS public.admin_partner_pipeline()');
    const create = m148.indexOf('CREATE OR REPLACE FUNCTION public.admin_partner_pipeline()');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it('returns the application id and keeps the grants', () => {
    expect(m148).toMatch(/application_id\s+uuid/);
    expect(m148).toContain('GRANT EXECUTE ON FUNCTION public.admin_partner_pipeline() TO authenticated');
    expect(m148).toMatch(/REVOKE ALL ON FUNCTION public\.admin_partner_pipeline\(\) FROM PUBLIC, anon/);
  });

  it('runs inside one transaction, so a failure leaves nothing behind', () => {
    expect(m148.replace(/--.*$/gm, '')).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
});
