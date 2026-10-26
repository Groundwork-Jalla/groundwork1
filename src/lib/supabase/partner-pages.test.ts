import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The application keeps its initial groups and gives dependent project questions their
 * own Next-driven screens, so applicants cannot see follow-ups before answering.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');

describe('step-by-step project questions with a way forward', () => {
  it('renders one page at a time', () => {
    for (const n of [0, 1, 2, 4, 5, 6]) {
      expect(page, `page ${n} is not rendered`).toContain(`{page === ${n} && (`);
    }
    expect(page).toMatch(/\{page === 3 && projectStatus === 'running' && \(/);
    expect(page).toMatch(/\{page === 3 && projectStatus === 'starting' && \(/);
  });

  it('and shows where they are', () => {
    expect(page).toMatch(/role="progressbar"/);
    expect(page).toMatch(/aria-valuemax=\{PAGES\}/);
  });

  it('Next is held back until that page is answered', () => {
    expect(page).toMatch(/disabled=\{!pageReady\(page\)/);
  });

  it('and Next is never a submit button', () => {
    // Enter in a text field on page one would otherwise file a half-finished
    // application. The type is what prevents it.
    const next = page.slice(page.indexOf('page < PAGES - 1 ?'), page.indexOf('common.next'));
    expect(next).toMatch(/type="button"/);
    expect(next).not.toMatch(/type="submit"/);
  });

  it('only the last page can send it', () => {
    const tail = page.slice(page.indexOf('page < PAGES - 1 ?'));
    expect(tail).toMatch(/type="submit" disabled=\{busy \|\| !complete\}/);
  });

  it('they can go back without losing what they typed', () => {
    // The answers live in the component's state, not in the page, so stepping back and
    // forward keeps them. The Back control is what makes that reachable.
    expect(page).toMatch(/setPage\(p => p - 1\)/);
    expect(page).toMatch(/\{page > 0 && \(/);
  });
});

describe('the project question reveals only its matching follow-up', () => {
  const projectQuestion = page.slice(page.indexOf('{page === 2 && ('), page.indexOf('{page === 3 &&'));
  const projectFollowups = page.slice(page.indexOf('{page === 3 &&'), page.indexOf('{page === 4 &&'));

  it('shows the three project answers without either follow-up on that screen', () => {
    expect(projectQuestion).toMatch(/partner\.projectStatus/);
    expect(projectQuestion).not.toMatch(/partner\.projectStage|partner\.startWindow/);
    expect(projectQuestion).not.toMatch(/partner\.clientOnSite|partner\.useGroundwork/);
  });

  it('shows only the follow-up for the selected project answer on the next screen', () => {
    expect(projectFollowups).toMatch(/page === 3 && projectStatus === 'running'[\s\S]*partner\.projectStage/);
    expect(projectFollowups).toMatch(/page === 3 && projectStatus === 'starting'[\s\S]*partner\.startWindow/);
    expect(projectFollowups).not.toMatch(/partner\.projectStatus|partner\.clientOnSite|partner\.useGroundwork/);
  });

  it('requires a project answer, and allows no-project to proceed directly to disqualification', () => {
    expect(page).toMatch(/if \(n === 2\) return projectStatus !== null/);
    expect(page).toMatch(/if \(reason\) \{ await stopHere\(reason\); return; \}/);
  });

  it('a project answer advances without a Next button', () => {
    expect(projectQuestion).toMatch(/if \(selected === 'none'\) \{\s*void stopHere\('no_project', selected\)/);
    expect(projectQuestion).toMatch(/setPage\(3\)/);
    expect(projectFollowups).toMatch(/setProjectStage\(v\); setPage\(4\)/);
    expect(projectFollowups).toMatch(/setStartWindow\(v\); setPage\(4\)/);
    expect(page).toMatch(/page !== 2 && page !== 3 && \(/);
  });

  it('switching the project answer clears its previous follow-up', () => {
    // 152 refuses a stage against a project that has not started, so a stale value
    // would be rejected by the table rather than quietly filed.
    expect(projectQuestion).toMatch(/setProjectStage\(''\);\s*setStartWindow\(''\)/);
  });

  it('records the no-project answer when disqualification starts immediately', () => {
    expect(page).toMatch(/async function stopHere\(reason: Disqualifier, projectStatusAnswer = projectStatus\)/);
    expect(page).toMatch(/projectStatus: projectStatusAnswer/);
    expect(page).toMatch(/hasCurrentProject: projectStatusAnswer != null && projectStatusAnswer !== 'none'/);
  });

  it('a disqualifying answer ends the application rather than noting it', () => {
    // It used to withhold only the calendar: they finished all ten questions and
    // waited for a reply that was never coming.
    expect(page).toMatch(/const reason = disqualifiedBy\(answers\)/);
    expect(page).toMatch(/if \(reason\) \{ await stopHere\(reason\)/);
    expect(page).toMatch(/if \(stopped\) \{/);
    expect(page).toMatch(/partner\.stopped\.dashboard/);
  });
});

describe('what the application no longer asks', () => {
  it('not the specialty — onboarding collected it', () => {
    expect(page).not.toMatch(/t\('partner\.role'\)/);
  });

  it('and not the city they work from', () => {
    // Replaced by the regions they cover; the address was already taken at onboarding.
    expect(page).not.toMatch(/t\('partner\.city'\)/);
    expect(page).toMatch(/t\('partner\.regions'\)/);
  });
});
