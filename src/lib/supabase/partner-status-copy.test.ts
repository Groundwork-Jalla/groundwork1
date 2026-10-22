import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * What the status line says must match what is under it.
 *
 * This line has now disagreed with the page twice, in opposite directions. First it said
 * somebody would write to arrange a call, on a screen that was already showing the
 * calendar. Correcting that made it say "book below" unconditionally — so an applicant
 * who does not qualify, and is deliberately shown no calendar, was told to book on a page
 * with nothing to book on.
 *
 * Neither version was wrong in itself. Both were wrong for the case they were not
 * written for, which is why the line now follows the frame rather than the state.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');

describe('the line follows the calendar, not the status', () => {
  it('picks its wording from whether a booking frame exists', () => {
    expect(page).toMatch(/booking \? 'partner\.statusPendingBook'/);
    expect(page).toMatch(/: 'partner\.statusPendingBody'/);
  });

  it('and the frame is only rendered when there is one', () => {
    // Same condition, so the two can never disagree.
    expect(page).toMatch(/\{booking !== 'unset' && \(/);
  });
});

describe('each wording is true of its own case', () => {
  it.each([['en', en], ['fr', fr]] as const)('%s: the booking line points downward', (_n, dict) => {
    const book = String(lookup(dict as never, 'partner.statusPendingBook'));
    expect(book.trim().length).toBeGreaterThan(0);
    expect(book).toMatch(/below|ci-dessous/i);
  });

  it.each([['en', en], ['fr', fr]] as const)('%s: the no-calendar line promises nothing on screen', (_n, dict) => {
    const body = String(lookup(dict as never, 'partner.statusPendingBody'));
    expect(body.trim().length).toBeGreaterThan(0);
    // The whole defect: telling somebody to book on a page with no calendar.
    expect(body, 'this line is shown when there is no calendar').not.toMatch(/below|ci-dessous/i);
  });

  it('the two are different strings', () => {
    for (const dict of [en, fr]) {
      expect(String(lookup(dict as never, 'partner.statusPendingBook')))
        .not.toBe(String(lookup(dict as never, 'partner.statusPendingBody')));
    }
  });
});

describe('who is shown a calendar at all', () => {
  it('only an applicant who qualifies', () => {
    // Five years, a live diaspora project, and a willingness to introduce it. Somebody
    // who misses any of them sees the no-calendar wording, which is now accurate.
    expect(page).toMatch(/if \(inQueue && summary\.decisionReady\) void openBooking\(\)/);
  });
});
