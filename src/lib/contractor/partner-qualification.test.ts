import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  disqualifiedBy, qualifiesForCall, ranksHighly, stillQualifying,
  type QualificationAnswers,
} from './partner-qualification';

/**
 * Philip: "if a question that they answer disqualifies them then they should not see
 * the remaining steps. The application gets discontinued for them."
 *
 * Before this, a disqualifying answer only withheld the calendar — the applicant
 * finished all ten questions, submitted, and waited for a reply that was never coming.
 */

const a = (o: QualificationAnswers = {}): QualificationAnswers => o;

describe('what ends an application', () => {
  it('no project at all', () => {
    expect(disqualifiedBy(a({ projectStatus: 'none' }))).toBe('no_project');
  });

  it('a client who can be on site every day', () => {
    // The counter-intuitive one. Somebody who can stand on the slab daily does not
    // need us — which is why "yes" is the answer that ends it, not "no".
    expect(disqualifiedBy(a({ clientOnSiteDaily: true }))).toBe('client_on_site_daily');
    expect(disqualifiedBy(a({ clientOnSiteDaily: false }))).toBeNull();
  });

  it('a build that will not be run here', () => {
    expect(disqualifiedBy(a({ willUseGroundwork: 'no' }))).toBe('not_using_groundwork');
  });

  it('but "maybe" is still in it', () => {
    // "Maybe, I need to understand the system better" is a request for the demo, which
    // is what the call is for. Philip: "if it's either one of the two, we still let
    // them proceed."
    expect(disqualifiedBy(a({ willUseGroundwork: 'maybe' }))).toBeNull();
    expect(disqualifiedBy(a({ willUseGroundwork: 'yes' }))).toBeNull();
  });

  /**
   * Experience ranks; it does not gate.
   *
   * The form document is explicit: "This question is not a disqualifying question. It
   * simply establishes who we give preference to when ranking them in the contractor
   * directory." That reverses the 22 October decision that under five years could not
   * book a call, so a one-to-three-year mason stays in the funnel.
   */
  it('never ends an application over years of experience', () => {
    expect(disqualifiedBy(a({ yearsExperience: '1-3' }))).toBeNull();
    expect(disqualifiedBy(a({ yearsExperience: '3-5' }))).toBeNull();
  });

  it('but still knows who ranks first', () => {
    expect(ranksHighly('5-10')).toBe(true);
    expect(ranksHighly('10+')).toBe(true);
    expect(ranksHighly('y5_10')).toBe(true);   // 147's other vocabulary
    expect(ranksHighly('1-3')).toBe(false);
    expect(ranksHighly(null)).toBe(false);
  });
});

describe('a question not yet reached never ends anything', () => {
  it('an empty form disqualifies nobody', () => {
    expect(disqualifiedBy(a())).toBeNull();
    expect(stillQualifying(a())).toBe(true);
  });

  it('distinguishes "not answered" from "answered no"', () => {
    // The whole point of the nullable answers: null is "has not got there yet".
    expect(disqualifiedBy(a({ clientOnSiteDaily: null }))).toBeNull();
    expect(disqualifiedBy(a({ projectStatus: null }))).toBeNull();
    expect(disqualifiedBy(a({ willUseGroundwork: null }))).toBeNull();
  });
});

describe('the reason shown is the question they just answered', () => {
  it('reports the earliest failure in the order the form asks', () => {
    // Somebody failing several rules is told about the one that stopped them, not
    // whichever rule happens to be checked first.
    expect(disqualifiedBy(a({
      projectStatus: 'none', clientOnSiteDaily: true, willUseGroundwork: 'no',
    }))).toBe('no_project');
    expect(disqualifiedBy(a({
      clientOnSiteDaily: true, willUseGroundwork: 'no',
    }))).toBe('client_on_site_daily');
  });
});

describe('who reaches the calendar', () => {
  const full: QualificationAnswers = {
    yearsExperience: '5-10', projectStatus: 'running',
    clientOnSiteDaily: false, willUseGroundwork: 'yes',
  };

  it('a complete, qualifying application', () => {
    expect(qualifiesForCall(full)).toBe(true);
  });

  it('a project about to start qualifies as readily as one running', () => {
    expect(qualifiesForCall({ ...full, projectStatus: 'starting' })).toBe(true);
  });

  it('not while anything is still unanswered', () => {
    expect(qualifiesForCall({ ...full, clientOnSiteDaily: null })).toBe(false);
    expect(qualifiesForCall({ ...full, willUseGroundwork: null })).toBe(false);
  });

  it('and never when a rule is failed', () => {
    expect(qualifiesForCall({ ...full, clientOnSiteDaily: true })).toBe(false);
    expect(qualifiesForCall({ ...full, willUseGroundwork: 'no' })).toBe(false);
  });

  it('a three-year mason with a live project still reaches the calendar', () => {
    // The 22 October rule would have turned them away at question two.
    expect(qualifiesForCall({ ...full, yearsExperience: '1-3' })).toBe(true);
  });
});

/**
 * A disqualifying answer has to be enough on its own.
 *
 * Driving the real form found the opposite: choosing "No, I don't have a project" left
 * Next disabled, because the page still wanted the two questions underneath it. Somebody
 * already out had to answer two more before anything would happen — the opposite of
 * Philip's "they should not see the remaining steps", and a dead end for anyone who
 * reads the first question honestly and stops.
 */
describe('one answer can end the page', () => {
  it('each of the three ends it without the others being answered', () => {
    expect(disqualifiedBy({ projectStatus: 'none' })).toBe('no_project');
    expect(disqualifiedBy({ clientOnSiteDaily: true })).toBe('client_on_site_daily');
    expect(disqualifiedBy({ willUseGroundwork: 'no' })).toBe('not_using_groundwork');
  });

  it('and the page gating reads exactly that', () => {
    const page = readFileSync(
      resolve(__dirname, '..', '..', 'app', 'routes', 'work', 'partner.tsx'), 'utf8');
    expect(page).toMatch(/if \(disqualifiedBy\(answers\)\) return true;/);
  });
});
