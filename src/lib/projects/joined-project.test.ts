import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageFromDescription, STAGE_KEYS, stageNumberOf } from '@/lib/projects/stage-from-description';
import { joinedBudget, STAGE_BUDGET_PCT } from '@/lib/budget/joined-project';
import type { BudgetBreakdown } from '@/types/project';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Onboarding a build that was already under way.
 *
 * Two things carry real risk. Reading the contractor's words wrong marks a stage complete
 * that nobody built, or bills a client again for a floor they paid for last year. Pricing it
 * wrong asks for money that is not owed. Both are checked here against the words a Cameroonian
 * contractor would actually use.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped: a comment explaining a rule is not a breach of it. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');

const at = (text: string) => stageFromDescription(text).stageNumber;

describe('reading the stage from what the contractor said', () => {
  it('knows our own numbering when a partner uses it', () => {
    expect(stageFromDescription('stage 5')).toMatchObject({ stageNumber: 5, confidence: 'high' });
    expect(at('Phase 7')).toBe(7);
    expect(at('étape 3')).toBe(3);
    // Not a stage on the scale, so it falls through to the words instead of trusting "11".
    expect(at('stage 11')).toBeNull();
  });

  it('places the plain stage names', () => {
    expect(at('land secured')).toBe(1);
    expect(at('design')).toBe(2);
    expect(at('site preparation')).toBe(3);
    expect(at('foundation')).toBe(4);
    expect(at('structure and walls')).toBe(5);
    expect(at('roofing')).toBe(6);
    expect(at('electrical and plumbing')).toBe(7);
    expect(at('finishing')).toBe(8);
    expect(at('exterior work')).toBe(9);
    expect(at('final handover')).toBe(10);
  });

  it('places the words people actually use on site', () => {
    expect(at('the roof is on')).toBe(6);
    expect(at('digging the trenches')).toBe(4);
    expect(at('block walls going up')).toBe(5);
    expect(at('we are plastering and tiling')).toBe(8);
    expect(at('wiring and sockets')).toBe(7);
    expect(at('septic tank and soak away done')).toBe(7);
    expect(at('painting now')).toBe(8);
    expect(at('fencing and the garden')).toBe(9);
    expect(at('waiting for the land title')).toBe(1);
    expect(at('borehole drilled, clearing done')).toBe(3);
  });

  it('understands French, and a sentence that mixes both', () => {
    expect(at('coulage de la dalle')).toBe(5);
    expect(at('la toiture est posée')).toBe(6);
    expect(at('nous sommes aux finitions')).toBe(8);
    expect(at('plomberie et électricité')).toBe(7);
    expect(at('fondations terminées')).toBe(4);
    // Accents dropped, as people type them.
    expect(at('electricite et plomberie')).toBe(7);
    expect(at('on fait le crepissage')).toBe(8);
    // One sentence, both languages — normal in Douala.
    expect(at('la dalle is cast, starting the roofing')).toBe(6);
  });

  it('accepts a later stage only when the words say that is where they are', () => {
    // "now", "starting" — an explicit statement of current position, not merely a later
    // mention. These are the cases where a proposal is safe.
    expect(at('foundation done, now the walls')).toBe(5);
    expect(at('we finished the roof and are starting plumbing')).toBe(7);
    expect(at('la dalle is cast, starting the roofing')).toBe(6);
  });

  it('refuses to let a bare later mention win — the reviewer’s cases', () => {
    // Mentioning a later stage does not mean everything below it is built. Taking it would
    // mark real, unbuilt work pre-existing, skipping its verification AND its billing. That
    // is as material an error as overbilling, in the other direction.
    for (const ambiguous of [
      'Foundation is complete; roofing materials are already ordered.',
      'Finishing plumbing before we start painting.',
      'land bought, design approved, foundation in',
    ]) {
      const g = stageFromDescription(ambiguous);
      expect(g.stageNumber, ambiguous).toBeNull();
      expect(g.confidence, ambiguous).toBe('ambiguous');
      // The admin still sees every stage the text touched, so choosing is informed.
      expect(g.alsoMatched.length).toBeGreaterThan(1);
    }
  });

  it('will not propose a stage the sentence says has not started', () => {
    // A single stage named, but in the future. Proposing it would mark everything below it
    // built on the strength of a plan.
    for (const future of [
      'we are casting the slab next week',
      'roofing starts next month',
      'about to begin the plastering',
    ]) {
      const g = stageFromDescription(future);
      expect(g.stageNumber, future).toBeNull();
      expect(g.confidence, future).toBe('ambiguous');
    }
  });

  it('never returns a stage alongside an ambiguous verdict', () => {
    // The caller branches on `confidence`; a number present here would get used.
    for (const text of ['Foundation is complete; roofing materials ordered', 'stage', '']) {
      const g = stageFromDescription(text);
      if (g.confidence === 'ambiguous' || g.confidence === 'none') {
        expect(g.stageNumber, text).toBeNull();
        expect(g.stageKey, text).toBeNull();
      }
    }
  });

  it('reports what it matched, so an admin can disagree with it', () => {
    const g = stageFromDescription('we are doing the roofing sheets');
    expect(g.matched).toBeTruthy();
    expect(g.stageNumber).toBe(6);
    const multi = stageFromDescription('foundation done, now the walls');
    expect(multi.alsoMatched.map(a => a.stageNumber)).toContain(4);
  });

  it('says it does not know rather than guessing', () => {
    // The caller must then ask the admin. Defaulting to stage 1 would silently restart
    // somebody's half-built house.
    for (const nothing of ['', '   ', 'not sure', 'ask the owner', 'xyz', '12345']) {
      const g = stageFromDescription(nothing);
      expect(g.stageNumber, `"${nothing}"`).toBeNull();
      expect(g.confidence).toBe('none');
    }
  });

  it('marks a loose word as medium, not high, confidence', () => {
    // "concrete" appears in four stages. A confident-looking wrong answer is the failure
    // this distinction exists to prevent.
    const g = stageFromDescription('pouring concrete');
    expect(g.stageNumber).not.toBeNull();
    expect(g.confidence).toBe('medium');
  });

  it('is not fooled by a word inside another word', () => {
    expect(at('the island plot')).not.toBe(10);   // 'land' inside 'island'
    expect(at('abandoned site')).not.toBe(10);    // 'done' inside 'abandoned'
  });

  it('covers all ten stages and numbers them from one', () => {
    expect(STAGE_KEYS).toHaveLength(10);
    expect(stageNumberOf('landSecured')).toBe(1);
    expect(stageNumberOf('finalHandover')).toBe(10);
    expect(new Set(STAGE_KEYS).size).toBe(10);
  });

  it('recognises every stage by its own name, with no gaps in the table', () => {
    // A stage nothing can match is a stage no project can ever join at.
    const names = ['land secured', 'design completed', 'site preparation', 'foundation',
      'structure and walls', 'roofing', 'electrical and plumbing', 'finishing',
      'exterior work', 'final handover'];
    names.forEach((n, i) => expect(at(n), n).toBe(i + 1));
  });
});

describe('what a client joining mid-build is asked to pay', () => {
  // A plausible G+1: construction 60,000, the five fee lines on top.
  const full: BudgetBreakdown = {
    total: 80_000, construction: 60_000, material: 36_000, labor: 24_000,
    permit: 1_350, professional: 8_000, design: 3_000, verification: 2_100,
    contingency: 1_489,
  };

  it('leaves an ordinary new build alone', () => {
    const b = joinedBudget(full, 1);
    expect(b.skipped).toEqual([]);
    expect(b.remainingShare).toBe(1);
    expect(b.design).toBe(full.design);
    expect(b.permit).toBe(full.permit);
    expect(b.professional).toBe(full.professional);
    expect(b.verification).toBe(full.verification);
  });

  it('asks for less than the whole house when half of it is standing', () => {
    const b = joinedBudget(full, 6);
    expect(b.total).toBeLessThan(full.total);
    expect(b.fullTotal).toBe(full.total);
  });

  it('names the stages it will mark as already built', () => {
    const b = joinedBudget(full, 6);
    expect(b.skipped.map(s => s.stageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(b.skipped.map(s => s.key)).toContain('foundation');
  });

  it('prices the remaining work by the stages that are left', () => {
    // Joining at 6 skips 2% + 8% + 30% of construction (land and design are 0%), so 60% of
    // the build remains: site prep, foundation and structure are gone.
    const b = joinedBudget(full, 6);
    expect(b.remainingShare).toBeCloseTo(0.6, 5);
  });

  it('never discounts a stage that is still to be built', () => {
    // The construction figure is passed through untouched so `apply_budget_milestones` gives
    // each remaining stage its true milestone. A roof costs what a roof costs.
    expect(joinedBudget(full, 6).construction).toBe(full.construction);
    expect(joinedBudget(full, 9).construction).toBe(full.construction);
  });

  it('drops the design and permit fees once that stage is behind us', () => {
    // Both belong to stage 2. A client whose architect was paid years ago does not pay again.
    expect(joinedBudget(full, 2).design).toBe(full.design);
    expect(joinedBudget(full, 3).design).toBe(0);
    expect(joinedBudget(full, 3).permit).toBe(0);
    expect(joinedBudget(full, 6).design).toBe(0);
  });

  it('pro-rates the professional fees, which are charged per month of build', () => {
    const b = joinedBudget(full, 6);
    expect(b.professional).toBe(Math.round(full.professional * 0.6));
    expect(b.professional).toBeLessThan(full.professional);
  });

  it('pro-rates verification by the stages still to be verified', () => {
    const b = joinedBudget(full, 6);
    // Charged stages are the six with a non-zero percentage; joining at 6 leaves three.
    expect(b.verification).toBeGreaterThan(0);
    expect(b.verification).toBeLessThan(full.verification);
  });

  it('charges nothing for verifying work nobody from Groundwork saw', () => {
    // The pre-existing stages are flagged `verification_required = false` in 103, so billing
    // for their verification would be charging for a service that cannot be delivered.
    const early = joinedBudget(full, 2).verification;
    const late  = joinedBudget(full, 9).verification;
    expect(late).toBeLessThan(early);
  });

  it('re-derives contingency from the new subtotal instead of scaling the old one', () => {
    const b = joinedBudget(full, 6);
    const subtotal = b.total - b.contingency;
    const rate = full.contingency / (full.construction + full.design + full.permit
               + full.professional + full.verification);
    expect(b.contingency).toBe(Math.round(subtotal * rate));
  });

  it('adds up to the cent', () => {
    for (const start of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const b = joinedBudget(full, start);
      const stagesDue = Math.round(full.construction * b.remainingShare);
      const sum = stagesDue + b.design + b.permit + b.professional + b.verification + b.contingency;
      expect(sum, `start ${start}`).toBe(b.total);
    }
  });

  it('gets cheaper the further along the build already is', () => {
    const totals = [1, 3, 4, 5, 6, 7, 8].map(s => joinedBudget(full, s).total);
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i], `start index ${i}`).toBeLessThanOrEqual(totals[i - 1]);
    }
  });

  it('clamps a nonsense stage rather than producing a nonsense price', () => {
    expect(joinedBudget(full, 0).startStage).toBe(1);
    expect(joinedBudget(full, -3).startStage).toBe(1);
    expect(joinedBudget(full, 99).startStage).toBe(10);
  });

  it('survives a breakdown with no contingency line', () => {
    const b = joinedBudget({ ...full, contingency: 0 }, 6);
    expect(b.contingency).toBe(0);
    expect(Number.isFinite(b.total)).toBe(true);
  });

  it('uses the stage percentages the schedule itself uses', () => {
    // If these drift from stage-seeds.ts, a joined project is priced against a different
    // build to the one its milestones describe.
    const seeds = read('src/lib/supabase/stage-seeds.ts');
    const pct = STAGE_KEYS.map(k => STAGE_BUDGET_PCT[k]);
    expect(pct).toEqual([0, 0, 2, 8, 30, 8, 17, 30, 0, 5]);
    for (const key of STAGE_KEYS) {
      expect(seeds, `stage-seeds.ts has no ${key}`).toContain(`key: '${key}'`);
    }
    expect(pct.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('the database side of joining mid-build', () => {
  const SQL = read('supabase/migrations/103_join_project_in_progress.sql');

  it('marks skipped stages as never having been ours, not merely complete', () => {
    expect(SQL).toMatch(/pre_existing\s+boolean NOT NULL DEFAULT false/);
    expect(SQL).toMatch(/pre_existing\s+= true/);
  });

  it('never routes this through approve_stage', () => {
    // An approval means an administrator accepted evidence. None of that happened here, and
    // approve_stage is what issues certificates.
    const fn = SQL.match(/FUNCTION public\.admin_start_project_at_stage[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).not.toMatch(/approve_stage\(/);
    expect(fn).not.toMatch(/certificate/i);
  });

  it('widens the completion guard without opening it', () => {
    // The new flag works only together with pre_existing, so it is not a general licence to
    // complete a stage.
    expect(SQL).toMatch(/app\.join_in_progress[\s\S]{0,40}NEW\.pre_existing/);
    expect(SQL).toMatch(/approve_via_rpc/);
  });

  it('cannot leave pre-existing work owing money or awaiting verification', () => {
    expect(SQL).toMatch(/payment_milestone_usd = 0/);
    expect(SQL).toMatch(/verification_required = false/);
    // And the constraints refuse a later hand-edit, not just this RPC's own writes.
    expect(SQL).toMatch(/project_stages_pre_existing_unverified/);
    expect(SQL).toMatch(/project_stages_pre_existing_is_complete/);
  });

  it('invents no payment to make a stage look settled', () => {
    // 090 already reads "no milestone" as paid. Writing a funded `in` row would put money in
    // the ledger that never existed.
    const fn = SQL.match(/FUNCTION public\.admin_start_project_at_stage[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).not.toMatch(/INSERT INTO public\.payments/);
    expect(fn).not.toMatch(/'funded'|'reconciled'/);
  });

  it('records why the project starts where it does', () => {
    expect(SQL).toMatch(/project\.joined_in_progress/);
    expect(SQL).toMatch(/described_as/);
  });

  it('refuses to start a project at its own handover', () => {
    expect(SQL).toMatch(/nothing_left/);
  });

  it('is admin-only', () => {
    const fn = SQL.match(/FUNCTION public\.admin_start_project_at_stage[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(fn).toMatch(/IF NOT public\.is_admin\(\) THEN RAISE EXCEPTION 'not_admin/);
  });
});

describe('a pre-existing stage never claims money moved', () => {
  const SQL = read('supabase/migrations/103_join_project_in_progress.sql');

  it('is its own lifecycle state, not "completed"', () => {
    // Every payment surface asks stageLifecycle() what a stage is. Left as `completed`, a
    // screen reading 090's legacy `payment_status` projection (which says `paid` for anything
    // with no milestone) would report that money moved. Nothing moved.
    const life = code('src/lib/lifecycle/stage.ts');
    expect(life).toMatch(/\| 'pre_existing'/);
    expect(life).toMatch(/if \(stage\.pre_existing === true\) return \{ state: 'pre_existing'/);
  });

  it('is answered before any payment or verification reasoning', () => {
    const life = code('src/lib/lifecycle/stage.ts');
    const at = life.indexOf("state: 'pre_existing'");
    expect(at).toBeGreaterThan(0);
    // Ahead of the switch on stage.status, where every milestone and ledger branch lives.
    expect(at).toBeLessThan(life.indexOf('switch (stage.status)'));
  });

  it('is never dressed as an approved stage', () => {
    // Green is Groundwork saying a stage went through our process. This one did not.
    const badge = code('src/lib/admin/lifecycle-badge.ts');
    expect(badge).toMatch(/pre_existing:\s+\{ labelKey: 'admin\.lifecycle\.state\.pre_existing',\s+accent: 'grey' \}/);
  });

  it('reads "Completed outside Groundwork", in both languages', () => {
    const e = (en.admin as Record<string, any>).lifecycle.state.pre_existing;
    const f = (fr.admin as Record<string, any>).lifecycle.state.pre_existing;
    expect(e).toBe('Completed outside Groundwork');
    expect(f).toBeTypeOf('string');
    // And never the word that would mean a payment.
    expect(String(e).toLowerCase()).not.toContain('paid');
    expect(String(e).toLowerCase()).not.toContain('approved');
  });

  it('is refused a release by name, ahead of the amount checks', () => {
    // Not left to a positive-amount CHECK exploding after a screen already offered the action.
    const blocker = SQL.match(/FUNCTION public\.stage_release_blocker[\s\S]*?END \$\$;/)?.[0] ?? '';
    expect(blocker).toMatch(/IF v_stage\.pre_existing THEN RETURN 'pre_existing'; END IF;/);
    expect(blocker.indexOf("'pre_existing'")).toBeLessThan(blocker.indexOf('over_milestone'));
    // A zero milestone also gets its own reason rather than reading as "too much".
    expect(blocker).toMatch(/RETURN 'nothing_due'/);
  });

  it('is not offered a release by the admin UI either', () => {
    // stage-actions only offers the release when milestone > 0; a pre-existing stage has 0.
    const actions = code('src/lib/admin/stage-actions.ts');
    expect(actions).toMatch(/milestone > 0/);
  });
});

describe('what timestamps a pre-existing stage carries', () => {
  const SQL = read('supabase/migrations/103_join_project_in_progress.sql');

  it('does not claim the construction finished today', () => {
    // Stamping now() would assert a foundation poured in 2019 completed the day an admin typed
    // a sentence, and that date would flow into every timeline and export downstream.
    //
    // Comments stripped: the file DOCUMENTS that an earlier version wrote `completed_at =
    // now()`, and reading that sentence as the breach would mean deleting the explanation of
    // why the corrective backfill exists.
    const body = SQL.replace(/--[^\n]*/g, ' ');
    expect(body).toMatch(/completed_at\s+= NULL/);
    expect(body).not.toMatch(/completed_at\s+= now\(\)/);
  });

  it('moves the earlier run\u2019s stamped date instead of discarding it', () => {
    // 103 was applied once before this review and stamped completed_at = now(). That value is
    // not a completion date — it is when the stage was RECORDED, which is exactly the new
    // column's meaning. Moving it keeps a true fact; deleting it would lose one.
    const body = SQL.replace(/--[^\n]*/g, ' ');
    expect(body).toMatch(/COALESCE\(pre_existing_recorded_at, completed_at, now\(\)\)/);
    // And it has to run before the constraint, or re-applying aborts on those rows.
    expect(body.indexOf('COALESCE(pre_existing_recorded_at, completed_at'))
      .toBeLessThan(body.indexOf('project_stages_pre_existing_dated'));
  });

  it('records the one date we actually know', () => {
    expect(SQL).toMatch(/pre_existing_recorded_at\s+= now\(\)/);
    expect(SQL).toMatch(/CHECK \(pre_existing = \(pre_existing_recorded_at IS NOT NULL\)\)/);
  });

  it('names no approver on the substages', () => {
    // A substage marked complete with an approver would name somebody who never saw the work.
    expect(SQL).toMatch(/SET status = 'complete', approved_by = NULL, approved_at = NULL/);
  });
});
