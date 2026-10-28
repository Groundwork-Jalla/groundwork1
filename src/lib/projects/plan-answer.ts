import type { WizardFormData } from '@/types/project';
import { readWizardDraft } from './wizard-draft';
import type { PlanAnswer } from '@/components/wizard/ArchitecturePlanGate';

export interface PlanBudgetConversion {
  localCurrencyCode: string | null;
  approxFxRate: number | null;
}

// =========================================================
// Carrying the architecture-plan answer into the wizard.
//
// The question is asked before the wizard starts, so its answer has to be handed in
// rather than collected. Two fields travel: whether a plan exists at all, and the
// construction figure read out of the bill of quantities.
//
// The FILES do not travel this way. They are uploaded once a project id exists, the
// same as the costing attachment has always been — there is nothing to attach them to
// until then.
// =========================================================

/** The wizard fields an answered plan question sets. Empty when unanswered. */
export function planSeed(
  answer: PlanAnswer | null,
  conversion: PlanBudgetConversion = { localCurrencyCode: null, approxFxRate: null },
): Partial<WizardFormData> {
  if (!answer) return {};
  if (!answer.hasPlan) {
    // Recorded as a definite NO, which is what suppresses the bill-of-quantities
    // prompt on the final step. `null` would leave it showing.
    return { hasArchitecturePlan: false, bqTotalUsd: null };
  }
  const facts = answer.floorPlanFacts ?? [];
  const detectedFloors = facts
    .map(fact => fact.floors)
    .filter((floors): floors is number => floors != null);
  const detectedFootprints = facts
    .map(fact => fact.footprintSqm)
    .filter((sqm): sqm is number => sqm != null);
  const detectedBedrooms = facts
    .map(fact => fact.bedrooms)
    .filter((count): count is number => count != null);
  const detectedBathrooms = facts
    .map(fact => fact.bathrooms)
    .filter((count): count is number => count != null);
  const detectedLivingRooms = facts
    .map(fact => fact.livingRooms)
    .filter((count): count is number => count != null);
  const detectedKitchens = facts
    .map(fact => fact.kitchens)
    .filter((count): count is number => count != null);
  const sourceReading = answer.reading;
  const totalUsd = sourceReading?.confidence === 'grand'
    ? sourceReading.currencyCode === 'USD'
      ? sourceReading.total
      : sourceReading.currencyCode === conversion.localCurrencyCode
        && conversion.approxFxRate != null && conversion.approxFxRate > 0
        ? sourceReading.total / conversion.approxFxRate
        : null
    : null;

  return {
    hasArchitecturePlan: true,
    // A suggestion, not a decision: the confirm step shows it and it can be corrected
    // before anything is created. Only a reading we are confident in is carried
    // forward — a guess is left for the person to type, so a figure they never looked
    // at cannot become the stage payment schedule.
    ...(detectedFloors.length ? { floors: Math.max(...detectedFloors) } : {}),
    ...(detectedFootprints.length ? { sqm: detectedFootprints[0] } : {}),
    ...(detectedBedrooms.length ? { bedrooms: Math.max(...detectedBedrooms) } : {}),
    ...(detectedBathrooms.length ? { bathrooms: Math.max(...detectedBathrooms) } : {}),
    ...(detectedLivingRooms.length ? { livingRooms: Math.max(...detectedLivingRooms) } : {}),
    ...(detectedKitchens.length ? { kitchens: Math.max(...detectedKitchens) } : {}),
    bqTotalUsd: totalUsd,
  };
}

/** The documents to upload once the project exists, in the order they were asked for. */
export function planDocuments(answer: PlanAnswer | null): { file: File; category: 'other' | 'boq' }[] {
  if (!answer?.hasPlan) return [];
  const out: { file: File; category: 'other' | 'boq' }[] = [];
  // The floor plan is a drawing, not a costing, so it is not filed as 'boq' — the
  // Documents tab would then show two bills of quantities and no plan.
  for (const file of answer.floorPlans) out.push({ file, category: 'other' });
  if (answer.bq) out.push({ file: answer.bq, category: 'boq' });
  return out;
}

/**
 * Is there a wizard already in progress for this client?
 *
 * The architecture-plan question belongs to STARTING a project, not to resuming one.
 * A contractor who got halfway through and came back should land where they left off:
 * re-asking would be the product forgetting, and a different answer the second time
 * would quietly contradict the draft underneath it — say, turning off the estimating
 * steps they have already filled in.
 *
 * A draft saved before this question existed therefore keeps `hasArchitecturePlan` as
 * null, which leaves the bill-of-quantities box on the final step showing. That is the
 * right default for somebody we never asked: only a definite NO suppresses it.
 *
 * Read directly rather than through the provider, because the decision is whether to
 * mount the provider at all.
 */
export function wizardAlreadyStarted(persistenceKey: string | undefined): boolean {
  return persistenceKey ? readWizardDraft(persistenceKey) != null : false;
}
