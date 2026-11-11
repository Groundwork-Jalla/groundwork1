import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { restorePartnerDraft } from './partner-draft';

/**
 * Leaving the partner application and coming back lands where you were.
 *
 * Favour, 11 Nov 2026: "once you leave the page to go elsewhere, even if you were at
 * the end, it takes you back to square one." The answers were saved every two seconds
 * for the admin follow-up list and never read back; the page was not saved at all.
 */

const SAVED = {
  languages: ['fr'], years: '6-10', operatesAs: 'company', capacity: '2-3',
  regions: 'Douala, Yaoundé', diasporaHistory: 'Two houses for families in Paris.',
  whyJoin: 'Steady clients.', differentiator: 'We finish on time.',
  projectStatus: 'running', projectStage: 'roofing', startWindow: '',
  clientOnSiteDaily: false, offsiteReason: 'abroad', offsiteOther: '',
  useGroundwork: 'yes', page: 7, pageStack: [0, 1, 2, 3, 4, 5, 6],
};

describe('restorePartnerDraft', () => {
  it('brings back every answer and the page they had reached', () => {
    const r = restorePartnerDraft(SAVED);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      callLang: 'fr', years: '6-10', operatesAs: 'company', regions: 'Douala, Yaoundé',
      projectStatus: 'running', clientOnSiteDaily: false, useGroundwork: 'yes',
      page: 7, pageStack: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it('keeps a closed-set answer only when it is one of the set', () => {
    const r = restorePartnerDraft({ ...SAVED, projectStatus: 'whatever', useGroundwork: 42 });
    expect(r?.projectStatus).toBeNull();
    expect(r?.useGroundwork).toBeNull();
  });

  it('keeps a page only when the stack can explain it', () => {
    // A page with no history behind it cannot have been reached by pressing Next, and
    // resuming there would leave Back with nowhere to go.
    expect(restorePartnerDraft({ ...SAVED, page: 7, pageStack: [] })?.page).toBe(0);
    expect(restorePartnerDraft({ ...SAVED, page: 99 })?.page).toBe(0);
    expect(restorePartnerDraft({ ...SAVED, page: -1 })?.page).toBe(0);
  });

  it('is nothing to resume when nothing was answered', () => {
    expect(restorePartnerDraft({})).toBeNull();
    expect(restorePartnerDraft({ page: 3, pageStack: [0, 1, 2] })).toBeNull();
    expect(restorePartnerDraft(null)).toBeNull();
    expect(restorePartnerDraft('junk')).toBeNull();
    expect(restorePartnerDraft([SAVED])).toBeNull();
  });

  it('does not let an oversized string through', () => {
    expect(restorePartnerDraft({ ...SAVED, whyJoin: 'x'.repeat(5000) })?.whyJoin).toBe('');
  });
});

describe('the partner page resumes from the draft it was already saving', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', '..', 'src/app/routes/work/partner.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('reads the saved draft back on load, for an application not yet submitted', () => {
    expect(src).toMatch(/fetchDraftPayload\(partnerDraftId\(user\.id\)\)/);
    expect(src).toMatch(/restorePartnerDraft\(/);
  });

  it('saves the page and its history alongside the answers', () => {
    expect(src).toMatch(/payload: \{[\s\S]{0,600}page, pageStack,/);
    // ...and re-saves when the page changes, not only when an answer does.
    expect(src).toMatch(/const draftState = JSON\.stringify\(\[[\s\S]{0,400}page, pageStack\]\)/);
  });

  it('resumes without counting it as starting the application again', () => {
    // `continueTo` records the funnel's "started"; a resume sets the page directly.
    const resume = src.slice(src.indexOf('restorePartnerDraft('), src.indexOf('restorePartnerDraft(') + 1200);
    expect(resume).toMatch(/setPage\(restored\.page\)/);
    expect(resume).not.toMatch(/continueTo\(/);
  });
});
