import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageLifecycle } from '@/lib/lifecycle/stage';

/**
 * A stage Groundwork never funded must never read as money that moved.
 *
 * `project_stages.payment_status` is 090's LEGACY projection, and its rule is "nothing is
 * owed, so nothing is outstanding" — which makes a zero-milestone stage read `paid`. For a
 * pre-existing stage (103) that is true about the debt and false about the money: no
 * incoming row, no outgoing row, nobody disbursed anything.
 *
 * The invariant, as the reviewer stated it:
 *
 *   pre_existing + milestone 0
 *     → creates no incoming payment
 *     → creates no outgoing payment
 *     → contributes $0 to confirmed inflow
 *     → contributes $0 to disbursed
 *     → does not render "Paid"
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const migration = src('supabase/migrations/103_join_project_in_progress.sql');

describe('103 fabricates no money', () => {
  it('writes no payments row of any kind', () => {
    // Inventing a funded row to make a stage look settled would put money in the ledger
    // that never existed and break every reconciliation after it.
    const body = migration.replace(/^\s*--.*$/gm, '');
    expect(body).not.toMatch(/INSERT\s+INTO\s+public\.payments/i);
    expect(body).not.toMatch(/INSERT\s+INTO\s+public\.payment_events/i);
  });

  it('zeroes the milestone rather than marking it paid', () => {
    expect(migration).toContain('payment_milestone_usd    = 0');
    expect(migration).not.toMatch(/payment_status\s*=\s*'paid'/);
  });

  it('never touches the certificate path', () => {
    // A Groundwork certificate over work nobody from Groundwork saw is the single most
    // damaging thing this feature could produce.
    const body = migration.replace(/^\s*--.*$/gm, '');
    expect(body).not.toMatch(/INSERT\s+INTO\s+public\.certificates/i);
    expect(body).not.toMatch(/issue_certificate/i);
    // Never CALLS approve_stage. It does name `app.approve_stage` — that is the guard's
    // own setting, which 103 widens by one writer rather than bypassing.
    expect(body).not.toMatch(/(PERFORM|SELECT)\s+(public\.)?approve_stage\s*\(/);
    expect(body).toContain("current_setting('app.approve_stage', true)");
  });
});

describe('the derived state says pre_existing, not paid', () => {
  const stage = (over: Record<string, unknown> = {}) => ({
    id: 's1', stage_number: 3, status: 'complete' as const,
    verification_required: false, payment_milestone_usd: 0, pre_existing: true, ...over,
  });

  const project = { status: 'active' as const };

  it('a pre-existing stage derives pre_existing', () => {
    expect(stageLifecycle(stage() as never, [], project).state).toBe('pre_existing');
  });

  it('it outranks every payment-shaped conclusion', () => {
    // Even with a full set of ledger rows against this very stage, it is not payable.
    const payments = [
      { stageId: 's1', direction: 'in'  as const, state: 'funded'    as const, amount: 9000, createdAt: '2026-01-01' },
      { stageId: 's1', direction: 'out' as const, state: 'disbursed' as const, amount: 9000, createdAt: '2026-01-02' },
    ];
    expect(stageLifecycle(stage() as never, [], project, false, null, payments).state).toBe('pre_existing');
  });

  it('an ordinary complete stage is unaffected', () => {
    const ordinary = stage({ pre_existing: false, payment_milestone_usd: 8000 });
    expect(stageLifecycle(ordinary as never, [], project).state).not.toBe('pre_existing');
  });
});

describe('no surface turns a zero milestone into money that moved', () => {
  it('the admin Finance ledger reads payments rows only', () => {
    // Every figure there is a movement of money or it is absent, so the projection can
    // never reach it.
    for (const f of ['src/lib/admin/finance-ledger.ts', 'src/components/admin/FinanceLedger.tsx']) {
      expect(code(f), `${f} must not read the legacy projection`).not.toContain('payment_status');
    }
  });

  it("the client's Payments tab reads payments rows only", () => {
    expect(code('src/components/project/ProjectPaymentsLedger.tsx')).not.toContain('payment_status');
    expect(code('src/lib/payments/client-view.ts')).not.toContain('payment_status');
  });

  it('the client dashboard excludes pre-existing stages from "released"', () => {
    // Checked BEFORE the projection: the amount expression falls back to a percentage of
    // the construction fee when the milestone is null, which would show money as released
    // that never moved.
    const dash = code('src/app/routes/dashboard.tsx');
    expect(dash).toContain('if (s.pre_existing) continue;');
    expect(dash.indexOf('if (s.pre_existing) continue;'))
      .toBeLessThan(dash.indexOf("if (s.payment_status === 'paid') released += amount;"));
    // and it must actually fetch the column it now branches on
    expect(dash).toContain('payment_status, pre_existing');
  });

  it('the project Overview excludes them from the paid total', () => {
    expect(code('src/components/project/OverviewTab.tsx'))
      .toContain("filter(s => !s.pre_existing && s.payment_status === 'paid')");
  });

  it('a pre-existing stage unlocks no payment-gated affordance', () => {
    expect(code('src/components/project/StageTracker.tsx'))
      .toContain("const stagePaid = stage.payment_status === 'paid' && !stage.pre_existing;");
  });
});

describe('and it can never present a release', () => {
  it('stage_release_blocker names pre_existing ahead of every amount check', () => {
    const fn = migration.slice(migration.indexOf('FUNCTION public.stage_release_blocker'));
    const guard  = fn.indexOf("IF v_stage.pre_existing THEN RETURN 'pre_existing'");
    expect(guard, 'the guard must exist').toBeGreaterThan(-1);
    // Ahead of the milestone and funding arithmetic, so no screen can offer an action
    // that a later CHECK would then refuse.
    for (const later of ['over_milestone', 'insufficient_funds', 'nothing_due']) {
      expect(guard, `pre_existing must precede ${later}`).toBeLessThan(fn.indexOf(later));
    }
  });
});
