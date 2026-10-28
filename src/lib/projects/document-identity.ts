import type { WizardFormData } from '@/types/project';
import type { FloorPlanFacts } from '@/lib/budget/extract-bq';

// =========================================================
// What the documents say the building IS, and what it is called.
//
// Somebody who arrives with a floor plan and a bill of quantities has already
// answered "what are you building" — twice, on paper, in more detail than a dropdown
// could hold. Asking them again is the product failing to read what it was given.
//
// It was asked anyway because `projects.project_type` is NOT NULL (migration 003) and
// nothing else filled it; skipping the questions produced a null and the insert was
// refused at the final click. This module is what makes the skip safe: every field
// those two steps used to collect is derived here, from the documents, with a stated
// default when they are silent.
//
// A DEFAULT IS NOT A GUESS DRESSED UP. It is shown on the summary, under "Type", on
// the same screen as the button that creates the project — so it is the one thing on
// that page that is asserted rather than read, and it is visible before anyone
// commits to it.
// =========================================================

type Kind = Pick<WizardFormData, 'projectType' | 'buildingType'>;

/**
 * What the overwhelming majority of Groundwork projects are.
 *
 * Stated here rather than buried in a fallback branch, because this is the value that
 * ends up on a project when a bill says nothing about the building — and somebody
 * reading this file should be able to see what that is without tracing the code.
 */
export const DEFAULT_BUILDING_KIND: Kind = {
  projectType: 'residential',
  buildingType: 'single_family',
};

/**
 * Keyword to building, most specific first.
 *
 * Order carries meaning: "GUEST HOUSE" contains "house", so the hotel rule has to be
 * reached before the house one or every guest house in Kribi becomes a family home.
 */
const RULES: { pattern: RegExp; kind: Kind }[] = [
  { pattern: /\b(?:guest\s*-?\s*house|hotel|motel|lodge|auberge)\b/i,
    kind: { projectType: 'commercial', buildingType: 'hotel' } },
  { pattern: /\b(?:warehouse|entrep[oô]t|hangar)\b/i,
    kind: { projectType: 'industrial', buildingType: 'warehouse_industrial' } },
  { pattern: /\b(?:factory|usine|plant\s+building)\b/i,
    kind: { projectType: 'industrial', buildingType: 'factory' } },
  { pattern: /\b(?:shop|store|retail|boutique|supermarket|march[eé])\b/i,
    kind: { projectType: 'commercial', buildingType: 'retail' } },
  { pattern: /\b(?:office|bureaux?)\b/i,
    kind: { projectType: 'commercial', buildingType: 'office' } },
  { pattern: /\b(?:apartments?|flats?|immeuble)\b/i,
    kind: { projectType: 'residential', buildingType: 'multi_family' } },
  { pattern: /\b(?:terrace[ds]?|row\s*hous\w*)\b/i,
    kind: { projectType: 'residential', buildingType: 'townhouse' } },
  { pattern: /\bduplex\b/i,
    kind: { projectType: 'residential', buildingType: 'semi_detached' } },
  { pattern: /\b(?:bungalow|residen\w*|villa|house|home|maison|logement)\b/i,
    kind: { projectType: 'residential', buildingType: 'single_family' } },
];

/** Two of everything a dwelling has one of means it is not one dwelling. */
function looksLikeSeveralDwellings(facts: FloorPlanFacts[]): boolean {
  return facts.some(fact =>
    (fact.kitchens ?? 0) >= 2 && (fact.livingRooms ?? 0) >= 2);
}

/**
 * What the documents say is being built.
 *
 * `text` is whatever we have — the bill's title block, the drawing's text layer, the
 * file names. Anything that might name the building.
 */
export function readBuildingKind(text: string, floorPlanFacts: FloorPlanFacts[] = []): Kind {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      // A plan with three kitchens and three sitting rooms is a block of flats even
      // where the bill only ever says "RESIDENTIAL". The drawing outranks the word.
      if (rule.kind.projectType === 'residential'
        && rule.kind.buildingType === 'single_family'
        && looksLikeSeveralDwellings(floorPlanFacts)) {
        return { projectType: 'residential', buildingType: 'multi_family' };
      }
      return rule.kind;
    }
  }
  if (looksLikeSeveralDwellings(floorPlanFacts)) {
    return { projectType: 'residential', buildingType: 'multi_family' };
  }
  return DEFAULT_BUILDING_KIND;
}
