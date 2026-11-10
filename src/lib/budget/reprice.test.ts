import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planReprice, repriceBalances, type RepriceStage } from './reprice';
import { stageSharesFromTakeoff } from './stage-shares';
import { calculateBudget } from './index';
import { CAMEROON_BQS } from './__fixtures__/cameroon-bqs';
import { STAGE_KEYS, type StageKey } from '@/lib/projects/stage-from-description';

/**
 * Re-cutting a schedule that is already running.
 *
 * 183 widened `budget_pct` and `stage-shares.ts` writes each building's own split — but
 * only at creation, because every caller of `apply_budget_milestones` is a one-time
 * creation or join step. Philip, 10 Nov 2026, looking at a project created before the
 * fix: "why is the costing still same thing".
 *
 * The invariant this file exists for: MONEY THAT HAS ALREADY MOVED IS NEVER RE-CUT. A
 * paid stage is a figure a client transferred against a receipt somebody is holding.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEED: Record<string, number> = {
  landSecured: 0, designCompleted: 0, sitePreparation: 2, foundation: 8,
  structureWalls: 30, roofing: 8, electricalPlumbing: 17, finishing: 30,
  exteriorWork: 0, finalHandover: 5,
};

/** A project on the old flat split, priced against `construction`. */
function oldSchedule(
  construction: number,
  design = 3733,
  over: Partial<Record<StageKey, Partial<RepriceStage>>> = {},
): RepriceStage[] {
  return STAGE_KEYS.map((key, i) => ({
    id: `s${i + 1}`,
    stage_number: i + 1,
    stage_key: key,
    budget_pct: SEED[key],
    payment_milestone_usd: key === 'designCompleted'
      ? design
      : Math.round(construction * SEED[key] / 100),
    fixed_amount_usd: key === 'designCompleted' ? design : null,
    payment_status: 'unpaid',
    status: 'locked',
    pre_existing: false,
    ...(over[key] ?? {}),
  }));
}

const BUEA = CAMEROON_BQS.find(f => f.name.includes('Buea'))!;
const CONSTRUCTION = Math.round(calculateBudget(BUEA.input).construction);
const SHARES = stageSharesFromTakeoff(BUEA.input)!;

describe('a schedule nobody has paid into is re-cut whole', () => {
  const plan = planReprice(oldSchedule(CONSTRUCTION), CONSTRUCTION, SHARES);
  const row = (k: StageKey) => plan.rows.find(r => r.stageKey === k)!;

  it('moves the money to the stages that spend it', () => {
    expect(row('foundation').wasAmount).toBeLessThan(row('foundation').nowAmount);
    expect(row('structureWalls').wasAmount).toBeLessThan(row('structureWalls').nowAmount);
    expect(row('electricalPlumbing').wasAmount).toBeGreaterThan(row('electricalPlumbing').nowAmount);
    expect(row('finishing').wasAmount).toBeGreaterThan(row('finishing').nowAmount);
  });

  it('still adds up to the construction fee', () => {
    expect(repriceBalances(plan, CONSTRUCTION)).toBe(true);
  });

  it('adds up to the construction fee to the cent', () => {
    const total = plan.rows.filter(r => r.heldReason !== 'fixed_fee').reduce((x, r) => x + r.nowAmount, 0);
    expect(Math.round(total * 100)).toBe(Math.round(CONSTRUCTION * 100));
  });

  it('leaves the design fee alone', () => {
    // An absolute amount on `fixed_amount_usd` (036), not a share of construction.
    expect(row('designCompleted').settled).toBe(true);
    expect(row('designCompleted').heldReason).toBe('fixed_fee');
    expect(row('designCompleted').nowAmount).toBe(row('designCompleted').wasAmount);
  });

  it('writes a percentage that reproduces the amount', () => {
    // `apply_budget_milestones` re-derives the milestone from `budget_pct` on every later
    // re-price. If the two disagree, the next one silently undoes this one.
    for (const r of plan.rows) {
      if (r.settled) continue;
      expect(Math.abs(CONSTRUCTION * r.nowPct / 100 - r.nowAmount), `${r.stageKey}`).toBeLessThan(0.01);
    }
  });
});

describe('money that has moved is never re-cut', () => {
  it('a PAID stage keeps its figure to the dollar', () => {
    const plan = planReprice(oldSchedule(CONSTRUCTION, 3733, {
      sitePreparation: { payment_status: 'paid', status: 'complete' },
      foundation:      { payment_status: 'paid', status: 'complete' },
    }), CONSTRUCTION, SHARES);

    for (const key of ['sitePreparation', 'foundation'] as StageKey[]) {
      const r = plan.rows.find(x => x.stageKey === key)!;
      expect(r.settled, key).toBe(true);
      expect(r.nowAmount, key).toBe(r.wasAmount);
      expect(r.nowPct, key).toBe(r.wasPct);
    }
    // And they are not in what gets sent to the database at all.
    const sent = new Set(plan.changes.map(c => c.stageId));
    expect(sent.has('s3')).toBe(false);
    expect(sent.has('s4')).toBe(false);
  });

  it('a COMPLETE but unpaid stage is also left alone', () => {
    // The work was signed off against a figure. Re-cutting it afterwards changes what a
    // contractor was told they had earned.
    const plan = planReprice(
      oldSchedule(CONSTRUCTION, 3733, { roofing: { status: 'complete' } }),
      CONSTRUCTION, SHARES,
    );
    const r = plan.rows.find(x => x.stageKey === 'roofing')!;
    expect(r.heldReason).toBe('complete');
    expect(r.nowAmount).toBe(r.wasAmount);
  });

  it('a PRE-EXISTING stage stays at zero and claims none of the pot', () => {
    // 103: built before Groundwork, never funded through us.
    const plan = planReprice(oldSchedule(CONSTRUCTION, 3733, {
      sitePreparation: { pre_existing: true, payment_milestone_usd: 0, status: 'complete' },
      foundation:      { pre_existing: true, payment_milestone_usd: 0, status: 'complete' },
    }), CONSTRUCTION, SHARES);

    for (const key of ['sitePreparation', 'foundation'] as StageKey[]) {
      const r = plan.rows.find(x => x.stageKey === key)!;
      expect(r.heldReason, key).toBe('pre_existing');
      expect(r.nowAmount, key).toBe(0);
    }
  });

  it('what is left over is only what is still owed', () => {
    const plan = planReprice(oldSchedule(CONSTRUCTION, 3733, {
      sitePreparation: { payment_status: 'paid', status: 'complete' },
      foundation:      { payment_status: 'paid', status: 'complete' },
    }), CONSTRUCTION, SHARES);
    const paid = Math.round(CONSTRUCTION * 2 / 100) + Math.round(CONSTRUCTION * 8 / 100);

    expect(plan.settledTotal).toBe(paid);
    expect(plan.remaining).toBe(CONSTRUCTION - paid);
    // Settled + re-cut together still come to the construction fee, which is what an
    // administrator is actually approving.
    expect(repriceBalances(plan, CONSTRUCTION)).toBe(true);
  });

  it("the unsettled stages divide the rest in the take-off's proportions", () => {
    const plan = planReprice(
      oldSchedule(CONSTRUCTION, 3733, { sitePreparation: { payment_status: 'paid', status: 'complete' } }),
      CONSTRUCTION, SHARES,
    );
    const frame = plan.rows.find(r => r.stageKey === 'structureWalls')!;
    const roof  = plan.rows.find(r => r.stageKey === 'roofing')!;
    // Their ratio to each other survives the renormalisation, even though neither gets
    // its whole-building share any more.
    expect(frame.nowAmount / roof.nowAmount)
      .toBeCloseTo(SHARES.structureWalls / SHARES.roofing, 2);
  });
});

describe('a project already overpaid is reported, not given negative milestones', () => {
  it('every remaining stage goes to zero and the overrun is flagged', () => {
    // Reachable: a budget re-priced DOWN after stages were paid at the old figures.
    const plan = planReprice(oldSchedule(CONSTRUCTION, 3733, {
      sitePreparation: { payment_status: 'paid', status: 'complete', payment_milestone_usd: CONSTRUCTION },
      foundation:      { payment_status: 'paid', status: 'complete', payment_milestone_usd: 50_000 },
    }), CONSTRUCTION, SHARES);

    expect(plan.overcommitted).toBe(true);
    for (const r of plan.rows.filter(x => !x.settled)) expect(r.nowAmount).toBe(0);
    // And it must never be offered for approval.
    expect(repriceBalances(plan, CONSTRUCTION)).toBe(false);
  });
});

describe('the database refuses what the plan already excluded', () => {
  const body = src('supabase/migrations/184_recut_a_live_schedule.sql').replace(/^\s*--.*$/gm, '');

  it('is administrator only', () => {
    expect(body).toMatch(/IF NOT public\.is_admin\(\) THEN/);
    expect(body).toMatch(/not_authorized/);
  });

  it('re-checks settled rather than trusting the ids it was sent', () => {
    // A stale preview or a hand-made call must not be able to rewrite a stage that has
    // been paid since the preview was taken.
    expect(body).toMatch(/COALESCE\(s\.pre_existing, false\) = false/);
    expect(body).toMatch(/COALESCE\(s\.payment_status, 'unpaid'\) <> 'paid'/);
    expect(body).toMatch(/s\.status <> 'complete'/);
    expect(body).toMatch(/COALESCE\(s\.fixed_amount_usd, 0\) = 0/);
  });

  it('writes the percentage and the amount together', () => {
    expect(body).toMatch(/SET budget_pct\s+= a\.pct,/);
    expect(body).toMatch(/payment_milestone_usd = ROUND\(a\.amount\)/);
  });

  it('locks the schedule and records what it did', () => {
    expect(body).toMatch(/FOR UPDATE/);
    expect(body).toMatch(/log_activity\(p_project, 'project\.repriced'/);
  });

  it('scopes every write to the project it was given', () => {
    // Without this, a stage id from another build could be re-priced by naming it here.
    expect(body).toMatch(/WHERE s\.project_id = p_project/);
  });
});

describe('the preview is read-only and the write takes the plan', () => {
  const wrapper = code('src/lib/supabase/reprice.ts');

  it('previewing writes nothing', () => {
    const preview = wrapper.slice(
      wrapper.indexOf('export async function previewReprice'),
      wrapper.indexOf('export async function applyReprice'),
    );
    expect(preview).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  });

  it('what is written is what was previewed', () => {
    // Not a second computation that could have drifted from the figures on screen.
    expect(wrapper).toMatch(/p_rows: plan\.changes/);
  });

  it('refuses a plan that does not add up', () => {
    expect(wrapper).toMatch(/repriceBalances\(plan, construction\)/);
    expect(wrapper).toMatch(/does_not_balance/);
  });

  it('refuses a project with no take-off instead of re-cutting to the average', () => {
    expect(wrapper).toMatch(/if \(!shares\) throw new RepriceUnavailable\('no_takeoff'\)/);
  });
});
