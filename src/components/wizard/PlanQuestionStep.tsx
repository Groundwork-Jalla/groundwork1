import { useWizard } from '@/contexts/WizardContext';
import { ArchitecturePlanGate, type PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';
import { planDocuments, planSeed } from '@/lib/projects/plan-answer';

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
  const { step, data, update, back, pendingDocuments, setPendingDocuments, setDocumentExtraction } = useWizard();

  const uploadedPlanDocs = pendingDocuments?.some(doc => doc.category === 'other') ?? false;
  const uploadedBq = pendingDocuments?.some(doc => doc.category === 'boq') ?? false;
  const needsPlanUpload = data.hasArchitecturePlan === true && !(uploadedPlanDocs && uploadedBq);
  if (step < 2 || (data.hasArchitecturePlan !== null && !needsPlanUpload)) return <>{children}</>;

  return (
    <ArchitecturePlanGate
      // Back returns to the country step rather than leaving the wizard: they are
      // inside it now, and the only way out of a wizard is its own Back.
      onCancel={back}
      onAnswered={(answer: PlanAnswer) => {
        update(planSeed(answer));
        // The files travel separately: they are uploaded once the project exists,
        // because there is nothing to attach them to until then.
        setPendingDocuments?.(planDocuments(answer));
        setDocumentExtraction(answer.hasPlan ? {
          bqLineItems: answer.lineItems,
          floorPlans: answer.floorPlans.map((file, i) => ({
            fileName: file.name,
            facts: answer.floorPlanFacts[i] ?? { readable: false, floors: null, areaSqm: null },
          })),
        } : null);
      }}
    />
  );
}
