import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');
const english = readFileSync(join(ROOT, 'src/lib/i18n/en.ts'), 'utf8');
const french = readFileSync(join(ROOT, 'src/lib/i18n/fr.ts'), 'utf8');

describe('partner application step flow', () => {
  /**
   * Philip, 30 October: "after each question is answered, the next one has the next
   * button that they can click to get to the next stage."
   *
   * This replaces the opposite rule, which this file used to enforce — selecting an
   * answer jumped straight on, and on the free-text questions it jumped on BLUR, so
   * clicking anywhere outside the box advanced the form.
   */
  it('renders one question per screen and confirms each with Next', () => {
    expect(page).toContain('{page === 0 && (');
    expect(page).toContain("{page === 7 && (");
    expect(page).toMatch(/common\.next/);
    expect(page).toContain('onClick={advance}');
  });

  it('does not advance on selection or on blur', () => {
    // A chip's onClick sets state and nothing else; no question re-advances itself.
    expect(page).not.toMatch(/onClick=\{\(\) => \{[^}]*continueTo\(/);
    expect(page).not.toMatch(/onBlur=\{e => \{ if \(e\.currentTarget\.value\.trim\(\)\) continueTo/);
  });

  it('offers Next only once the question on screen is answered', () => {
    expect(page).toContain('disabled={busy || !isAnswered(page)}');
    expect(page).toContain('function isAnswered(at: number): boolean {');
  });

  it('shows a progress indicator', () => {
    expect(page).toMatch(/role="progressbar"/);
    expect(page).toMatch(/aria-valuemax=\{PAGES\}/);
  });

  it('omits the extra form subtitle and account-details notice', () => {
    expect(page).not.toMatch(/t\('partner\.sub'\)/);
    expect(page).not.toMatch(/\{prefill && \(/);
  });

  it('uses checkbox-style yes/no answers', () => {
    expect(page).toContain('type="checkbox"');
    expect(page).toContain("t('common.yes')");
    expect(page).toContain("t('common.no')");
  });

  it('reveals project follow-ups only for the selected project status', () => {
    expect(page).toContain("{page === 8 && projectStatus === 'running' && (");
    expect(page).toContain("{page === 8 && projectStatus === 'starting' && (");
    expect(page).toContain("setProjectStage(''); setStartWindow('');");
  });

  it('disqualifies immediately when the project is absent, the client is onsite daily, or Groundwork is rejected', () => {
    expect(page).toContain("void stopHere('no_project'");
    expect(page).toContain("void stopHere('client_on_site_daily'");
    expect(page).toContain("void stopHere('not_using_groundwork'");
  });

  it('keeps a back button and a final submit button for the completed form', () => {
    expect(page).toContain("{pageStack.length > 0 && (");
    // Next on every question but the last; the last one submits.
    expect(page).toContain("{page < PAGES - 1 ? (");
    expect(page).toContain("type=\"submit\"");
  });

  it('removes the old specialty prompt and explains the partner benefits', () => {
    expect(english).not.toContain("specialtyOther:      'Tell us what you do'");
    expect(french).not.toContain("specialtyOther:      'Dites-nous ce que vous faites'");
    expect(english).toMatch(/Certified partners can qualify for projects from Groundwork and receive free lifetime access/);
    expect(french).toMatch(/partenaires certifiés peuvent être sélectionnés pour des projets de Groundwork et bénéficier d’un accès gratuit à vie/);
  });
});
