import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');

describe('partner application step flow', () => {
  it('renders one question per screen and advances via selection', () => {
    expect(page).toContain('{page === 0 && (');
    expect(page).toContain('continueTo(1)');
    expect(page).toContain("{page === 7 && (");
    expect(page).toContain("if (selected === 'none')");
  });

  it('shows a progress indicator and no extra next button flow', () => {
    expect(page).toMatch(/role="progressbar"/);
    expect(page).toMatch(/aria-valuemax=\{PAGES\}/);
    expect(page).not.toMatch(/common\.next/);
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
    expect(page).toContain("{page === PAGES - 1 && (");
    expect(page).toContain("type=\"submit\"");
  });
});
