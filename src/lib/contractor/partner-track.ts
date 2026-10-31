import type { ApplicationState } from '@/lib/supabase/partner-application';

// =========================================================
// How far along a partner application is — decided once.
//
// 31 Oct 2026. Two surfaces drew this track and only one of them was tracking
// anything. `/work/partner` read the real facts: when they applied, whether they
// qualified, whether a slot was ever put in front of them. The dashboard card guessed
// from the application's STATUS alone —
//
//     const reached = state === 'accepted' ? 4 : state === 'reviewing' ? 2 : 1;
//
// so "Qualified" lit up because somebody in the office moved the row to `reviewing`,
// not because the applicant qualified, and "Book your call" could never light up at
// all. Two answers to one question, which is how the partner numbers came to disagree
// in the first place.
//
// This is the only answer now. It is pure, so the rule can be tested without a
// browser, and both surfaces call it.
//
// ── What we can and cannot see ──────────────────────────────────────────────────────
// Groundwork can see that a calendar was put in front of somebody (`bookingShownAt`,
// migration 136). It cannot see that they picked a slot: the widget is a cross-origin
// Google iframe. So "Book your call" is never marked DONE on the strength of having
// shown the calendar — it becomes the current step, and only acceptance moves it on.
// Marking it done would tell an applicant they had booked a call that does not exist.
// =========================================================

export type TrackState = 'done' | 'now' | 'todo';

export type TrackKey = 'applied' | 'qualified' | 'book' | 'call' | 'partner';

export interface TrackStep {
  key: TrackKey;
  at: TrackState;
  /** The date this step happened, where we hold one. Null where we do not. */
  on: string | null;
}

export interface TrackFacts {
  state: ApplicationState;
  /** The same qualification rule the applicant's own screen turns on. */
  decisionReady: boolean;
  appliedAt: string | null;
  /** When a calendar was shown. NOT when a call was booked. */
  bookingShownAt: string | null;
}

/**
 * The five steps, in order, with the one they are on.
 *
 * A caller that shows four steps drops `call` — the dashboard card does, because the
 * card is a summary and the call is the one step nobody can act on from there.
 */
export function partnerTrack(f: TrackFacts): TrackStep[] {
  const accepted = f.state === 'accepted';
  const out = f.state === 'rejected' || f.state === 'disqualified';
  // Qualifying is recomputed from the answers rather than stamped, so the honest date
  // for it is the day those answers were given — the day they applied.
  const qualified = f.decisionReady || accepted;

  return [
    { key: 'applied',   at: 'done', on: f.appliedAt },

    // Still being read is the CURRENT step, not a failed one. Somebody who is out of
    // the funnel has no current step at all.
    { key: 'qualified',
      at: qualified ? 'done' : out ? 'todo' : 'now',
      on: qualified ? f.appliedAt : null },

    // Never 'done' on `bookingShownAt` alone — see the header.
    { key: 'book',
      at: accepted ? 'done' : out ? 'todo' : qualified ? 'now' : 'todo',
      on: f.bookingShownAt },

    { key: 'call',    at: accepted ? 'done' : 'todo', on: null },
    { key: 'partner', at: accepted ? 'done' : 'todo', on: null },
  ];
}

/** How many steps are behind them, for a caller that draws a bar rather than a list. */
export function stepsReached(steps: TrackStep[]): number {
  return steps.filter(s => s.at === 'done').length;
}
