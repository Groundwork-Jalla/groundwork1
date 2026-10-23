import { describe, expect, it } from 'vitest';
import { readAnswers, humanise } from './draft-answers';
import { en } from '@/lib/i18n/en';

/**
 * Ruth, after going to the contractor records to size an applicant up: "the partner
 * application details doesn't tell me much about who they are and whether they are fit
 * to be partners."
 *
 * The started-applications view showed the raw payload. That was deliberate — a
 * hand-written field list silently stops showing whatever was added to the form last,
 * and this payload has changed shape twice this week. So the fix keeps that property
 * and makes it readable: walk whatever is there, label what we can, show the rest under
 * its own name.
 */

const at = (p: string) => p.split('.').reduce<unknown>(
  (n, s) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[s] : undefined), en);

describe('nothing in the payload can go missing', () => {
  it('shows a field nobody has labelled yet, under its own name', () => {
    const out = readAnswers({ somethingAddedLastNight: 'yes' });
    expect(out).toHaveLength(1);
    expect(out[0].labelKey).toBeNull();
    expect(humanise(out[0].key)).toBe('Something added last night');
  });

  it('walks every key, answered or not', () => {
    const out = readAnswers({ years: '5-10', regions: '', whyJoin: '' });
    expect(out.map(a => a.key).sort()).toEqual(['regions', 'whyJoin', 'years']);
  });

  it('puts what they actually said first', () => {
    // Eleven blanks above the one answer is how the raw view read.
    const out = readAnswers({ regions: '', years: '5-10', whyJoin: '' });
    expect(out[0].key).toBe('years');
    expect(out[0].answered).toBe(true);
  });

  it('survives a payload that is not an object', () => {
    for (const bad of [null, undefined, 'x', 42]) expect(readAnswers(bad)).toEqual([]);
  });
});

describe('answers read as words, not as stored values', () => {
  it('resolves an option to the question and the answer', () => {
    const [a] = readAnswers({ projectStatus: 'running' });
    expect(at(a.labelKey as string)).toBe(
      'Do you have an active project about to start or already running?');
    expect(at(a.valueKey as string)).toBe('I have a project already running');
  });

  it('reads a boolean through the shared yes/no, so it follows the language', () => {
    const [a] = readAnswers({ clientOnSiteDaily: false });
    expect(a.valueKey).toBe('common.no');
    expect(at('common.no')).toBeTypeOf('string');
  });

  it('unwraps a single-answer array', () => {
    // `languages` is stored as an array because the question once took several.
    const [a] = readAnswers({ languages: ['fr'] });
    expect(a.raw).toBe('fr');
    expect(at(a.valueKey as string)).toBe('French');
  });

  it('leaves free text alone', () => {
    const [a] = readAnswers({ whyJoin: 'I want the client to see the work.' });
    expect(a.valueKey).toBeNull();
    expect(a.raw).toBe('I want the client to see the work.');
  });

  it('every label and option key it points at exists', () => {
    const payload = {
      languages: ['en'], years: '5-10', operatesAs: 'solo', capacity: '2',
      regions: 'Littoral', diasporaHistory: 'x', whyJoin: 'x', differentiator: 'x',
      projectStatus: 'running', projectStage: 'half_way', startWindow: '1_3_months',
      clientOnSiteDaily: false, offsiteReason: 'live_far', useGroundwork: 'maybe',
    };
    for (const a of readAnswers(payload)) {
      if (a.labelKey) expect(at(a.labelKey), `${a.key} label`).toBeTypeOf('string');
      if (a.valueKey) expect(at(a.valueKey), `${a.key} value`).toBeTypeOf('string');
    }
  });
});

describe('humanise', () => {
  it('splits camelCase and tidies separators', () => {
    expect(humanise('clientOnSiteDaily')).toBe('Client on site daily');
    expect(humanise('offsite_reason')).toBe('Offsite reason');
    expect(humanise('years')).toBe('Years');
  });
});
