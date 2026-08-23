import { describe, expect, it } from 'vitest';
import { applicationFromRow } from './application-types';
import { buildContractorApplicationHtml } from '../email/contractor-application-html';

/**
 * The applicant acknowledgement is built from a stored row, and the row does not have
 * the shape the template expects.
 *
 * `contractor_applications` is snake_case; the template reads the form's camelCase. Both
 * handlers passed the row straight through with `as any`, so most fields rendered blank
 * and `a.projectTypes.length` threw — every acknowledgement failed with a 502, silently
 * on the automatic path and visibly on the admin button.
 *
 * It survived a fix to the import bug sitting on the same line, survived a rewrite of the
 * audit that called the email "fixed", and was only found when someone pressed the button
 * and read the network tab. `as any` is what hid it: the compiler knew and was told not
 * to look. So the guard is a test rather than a type.
 *
 * The fixture is deliberately a *raw row*, spelled the way Postgres returns it. If it is
 * ever "tidied" into camelCase this test passes while production breaks.
 */

/** Exactly what `select('*')` returns — snake_case, JSONB arrays, nullable columns. */
const ROW: Record<string, unknown> = {
  id: 'bc33486f-0eb8-43da-8adc-2c73f1ea6fae',
  full_name: 'Ketchouang Noutswe Pierre Corneille',
  business_name: 'NAF GeoTek Ltd',
  phone: '672257643',
  email: 'pierrecorneillekn@gmail.com',
  country: 'CM',
  city: 'Yaoundé',
  portfolio_url: 'https://www.nafgeotek.com',
  role: 'general_contractor',
  role_other: null,
  years_experience: 'y5_10',
  operates_as: 'registered',
  team_size: null,
  project_types: ['residential', 'renovations'],
  credentials: { diaspora: true },
  uploads: [{ label: 'Registration', path: 'x.pdf', size: 1000 }],
  projects: [
    { name: 'Villa', location: 'Yaoundé', budget: '', role: '', year: '',
      refName: '', refPhone: '', refEmail: 'r@example.cm' },
  ],
  accepts_milestones: true,
  accepts_verification: true,
  accepts_no_side_pay: true,
  video_url: null,
  why_join: 'To work with diaspora clients.',
  differentiator: 'Fixed-price milestones.',
  ready_for_early: true,
  regions: 'Centre',
  concurrent_projects: 'two_three',
  agreed_to_terms: true,
  lang: 'en',
};

describe('applicationFromRow', () => {
  it('maps every field the template reads', () => {
    const a = applicationFromRow(ROW);
    expect(a.fullName).toBe('Ketchouang Noutswe Pierre Corneille');
    expect(a.businessName).toBe('NAF GeoTek Ltd');
    expect(a.yearsExperience).toBe('y5_10');
    expect(a.concurrentProjects).toBe('two_three');
    expect(a.projectTypes).toEqual(['residential', 'renovations']);
    expect(a.acceptsMilestones).toBe(true);
    expect(a.readyForEarly).toBe(true);
    expect(a.uploads).toHaveLength(1);
    expect(a.projects).toHaveLength(1);
  });

  it('survives the nulls Postgres actually returns', () => {
    // Every nullable column empty, and the JSONB arrays absent rather than []. The
    // template calls .length and .map on three of these.
    const sparse = { ...ROW, business_name: null, team_size: null, video_url: null,
                     portfolio_url: null, role_other: null,
                     project_types: null, uploads: null, projects: null };
    const a = applicationFromRow(sparse);
    expect(a.projectTypes).toEqual([]);
    expect(a.uploads).toEqual([]);
    expect(a.projects).toEqual([]);
    expect(() => buildContractorApplicationHtml('en', a)).not.toThrow();
  });

  it('builds the email from a raw row in both languages', () => {
    for (const lang of ['en', 'fr'] as const) {
      const html = buildContractorApplicationHtml(lang, applicationFromRow(ROW));
      expect(html).toContain('Ketchouang Noutswe Pierre Corneille');
      expect(html).toContain('NAF GeoTek Ltd');
      expect(html).toContain('672257643');
    }
  });

  it('throws if the raw row is passed to the template directly', () => {
    // The bug itself, pinned. If this ever stops throwing the template has grown
    // defensive and the mapper is no longer load-bearing — worth knowing either way.
    expect(() => buildContractorApplicationHtml('en', ROW as never)).toThrow();
  });
});
