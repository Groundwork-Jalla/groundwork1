import type { TKey } from '@/lib/i18n';

/**
 * A half-finished application, readable.
 *
 * Ruth, after going to the contractor records to size somebody up: "the partner
 * application details doesn't tell me much about who they are and whether they are fit
 * to be partners". The started-applications list showed the raw payload — correct, and
 * unreadable.
 *
 * The raw view was deliberate: a hand-written field list silently stops showing
 * whatever was added to the form last, and this payload has already changed shape twice
 * this week. So this keeps that property. It walks WHATEVER is in the payload rather
 * than a list of expected keys; a field nobody has labelled yet still appears, under
 * its own name. Nothing can go missing, which was the whole point of the raw view.
 */

/** `clientOnSiteDaily` → `Client on site daily`. The fallback when no label exists. */
export function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Where a field's own label lives, when the dictionary has one. */
const LABEL: Record<string, TKey> = {
  languages:         'partner.languages'   as TKey,
  years:             'partner.years'       as TKey,
  operatesAs:        'partner.operatesAs'  as TKey,
  capacity:          'partner.capacity'    as TKey,
  regions:           'partner.regions'     as TKey,
  diasporaHistory:   'partner.history'     as TKey,
  whyJoin:           'partner.whyJoin'     as TKey,
  differentiator:    'partner.differentiator' as TKey,
  projectStatus:     'partner.projectStatus'  as TKey,
  projectStage:      'partner.projectStage'   as TKey,
  startWindow:       'partner.startWindow'    as TKey,
  clientOnSiteDaily: 'partner.clientOnSite'   as TKey,
  offsiteReason:     'partner.offsiteReason'  as TKey,
  useGroundwork:     'partner.useGroundwork'  as TKey,
};

/** Where a field's ANSWER is a key rather than free text. */
const OPTIONS: Record<string, string> = {
  projectStatus: 'partner.projectStatusOpt',
  projectStage:  'partner.stageOpt',
  startWindow:   'partner.startOpt',
  offsiteReason: 'partner.offsiteOpt',
  useGroundwork: 'partner.useOpt',
  operatesAs:    'partner.operates',
  languages:     'partner.lang',
};

export interface Answer {
  key: string;
  /** The dictionary key for the question, or null to fall back to `humanise`. */
  labelKey: TKey | null;
  /** The dictionary key for the answer, or null when the value is free text. */
  valueKey: TKey | null;
  /** The raw value, used when `valueKey` is null or missing from the dictionary. */
  raw: string;
  answered: boolean;
}

/**
 * Every field in the payload, in a stable order, with its label and answer resolved.
 *
 * Answered fields come first: somebody reading this wants to know what the applicant
 * said, not scroll past eleven blanks to find it.
 */
export function readAnswers(payload: unknown): Answer[] {
  if (!payload || typeof payload !== 'object') return [];

  const out: Answer[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value[0] : value;
    const empty = first === null || first === undefined || first === '';

    let raw: string;
    if (empty) raw = '';
    else if (typeof first === 'boolean') raw = first ? 'yes' : 'no';
    else raw = String(first);

    const optionRoot = OPTIONS[key];
    out.push({
      key,
      labelKey: LABEL[key] ?? null,
      // Booleans read through common.yes / common.no so they follow the language too.
      valueKey: empty ? null
        : typeof first === 'boolean' ? (`common.${raw}` as TKey)
        : optionRoot ? (`${optionRoot}.${raw}` as TKey)
        : null,
      raw,
      answered: !empty,
    });
  }

  return out.sort((a, b) => Number(b.answered) - Number(a.answered));
}
