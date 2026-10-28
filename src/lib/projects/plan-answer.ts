import type { WizardFormData } from '@/types/project';
import { readWizardDraft } from './wizard-draft';
import { readBuildingKind, projectNameFromDocuments } from './document-identity';
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

  // What the two skipped questions used to collect, read instead of asked.
  //
  // `projects.project_type` is NOT NULL, so this is not a nicety: without it the
  // document route reaches the final click and the insert is refused. Taken from
  // everything we have that might name the building — the bill's own rows, the
  // drawing's text, and both file names.
  const documentText = [
    ...(answer.bq ? [answer.bq.name] : []),
    ...answer.floorPlans.map(file => file.name),
    ...answer.lineItems.map(item => item.label),
    answer.reading?.label ?? '',
  ].join('\n');
  const kind = readBuildingKind(documentText, facts);
  const namedByDocuments = projectNameFromDocuments([
    ...(answer.bq ? [answer.bq.name] : []),
    ...answer.floorPlans.map(file => file.name),
  ]);

  return {
    hasArchitecturePlan: true,
    ...kind,
    // Only as a starting point: the summary shows this in an editable box, so a name
    // taken off a file name is a suggestion the person sees before anything is made.
    ...(namedByDocuments ? { projectName: namedByDocuments } : {}),
    // A suggestion, not a decision: the confirm step shows it and it can be corrected
    // before anything is created. Only a reading we are confident in is carried
    // forward — a guess is left for the person to type, so a figure they never looked
    // at cannot become the stage payment schedule.
    // The drawing first, then the bill. A ground plan with a staircase proves there
    // is an upper floor without saying how many, and its bill usually names the
    // building in its title — "Mr.NAS G + 1", "G+1 BUILDING FOR MRS ROSE". Leaving
    // this blank made somebody type a number the documents had already stated.
    ...(detectedFloors.length ? { floors: Math.max(...detectedFloors) }
      : answer.bqStatedFloors ? { floors: answer.bqStatedFloors } : {}),
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

/**
 * Is the architecture-plan question due on this render?
 *
 * Pure, because the answer decides whether somebody sees the wizard they were filling
 * in or the first question again, and that is worth being able to test without a
 * browser.
 *
 * `seen` is the whole point. A File cannot go in sessionStorage, so a refresh always
 * leaves `hasPlanDoc`/`hasBqDoc` false — and reading that as "they never uploaded
 * anything" drew this question over whatever step they had reached. Somebody
 * confirming their budget pressed refresh and was sent back to the very first
 * question. Partners had been complaining about it for a while before 28 October,
 * when a contractor did it on a call.
 */
export function planQuestionDue(state: {
  step: number;
  hasPlan: boolean | null;
  hasPlanDoc: boolean;
  hasBqDoc: boolean;
  seen: boolean;
}): boolean {
  // Asked after the country step, never before: until then there is no context for it.
  if (state.step < 2) return false;
  // Never asked at all yet.
  if (state.hasPlan === null) return true;
  // Answered NO. Nothing to upload, nothing to ask again.
  if (state.hasPlan === false) return false;
  // Answered YES: due only while the documents are still genuinely outstanding.
  return !(state.hasPlanDoc && state.hasBqDoc) && !state.seen;
}
