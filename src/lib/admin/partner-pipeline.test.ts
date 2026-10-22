import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attention, sortForWork, byStage, PIPELINE_STAGES, MANUAL_STAGES,
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
  appliedAt: null, stageSince: null, daysInStage: 3, ...o,
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
