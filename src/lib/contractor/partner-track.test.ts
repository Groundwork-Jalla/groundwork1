import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partnerTrack, stepsReached, type TrackFacts } from './partner-track';

/**
 * One answer to "how far along is this application".
 *
 * 31 Oct 2026, Favour: "this must be tracked properly." The dashboard card was not
 * tracking anything — it guessed from the application's status:
 *
 *     const reached = state === 'accepted' ? 4 : state === 'reviewing' ? 2 : 1;
 *
 * so "Qualified" lit up because a member of staff moved the row to `reviewing`, and
 * "Book your call" could never light up at all. Meanwhile /work/partner read the real
 * facts. Two surfaces, two answers, same application.
 */

const base: TrackFacts = {
  state: 'pending', decisionReady: false, appliedAt: '2026-10-29T10:00:00Z', bookingShownAt: null,
};
const at = (f: Partial<TrackFacts>, key: string) =>
  partnerTrack({ ...base, ...f }).find(s => s.key === key)!.at;

describe('each step is read from a fact, not from the status', () => {
  it('applied is done as soon as there is an application', () => {
    expect(at({}, 'applied')).toBe('done');
  });

  it('qualified follows the qualification rule, never the staff status', () => {
    // The whole bug: `reviewing` is where an admin put the row. It says nothing about
    // whether the applicant qualifies.
    expect(at({ state: 'reviewing', decisionReady: false }, 'qualified')).toBe('now');
    expect(at({ state: 'pending',   decisionReady: true  }, 'qualified')).toBe('done');
  });

  it('book becomes current once they qualify, and is reachable at all', () => {
    expect(at({ decisionReady: false }, 'book')).toBe('todo');
    expect(at({ decisionReady: true }, 'book')).toBe('now');
  });
});

describe('a booking is never claimed', () => {
  it('showing the calendar does not tick the step', () => {
    // Groundwork sees that a slot was offered, never that one was taken: the widget
    // is a cross-origin iframe. Ticking it would tell somebody they had booked a call
    // that does not exist.
    expect(at({ decisionReady: true, bookingShownAt: '2026-10-30T09:00:00Z' }, 'book')).toBe('now');
  });

  it('only acceptance moves it on', () => {
    expect(at({ state: 'accepted' }, 'book')).toBe('done');
    expect(at({ state: 'accepted' }, 'call')).toBe('done');
    expect(at({ state: 'accepted' }, 'partner')).toBe('done');
  });

  it('and the call step is never current, because we cannot observe it', () => {
    for (const state of ['pending', 'reviewing'] as const) {
      expect(at({ state, decisionReady: true }, 'call')).not.toBe('now');
    }
  });
});

describe('somebody who is out of the funnel has no current step', () => {
  it.each(['rejected', 'disqualified'] as const)('%s', state => {
    const steps = partnerTrack({ ...base, state });
    expect(steps.some(s => s.at === 'now')).toBe(false);
  });
});

describe('the dates are honest', () => {
  it('qualifying carries the application date, since it is recomputed not stamped', () => {
    const steps = partnerTrack({ ...base, decisionReady: true });
    expect(steps.find(s => s.key === 'qualified')!.on).toBe(base.appliedAt);
  });

  it('and carries no date at all when they have not qualified', () => {
    const steps = partnerTrack(base);
    expect(steps.find(s => s.key === 'qualified')!.on).toBeNull();
  });
});

describe('both surfaces use it', () => {
  it('the dashboard card and the partner page call the same function', () => {
    const card = readFileSync('src/app/routes/work/index.tsx', 'utf8');
    const page = readFileSync('src/app/routes/work/partner.tsx', 'utf8');
    expect(card).toMatch(/partnerTrack\(\{/);
    expect(page).toMatch(/partnerTrack\(\{/);
    // The guess must not come back.
    expect(card).not.toMatch(/state === 'accepted' \? 4 :/);
  });

  it('the card reads the detail, not just the status', () => {
    const card = readFileSync('src/app/routes/work/index.tsx', 'utf8');
    expect(card).toMatch(/myApplicationDetail\(user\.id\)/);
    expect(card).not.toMatch(/myApplicationState\(/);
  });
});

describe('stepsReached counts what is behind them', () => {
  it('one at the start, all five once accepted', () => {
    expect(stepsReached(partnerTrack(base))).toBe(1);
    expect(stepsReached(partnerTrack({ ...base, state: 'accepted' }))).toBe(5);
  });
});
