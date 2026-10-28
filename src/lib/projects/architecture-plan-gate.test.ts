import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIZARD_DEFAULT_DATA } from '@/types/project';
import { planSeed, planDocuments, planQuestionDue } from './plan-answer';
import { readStatedFloors, NO_FLOOR_PLAN_FACTS } from '@/lib/budget/extract-bq';
import type { PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';

/**
 * "Does your project have an architecture plan?"
 *
 * Asked before the wizard, in the same words whether a client is setting up their own
 * project or a partner contractor is doing it for them. The answer decides whether
 * there is anything to estimate, and whether a bill of quantities is ever asked for.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gate       = strip(read('src/components/wizard/ArchitecturePlanGate.tsx'));
const stepWrap   = strip(read('src/components/wizard/PlanQuestionStep.tsx'));
const admin      = strip(read('src/app/routes/admin/projects.new.tsx'));
const contractor = strip(read('src/app/routes/work/clients.new.tsx'));
const client     = strip(read('src/app/routes/projects/new.tsx'));
const confirm    = strip(read('src/components/wizard/steps/Step11ConfirmBudget.tsx'));

const YES = (over: Partial<Extract<PlanAnswer, { hasPlan: true }>> = {}): PlanAnswer =>
  ({
    hasPlan: true, floorPlans: [], bq: null, reading: null, lineItems: [], floorPlanFacts: [],
    bqStatedFloors: null,
    ...over,
  });

describe('the answer carried into the wizard', () => {
  it('NO records a definite false, which is what stops the BQ being asked for again', () => {
    // `null` would leave the final step's attachment box showing. Only a definite NO
    // suppresses it, so the difference matters.
    expect(planSeed({ hasPlan: false })).toEqual({ hasArchitecturePlan: false, bqTotalUsd: null });
  });

  it('an unanswered question changes nothing', () => {
    expect(planSeed(null)).toEqual({});
  });

  it('YES carries a confident reading forward as the budget', () => {
    const answer = YES({
      reading: { total: 13_500_000, label: 'Grand Total', confidence: 'grand', currencyCode: 'USD' },
    });
    // The derived kind rides along now. Steps 2 and 3 are no longer on this route —
    // somebody with a plan and a bill has answered them already — and
    // `projects.project_type` is NOT NULL, so the seed must supply it or the insert
    // is refused at the final click.
    expect(planSeed(answer)).toEqual({
      hasArchitecturePlan: true, bqTotalUsd: 13_500_000,
      projectType: 'residential', buildingType: 'single_family',
    });
  });

  it('converts an explicitly local-currency total to the stored USD amount', () => {
    const answer = YES({
      reading: { total: 13_500_000, label: 'Grand Total XAF', confidence: 'grand', currencyCode: 'XAF' },
    });
    expect(planSeed(answer, { localCurrencyCode: 'XAF', approxFxRate: 600 }).bqTotalUsd)
      .toBe(22_500);
  });

  it('does not treat an unidentified currency as USD', () => {
    const answer = YES({
      reading: { total: 13_500_000, label: 'Grand Total', confidence: 'grand' },
    });
    expect(planSeed(answer).bqTotalUsd).toBeNull();
  });

  it('but a GUESS is not carried forward', () => {
    /**
     * THE ONE THAT MATTERS. A `sum` reading is the largest number on the page, which
     * on a BQ whose sections were never totalled is merely the largest section. That
     * figure would become the construction budget and be split across ten stage
     * payments, so it is left for the person to type instead.
     */
    const answer = YES({ reading: { total: 9_000_000, label: 'Superstructure', confidence: 'sum' } });
    expect(planSeed(answer).bqTotalUsd).toBeNull();
    expect(planSeed(answer).hasArchitecturePlan).toBe(true);
  });

  it('the seed only ever sets fields the question is about', () => {
    // The list grew when steps 2 and 3 left this route: what those screens used to
    // collect is now read from the documents here instead. It is still a closed list
    // — the seed must not quietly reach into the rest of the form.
    const allowed = [
      'hasArchitecturePlan', 'bqTotalUsd',
      'projectType', 'buildingType', 'projectName',
      'floors', 'sqm', 'bedrooms', 'bathrooms', 'livingRooms', 'kitchens',
    ];
    for (const answer of [{ hasPlan: false } as PlanAnswer, YES()]) {
      for (const key of Object.keys(planSeed(answer))) {
        expect(allowed, `${key} is not a field this question answers`).toContain(key);
      }
    }
  });

  it('never leaves the project type null, whatever the documents said', () => {
    // This is the one that stops the insert being refused. A bill that names nothing
    // still has to produce a type, and the summary shows it before anyone commits.
    const seed = planSeed(YES());
    expect(seed.projectType).toBe('residential');
    expect(seed.buildingType).toBe('single_family');
  });

  it('both fields exist on the default form data, so nothing is undefined', () => {
    expect(WIZARD_DEFAULT_DATA.hasArchitecturePlan).toBeNull();
    expect(WIZARD_DEFAULT_DATA.bqTotalUsd).toBeNull();
  });
});

describe('the documents', () => {
  it('file the floor plan as a drawing and the BQ as a costing', () => {
    // Filing both as 'boq' would show two bills of quantities and no plan in the
    // Documents tab.
    const plan = new File(['x'], 'plan.pdf');
    const upperPlan = new File(['z'], 'upper-floor.pdf');
    const bq   = new File(['y'], 'boq.csv');
    expect(planDocuments(YES({ floorPlans: [plan, upperPlan], bq }))).toEqual([
      { file: plan, category: 'other' },
      { file: upperPlan, category: 'other' },
      { file: bq,   category: 'boq' },
    ]);
  });

  it('a NO answer has nothing to upload', () => {
    expect(planDocuments({ hasPlan: false })).toEqual([]);
    expect(planDocuments(null)).toEqual([]);
  });
});

describe('the question itself', () => {
  it('is one question, asked by one component, wherever you start from', () => {
    // "It's the same design that you see now that will also appear on the client's
    // floor." Both routers wrap their step in the same interceptor, so the wording
    // and the moment cannot drift apart.
    expect(stepWrap).toMatch(/<ArchitecturePlanGate/);
    expect(client).toMatch(/<PlanQuestionStep>/);
    expect(admin).toMatch(/<PlanQuestionStep>/);
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      expect(read(f)).toMatch(/planGate: \{/);
    }
  });

  it('asks it straight AFTER the country step, not before the wizard', () => {
    // Asked in front of the whole thing it is a question with no context — nobody has
    // said what they are building or where. After step 1 they are oriented, and the
    // answer decides whether the next eight questions are worth asking at all.
    // The condition moved into `planQuestionDue` on 28 October so the reload case
    // could be tested without a browser; the rule it encodes is unchanged, and is
    // asserted directly rather than through its source text.
    expect(planQuestionDue({ step: 1, hasPlan: null, hasPlanDoc: false, hasBqDoc: false, seen: false })).toBe(false);
    expect(planQuestionDue({ step: 2, hasPlan: null, hasPlanDoc: false, hasBqDoc: false, seen: false })).toBe(true);
    expect(stepWrap).toMatch(/if \(!due\) return/);
    // And it is not a numbered step: the ten are hard-coded in the progress bar and
    // the building preview, so inserting one would renumber all of them.
    expect(read('src/contexts/WizardContext.tsx')).toMatch(/TOTAL_STEPS = 9/);
  });

  it('the answer is written into the wizard, so Back and forward does not re-ask', () => {
    expect(stepWrap).toMatch(/update\(planSeed\(answer, \{/);
  });

  it('the files go into wizard state, because a File cannot be drafted', () => {
    // sessionStorage silently stores `{}` for a File. Keeping them in the provider is
    // what stops a chosen plan vanishing on the next render.
    expect(stepWrap).toMatch(/setPendingDocuments\?\.\(planDocuments\(answer\)\)/);
    expect(read('src/contexts/WizardContext.tsx')).toMatch(/setPendingDocuments: setDocs/);
  });

  it('uses the plain term, not the technical one', () => {
    // "The technical term is design, but everybody won't understand."
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('  planGate: {'));
    const copy = block.slice(0, block.indexOf('\n  },'));
    expect(copy).toMatch(/architecture plan/i);
    expect(copy).not.toMatch(/architectural design\b/i);
  });

  it('requires both documents on the YES path', () => {
    // Both are the point of that route. Somebody who cannot produce them belongs on
    // the other branch, and Back is how they get there.
    expect(gate).toMatch(/disabled=\{!floorPlans\.length \|\| !bq \|\| scanning\}/);
    expect(gate).toMatch(/setSlide\('ask'\)/);
  });

  it('requires a selected answer and a Next action before advancing', () => {
    expect(gate).toMatch(/selectedHasPlan === null/);
    expect(gate).toMatch(/onClick=\{\(\) => \{\s*if \(selectedHasPlan === true\) setSlide\('upload'\);\s*else if \(selectedHasPlan === false\) onAnswered\(\{ hasPlan: false \}\);/);
    expect(gate).toMatch(/aria-pressed=\{selected\}/);
  });

  it('shows what it read, with the row it came from', () => {
    // A figure that becomes ten stage payments is not accepted unseen.
    expect(gate).toMatch(/reading\.label/);
    expect(gate).toMatch(/guessedTotal/);
  });

  it('cautions about a scan and says nothing extra about a clean read', () => {
    // The clean-read paragraph promised the figure could be corrected later, which is
    // true of every figure in the wizard and so told nobody anything. Dropped on
    // 28 October. The OCR caution stays: only there can a digit actually be wrong.
    expect(gate).toMatch(/\{fromOcr && \(/);
    expect(gate).toContain("t('planGate.checkScanned')");
    for (const f of ['src/components/wizard/ArchitecturePlanGate.tsx',
                     'src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      expect(read(f), `${f} still carries the dropped line`).not.toMatch(/confirmLater/);
    }
  });
});

describe('nobody is asked for a bill of quantities twice', () => {
  it('the final step hides the attachment box once the question has been answered', () => {
    // Either answer means we already know: NO, they have none; YES, they uploaded it
    // when they said so. Only an unanswered question leaves the box up — or, since
    // 28 October, a reload that threw the uploaded Files away.
    expect(confirm).toMatch(/\{\(data\.hasArchitecturePlan === null \|\| planFilesLost\) && \(/);
  });

  it('but offers it again when a reload lost the documents', () => {
    // The box is the last place anyone can say the plan and the bill are gone. Without
    // it the project is created priced from a bill it does not hold, silently.
    expect(confirm).toMatch(/const planFilesLost = data\.hasArchitecturePlan === true && planDocumentsSeen/);
    expect(confirm).toMatch(/\(needsReattachment \|\| planFilesLost\) && !file/);
  });

  it('but keeps it when the question was never put', () => {
    // A draft from before this question existed carries null, and that person was
    // never asked — hiding it from them would be hiding it on a guess.
    expect(confirm).toMatch(/hasArchitecturePlan === null/);
  });

  it('the stage is CHOSEN from our stages, never typed', () => {
    // It used to be a sentence a matcher read a stage out of. That asks somebody to
    // describe a thing we already have the list of and then second-guesses them — and
    // the answer decides which stages are billed as already built.
    expect(confirm).toMatch(/const startStage = stageOverride \?\? 1;/);
    expect(confirm).not.toMatch(/stageFromDescription\(/);
    expect(confirm).not.toMatch(/setDescribed\(/);
    expect(confirm).toMatch(/STAGE_KEYS\.slice\(0, -1\)\.map/);
  });

  it('and a client can say their build is already under way', () => {
    // Gated on `onBehalfOf`, the only people who could say so were staff and
    // contractors — while a client with a half-built house is the commonest case.
    // Stronger than it was: the stage list is no longer behind a checkbox either, so
    // there is nothing to gate on at all. It is simply always on the screen, and the
    // default — stage 1, nothing built — is the honest answer for most people.
    const at = confirm.indexOf("t('wizard.joined.stageLabel')");
    expect(at).toBeGreaterThan(-1);
    expect(confirm.slice(Math.max(0, at - 900), at)).not.toMatch(/\{onBehalfOf && \(/);
    expect(confirm).not.toMatch(/alreadyStarted \? /);
    expect(confirm).not.toContain("t('wizard.joined.question')");
  });

  it('the final budget still opens from BQ when available', () => {
    // Budget confirmation moved to the summary step, but Step 11 still reads the
    // same saved draft value and falls back to BQ before any estimate.
    expect(confirm).toMatch(/opening\s+= data\.bqTotalUsd \?\? \(documentFlow \? null : estimate\)/);
    expect(confirm).toMatch(/const raw = confirmationDraft\?\.raw/);
  });
});

describe('resuming', () => {
  it('a restored draft carries its own answer, so nobody is asked twice', () => {
    // The answer lives in the wizard's data and the draft round-trips it. There is no
    // separate per-route flag to keep in step any more.
    expect(read('src/lib/projects/wizard-draft.ts')).toMatch(/hasArchitecturePlan: typeof value\.hasArchitecturePlan === 'boolean'/);
  });

  it('and a draft saved before the question existed is tolerated, not discarded', () => {
    expect(read('src/lib/projects/wizard-draft.ts')).toMatch(/\? value\.hasArchitecturePlan : null/);
  });
});

describe('refreshing does not send anybody back to the first question', () => {
  /**
   * A File cannot be put in sessionStorage. A reload therefore always leaves the
   * wizard holding no floor plan and no bill — and reading that as "they never
   * uploaded anything" drew this question over whatever step they had reached.
   *
   * Ruth, 28 October: "He just refreshed and it took him to the very beginning for
   * start project", and partners "have been complaining stylishly" before that. He
   * was on the budget confirmation at the time.
   */
  const state = (over: Partial<Parameters<typeof planQuestionDue>[0]> = {}) => ({
    step: 8, hasPlan: true, hasPlanDoc: true, hasBqDoc: true, seen: true, ...over,
  });

  it('keeps somebody on their step when a reload dropped the files', () => {
    expect(planQuestionDue(state({ hasPlanDoc: false, hasBqDoc: false }))).toBe(false);
  });

  it('even on the confirmation step, which is where he was', () => {
    expect(planQuestionDue(state({ step: 9, hasPlanDoc: false, hasBqDoc: false }))).toBe(false);
  });

  it('but still asks the first time, before anything was uploaded', () => {
    expect(planQuestionDue(state({ hasPlanDoc: false, hasBqDoc: false, seen: false }))).toBe(true);
  });

  it('and still asks when only one of the two was supplied', () => {
    expect(planQuestionDue(state({ hasBqDoc: false, seen: false }))).toBe(true);
    expect(planQuestionDue(state({ hasPlanDoc: false, seen: false }))).toBe(true);
  });

  it('never asks before the country step', () => {
    expect(planQuestionDue(state({ step: 1, hasPlan: null }))).toBe(false);
  });

  it('asks an unanswered question from step 2 onwards', () => {
    expect(planQuestionDue(state({ step: 2, hasPlan: null, hasPlanDoc: false, hasBqDoc: false, seen: false }))).toBe(true);
  });

  it('never re-asks somebody who said no', () => {
    expect(planQuestionDue(state({ hasPlan: false, hasPlanDoc: false, hasBqDoc: false, seen: false }))).toBe(false);
  });
});

describe('the summary comes prefilled from the documents', () => {
  /**
   * 28 October: "project at a glance contents should come prefilled if boq and floor
   * plan were attached." It was asking for a floor count that both documents already
   * stated — the drawing by its staircase (which proves an upper floor without
   * saying how many) and the bill by its own title, "Mr.NAS G + 1 Cost Estimate".
   */
  it('takes the storey count the bill states when the drawing did not', () => {
    expect(planSeed(YES({ bqStatedFloors: 2 })).floors).toBe(2);
  });

  it('but the drawing still wins where it says so itself', () => {
    const facts = { ...NO_FLOOR_PLAN_FACTS, readable: true, floors: 3 };
    expect(planSeed(YES({ floorPlanFacts: [facts], bqStatedFloors: 2 })).floors).toBe(3);
  });

  it('and claims nothing when neither document says', () => {
    expect(planSeed(YES()).floors).toBeUndefined();
  });

  it('reads "G+1" as two storeys, counting the ground floor', () => {
    expect(readStatedFloors('Mr.NAS G + 1 Cost Estimate Limbe').value).toBe(2);
    expect(readStatedFloors('CONSTRUCTION ESTIMATE OF G+1 BUILDING FOR MRS ROSE').value).toBe(2);
    expect(readStatedFloors('PROPOSED G+2+TT GUEST HOUSE').value).toBe(3);
  });

  it('reads a plainly stated count too', () => {
    expect(readStatedFloors('3 STOREYS').value).toBe(3);
    expect(readStatedFloors('Floors: 2').value).toBe(2);
  });

  it('says nothing when the document does not state one', () => {
    expect(readStatedFloors('BILL OF QUANTITIES\nFOUNDATION\t2,966,628').value).toBeNull();
  });

  it('refuses a storey count no building has', () => {
    expect(readStatedFloors('G+99').value).toBeNull();
  });
});
