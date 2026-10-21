import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The application is three pages, not one form and not nine screens.
 *
 * Philip's note: opening the whole form made the application feel like a different
 * exercise from the onboarding somebody had just finished, and it was easy to abandon
 * part-way. One question per screen would be nine screens for a short application, so
 * the questions are grouped three to a page with a Next between them.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');

describe('three pages with a way forward', () => {
  it('renders one page at a time', () => {
    for (const n of [0, 1, 2]) {
      expect(page, `page ${n} is not rendered`).toContain(`{page === ${n} && (`);
    }
  });

  it('and shows where they are', () => {
    expect(page).toMatch(/role="progressbar"/);
    expect(page).toMatch(/aria-valuemax=\{PAGES\}/);
  });

  it('Next is held back until that page is answered', () => {
    expect(page).toMatch(/disabled=\{!pageReady\(page\)\}/);
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

describe('the two deciding questions stay together', () => {
  it('a live project and the willingness to introduce it are on the same page', () => {
    const last = page.slice(page.indexOf('{page === 2 && ('));
    expect(last).toMatch(/partner\.hasProject/);
    expect(last).toMatch(/partner\.willIntroduce/);
  });

  it('and somebody who does not qualify is told so there, not at the calendar', () => {
    const last = page.slice(page.indexOf('{page === 2 && ('));
    expect(last).toMatch(/partner\.notReadyNote/);
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
