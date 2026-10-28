import { useWizard } from '@/contexts/WizardContext';
import { ArchitecturePlanGate, type PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';
import { planDocuments, planSeed, planQuestionDue } from '@/lib/projects/plan-answer';
import { getApproxFx, getCurrencyCode } from '@/lib/budget/legacy';
import { NO_FLOOR_PLAN_FACTS } from '@/lib/budget/extract-bq';

// =========================================================
// "Does your project have an architecture plan?", asked straight after the country.
//
// ── Why here and not before the wizard ──────────────────────────────────────────────
// It used to be a screen in front of the whole thing. Asked that early it is a question
// with no context — somebody has not yet said what they are building or where. After
// the country step they are oriented, and the answer is the thing that decides whether
// the next eight questions are worth asking at all.
//
// ── Why it is not a numbered step ───────────────────────────────────────────────────
// The wizard steps are hard-coded by number in the progress bar, the building preview
// and both routers. Inserting one renumbers all of them. This intercepts the render
// between step 1 and step 2 instead: the wizard steps stay numbered, and this is a
// question asked on the way past.
// =========================================================

/**
 * Render the question in place of `children` when it is due.
 *
 * Due means: past the country step, and not yet answered. Answering writes it into the
 * wizard's own data, so a Back to step 1 and forward again does not ask twice.
 */
export function PlanQuestionStep({ children }: { children: React.ReactNode }) {
  const {
    step, data, update, goTo, back, pendingDocuments, setPendingDocuments,
    setDocumentExtraction, constructionRate, planDocumentsSeen,
  } = useWizard();

  const uploadedPlanDocs = pendingDocuments?.some(doc => doc.category === 'other') ?? false;
  const uploadedBq = pendingDocuments?.some(doc => doc.category === 'boq') ?? false;
  // Whether this question is due is pure, and lives in `plan-answer` so the case that
  // bit partners — a reload drops the Files, which must not un-answer the question —
  // can be tested without a browser.
  const due = planQuestionDue({
    step,
    hasPlan: data.hasArchitecturePlan,
    hasPlanDoc: uploadedPlanDocs,
    hasBqDoc: uploadedBq,
    seen: planDocumentsSeen,
  });
  if (!due) return <>{children}</>;

  return (
    <ArchitecturePlanGate
      // Back returns to the country step rather than leaving the wizard: they are
      // inside it now, and the only way out of a wizard is its own Back.
      onCancel={back}
      onAnswered={(answer: PlanAnswer) => {
        update(planSeed(answer, {
          localCurrencyCode: constructionRate?.currency_code ?? getCurrencyCode(data.country),
          approxFxRate: constructionRate?.approx_fx_rate ?? getApproxFx(data.country),
        }));
        // The files travel separately: they are uploaded once the project exists,
        // because there is nothing to attach them to until then.
        setPendingDocuments?.(planDocuments(answer));
        setDocumentExtraction(answer.hasPlan ? {
          bqReading: answer.reading,
          bqLineItems: answer.lineItems,
          bqStatedFloors: answer.bqStatedFloors,
          floorPlans: answer.floorPlans.map((file, i) => ({
            fileName: file.name,
            facts: answer.floorPlanFacts[i] ?? NO_FLOOR_PLAN_FACTS,
          })),
        } : null);
        // Straight to the summary. Steps 2 and 3 are not on this route: the
        // documents answered them, and `planSeed` above has just written those
        // answers into the wizard, so `project_type` is set before anything is
        // created. Skipping them WITHOUT that was the bug — the insert reached the
        // database with a null and was refused at the final click.
        if (answer.hasPlan) goTo(8);
      }}
    />
  );
}
