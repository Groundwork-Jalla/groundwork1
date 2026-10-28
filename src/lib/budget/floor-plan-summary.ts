import type { FloorPlanFacts } from './extract-bq';
import type { TKey } from '@/lib/i18n/translate';

/**
 * The one-line reading of a floor plan.
 *
 * Written once because it is shown twice — on the upload step as the plan is read,
 * and again on the summary before anything is created — and the two had already
 * drifted into near-copies. They both still said "area not extracted" after the
 * reader learned to measure a footprint, because both were looking at `areaSqm`
 * while the new figure arrives as `footprintSqm`.
 *
 * The order is deliberate: storeys, then size, then rooms. Storeys and size are what
 * the budget is built from, so a missing one has to be visible at a glance rather
 * than buried after a list of bedrooms.
 */
export function floorPlanSummary(
  facts: Pick<FloorPlanFacts,
    'floors' | 'staircase' | 'areaSqm' | 'footprintSqm'
    | 'bedrooms' | 'bathrooms' | 'livingRooms' | 'kitchens'>,
  // The real `t`, keys and all. A loose `(key: string) => string` would take this
  // module's keys out of the dictionary's reach, so a renamed string would compile
  // here and render as a raw key on the screen.
  t: (key: TKey) => string,
  format: (value: number) => string = value => String(value),
): string {
  const parts: string[] = [];

  parts.push(
    facts.floors != null ? `${facts.floors} ${t('planGate.floors')}`
      // A staircase is not a storey count, and saying "floor count not extracted"
      // next to a drawn staircase reads as though we missed it. This says what we
      // actually know: there is an upper floor and we have not been given its sheet.
      : facts.staircase ? t('planGate.staircaseNoted')
      : t('planGate.floorCountMissing'));

  // A stated floor area is the architect's own figure for the whole building. A
  // footprint is the ground-floor envelope we measured off the dimension chain, so
  // it only stands in when nothing better was stated.
  const area = facts.areaSqm ?? facts.footprintSqm;
  parts.push(area != null ? `${format(area)} m²` : t('planGate.areaMissing'));

  if (facts.bedrooms != null)    parts.push(`${facts.bedrooms} ${t('planGate.bedrooms')}`);
  if (facts.bathrooms != null)   parts.push(`${facts.bathrooms} ${t('planGate.bathrooms')}`);
  if (facts.livingRooms != null) parts.push(`${facts.livingRooms} ${t('planGate.livingRooms')}`);
  if (facts.kitchens != null)    parts.push(`${facts.kitchens} ${t('planGate.kitchens')}`);

  return parts.join(' · ');
}

/**
 * The line of the drawing a reading came off, for showing under the summary.
 *
 * Prefers the footprint, because that is the figure a person is most likely to want
 * to check — a derived one reads "21.25 × 10.3 m", which is the whole derivation.
 */
export function floorPlanEvidence(facts: Pick<FloorPlanFacts, 'evidence'>): string | null {
  const ev = facts.evidence;
  return ev?.footprintSqm?.[0] ?? ev?.areaSqm?.[0] ?? ev?.floors?.[0] ?? null;
}
