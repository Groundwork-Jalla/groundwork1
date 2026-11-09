// =========================================================
// Remembering that somebody has already been shown this.
//
// ── Why the browser and not the account ─────────────────────────────────────────────
// A tour that reappears is worse than no tour, so this has to be remembered. It is kept
// per browser rather than on the profile because the alternative is another migration
// on a stack of ten unapplied ones, for a fact whose worst failure mode is a second
// device showing a four-step introduction once more.
//
// If that turns out to be the wrong trade — somebody signs in on their phone and is
// introduced to the product again — the fix is a column on `profiles` and this module
// becomes the fallback for a signed-out read. Nothing above here knows the difference.
//
// ── Keyed by user id, always ────────────────────────────────────────────────────────
// Two people share a laptop more often than this market's software assumes. Without the
// id, the second person to sign in is told they have already seen something they have
// not.
// =========================================================

import type { TourId } from './steps';

const KEY = (userId: string, tour: TourId) => `gw.tour.${userId}.${tour}`;

/**
 * The anchors this person has already been shown.
 *
 * Every read is guarded. `localStorage` throws outright in a private window with site
 * data blocked, and an exception thrown while deciding whether to draw a tooltip would
 * take the dashboard down with it.
 */
export function readSeen(userId: string | null | undefined, tour: TourId): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(KEY(userId, tour));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    // Unreadable is treated as "not seen". Being shown the introduction twice is a
    // smaller harm than never being shown it, which is what the other default costs.
    return [];
  }
}

export function markSeen(userId: string | null | undefined, tour: TourId, anchor: string): string[] {
  const seen = readSeen(userId, tour);
  if (seen.includes(anchor)) return seen;
  const next = [...seen, anchor];
  if (userId) {
    try { localStorage.setItem(KEY(userId, tour), JSON.stringify(next)); } catch { /* see above */ }
  }
  return next;
}

/**
 * "No thanks."
 *
 * Writes every anchor at once rather than a separate `dismissed` flag, so there is one
 * thing to read and one thing that can be out of date. Adding a step later will show
 * that one step to somebody who dismissed the tour, which is the right behaviour: they
 * declined the introduction they were offered, not every sentence the product will ever
 * want to say.
 */
export function dismissTour(
  userId: string | null | undefined, tour: TourId, anchors: readonly string[],
): string[] {
  if (userId) {
    try { localStorage.setItem(KEY(userId, tour), JSON.stringify(anchors)); } catch { /* see above */ }
  }
  return [...anchors];
}
